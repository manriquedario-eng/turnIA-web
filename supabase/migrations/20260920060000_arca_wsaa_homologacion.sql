-- ============================================================================
-- MIGRACIÓN PROPUESTA — NO APLICADA
-- Fase 1 ARCA: sólo autenticación WSAA en HOMOLOGACIÓN + almacenamiento
-- seguro de la conexión fiscal del profesional (certificado + clave privada
-- cifrada). NO incluye invoices, patient_billing_profiles, ni nada de
-- WSFEv1/FECAESolicitar — eso es explícitamente una fase posterior.
--
-- Requiere autorización explícita de Dario antes de aplicarse contra
-- turnia-staging (Supabase CLI / dashboard, fuera de este entorno).
--
-- Contexto de diseño:
--   - Cada profesional carga SU PROPIO certificado/clave — nunca una cuenta
--     fiscal central de TurnIA (mismo criterio que google_oauth_connections
--     y mercadopago_connections).
--   - connected_at queda NULL hasta que una autenticación REAL contra WSAA
--     haya sido exitosa — cargar certificado/clave no implica "conectado".
--     Ese campo lo actualiza únicamente lib/arca/wsaa.ts tras obtener
--     Token+Sign, nunca el server action que guarda las credenciales.
--   - punto_venta es nullable y NO se exige en esta fase: WSAA sólo autentica
--     (service="wsfe"), no necesita punto de venta. Se validará/consultará
--     recién en Fase 2 con WSFEv1 (FeCompUltimoAutorizado).
--   - El CHECK de `environment` admite 'produccion' para no requerir otra
--     migración cuando se habilite más adelante, pero NINGÚN código de
--     Fase 1 (UI ni server actions) permite elegirlo — queda fijo a
--     'homologacion' en la capa de aplicación.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) arca_connections: certificado/clave privada por profesional
-- ----------------------------------------------------------------------------
--
-- Server-only: mismo criterio que google_oauth_connections y
-- mercadopago_connections — sin ninguna policy para authenticated/anon.

CREATE TABLE IF NOT EXISTS public.arca_connections (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cuit                      text NOT NULL,
  environment               text NOT NULL DEFAULT 'homologacion',
  certificate_pem           text NOT NULL,
  private_key_ciphertext    text NOT NULL,
  encryption_key_version    integer NOT NULL DEFAULT 1,
  punto_venta               integer,
  tax_condition             text,
  connected_at              timestamptz,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  revoked_at                timestamptz,

  CONSTRAINT arca_connections_environment_check
    CHECK (environment IN ('homologacion', 'produccion')),
  CONSTRAINT arca_connections_cuit_format_check
    CHECK (cuit ~ '^\d{11}$'),
  CONSTRAINT arca_connections_punto_venta_check
    CHECK (punto_venta IS NULL OR punto_venta > 0),
  CONSTRAINT arca_connections_tenant_user_environment_unique
    UNIQUE (tenant_id, user_id, environment)
);

COMMENT ON TABLE public.arca_connections IS
  'Conexión fiscal ARCA por profesional (tenant_id + user_id + environment). Certificado y clave privada de CADA profesional — nunca una cuenta fiscal central de TurnIA. Acceso EXCLUSIVAMENTE server-side vía service_role. Fase 1: sólo homologación en uso real; el CHECK ya admite produccion para no requerir otra migración cuando se habilite, pero ningún código de Fase 1 la usa ni la expone en la UI.';

COMMENT ON COLUMN public.arca_connections.cuit IS
  'CUIT del profesional, sólo dígitos (sin guiones), 11 caracteres. Se normaliza en el server action antes de guardar.';

COMMENT ON COLUMN public.arca_connections.certificate_pem IS
  'Certificado X.509 en formato PEM tal cual lo emite ARCA. No es secreto por sí solo, pero vive en esta tabla server-only porque combinado con la clave privada permite operar en nombre del profesional.';

COMMENT ON COLUMN public.arca_connections.private_key_ciphertext IS
  'Clave privada RSA, cifrada con AES-256-GCM (ver lib/arca/token-crypto.ts) ANTES de cualquier INSERT/UPDATE. Nunca se persiste en texto plano bajo ninguna circunstancia — si el cifrado falla, la operación se aborta sin guardar nada.';

COMMENT ON COLUMN public.arca_connections.punto_venta IS
  'Punto de venta asignado por ARCA. Nullable y NO obligatorio en Fase 1 — WSAA sólo autentica (service="wsfe") y no lo necesita. Se usará/validará recién en Fase 2 con WSFEv1.';

COMMENT ON COLUMN public.arca_connections.connected_at IS
  'NULL hasta que una autenticación REAL contra WSAA haya sido exitosa (Token+Sign obtenidos). Cargar certificado/clave por sí solo NUNCA establece este campo — sólo lib/arca/wsaa.ts::getOrRefreshWsaaTicket lo hace, tras un login WSAA exitoso, junto con updated_at = now().';

ALTER TABLE public.arca_connections ENABLE ROW LEVEL SECURITY;

-- A propósito: NINGUNA policy para 'authenticated' ni 'anon'. Sin políticas,
-- RLS deniega todo acceso a esos roles — mismo patrón que
-- google_oauth_connections y mercadopago_connections.
REVOKE ALL ON TABLE public.arca_connections FROM authenticated, anon;

-- Grant explícito a service_role: en Supabase el rol service_role ya suele
-- tener privilegios por defecto sobre el esquema public (ALTER DEFAULT
-- PRIVILEGES del proyecto), así que esto normalmente es redundante — se
-- agrega explícito como defensa en profundidad, para que la tabla no
-- dependa silenciosamente de esa configuración implícita del proyecto.
GRANT ALL ON TABLE public.arca_connections TO service_role;

CREATE INDEX IF NOT EXISTS arca_connections_tenant_idx
  ON public.arca_connections (tenant_id);


-- ----------------------------------------------------------------------------
-- 2) arca_auth_tickets: cache del Token/Sign de WSAA
-- ----------------------------------------------------------------------------
--
-- Un Ticket de Acceso (TA) de WSAA dura ~12hs. Se cachea acá para no pedir
-- uno nuevo en cada operación — server-only, mismo criterio que arriba.

CREATE TABLE IF NOT EXISTS public.arca_auth_tickets (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  environment               text NOT NULL,
  service                   text NOT NULL DEFAULT 'wsfe',
  token_ciphertext          text NOT NULL,
  sign_ciphertext           text NOT NULL,
  encryption_key_version    integer NOT NULL DEFAULT 1,
  expires_at                timestamptz NOT NULL,
  requested_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT arca_auth_tickets_environment_check
    CHECK (environment IN ('homologacion', 'produccion')),
  CONSTRAINT arca_auth_tickets_tenant_user_environment_service_unique
    UNIQUE (tenant_id, user_id, environment, service)
);

COMMENT ON TABLE public.arca_auth_tickets IS
  'Cache del Token/Sign (Ticket de Acceso) obtenido de WSAA por profesional+ambiente+servicio. Token y Sign viajan SIEMPRE cifrados (AES-256-GCM, ver lib/arca/token-crypto.ts). Se sobreescribe (upsert) en cada renovación — no se conserva historial de tickets viejos.';

COMMENT ON COLUMN public.arca_auth_tickets.encryption_key_version IS
  'Versión del esquema de cifrado (enc:v1:...) con la que se guardaron token_ciphertext/sign_ciphertext en ESTA fila. Se fija explícitamente en cada escritura, igual que arca_connections.encryption_key_version, para no depender silenciosamente del default si el esquema de cifrado cambia en el futuro.';

ALTER TABLE public.arca_auth_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.arca_auth_tickets FROM authenticated, anon;
GRANT ALL ON TABLE public.arca_auth_tickets TO service_role;

CREATE INDEX IF NOT EXISTS arca_auth_tickets_tenant_idx
  ON public.arca_auth_tickets (tenant_id);
