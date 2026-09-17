-- ============================================================================
-- MIGRACIÓN PROPUESTA — NO APLICADA
-- Fase 1 de Rate Limiting — tabla + función atómica de conteo por ventana fija
-- Proyecto: turnia-staging (nnbpefxvpmegngqopcvw)
-- Generado: 2026-09-17
--
-- Este archivo es una PROPUESTA para revisión de Dario. No se ejecutó contra
-- turnia-staging ni ninguna otra base. Requiere autorización explícita antes
-- de aplicarse (Supabase CLI / dashboard, fuera de este entorno).
--
-- Qué agrega:
--   1) rate_limit_counters: tabla de contadores por (key, window_start),
--      usada EXCLUSIVAMENTE desde server-side vía la función de abajo.
--   2) check_rate_limit(...): función SECURITY DEFINER que incrementa el
--      contador de forma atómica y decide si la request está permitida.
--
-- Qué NO hace (a propósito, alcance de esta fase — ver informe de la tarea):
--   - No integra la función en ningún endpoint todavía (login, /t/[token],
--     webhook de WhatsApp, exports quedan para la Fase 2).
--   - No agrega ningún cron job de limpieza (ver housekeeping oportunista
--     dentro de la función).
--   - No modifica ninguna tabla existente.
--
-- Seguridad (mismo criterio que google_oauth_connections, ver migración
-- 20260914213000_google_meet_and_email_messaging.sql):
--   - rate_limit_counters tiene RLS habilitado y CERO políticas para
--     'authenticated'/'anon' — sin políticas, RLS deniega todo acceso a esos
--     roles. Además se revoca explícitamente TODO privilegio de tabla para
--     'authenticated' y 'anon' (REVOKE ALL, no una lista de privilegios
--     puntuales: así el REVOKE no depende de qué privilegios de tabla existan
--     en la versión de Postgres del proyecto — por ejemplo, MAINTAIN recién
--     existe desde Postgres 17 — y sigue cubriendo SELECT/INSERT/UPDATE/
--     DELETE/TRUNCATE/REFERENCES/TRIGGER igual que un REVOKE explícito).
--   - A propósito NO se otorga ningún privilegio de tabla, ni siquiera a
--     'service_role': el único camino de acceso a esta tabla es la función
--     check_rate_limit() de abajo (ver su comentario para la justificación
--     de SECURITY DEFINER vs SECURITY INVOKER). Esto es intencional y
--     verificado: en este proyecto los DEFAULT PRIVILEGES de Postgres
--     todavía le otorgan a 'service_role' privilegios amplios sobre tablas
--     nuevas, así que un REVOKE que sólo mencione 'authenticated'/'anon' NO
--     alcanza — 'service_role' se revoca explícitamente también.
--   - Esta tabla NUNCA contiene datos de negocio ni PII en texto plano:
--     "key" almacena EXCLUSIVAMENTE un HMAC-SHA256 opaco (hex, longitud fija)
--     derivado server-side en lib/rate-limit.ts a partir de un secreto
--     dedicado (RATE_LIMIT_KEY_SECRET) — nunca un email, IP, token público o
--     user id en texto plano. La app nunca decodifica ni intenta revertir
--     ese hash; sólo lo compara por igualdad implícita vía la PK de la tabla.
-- ============================================================================

-- 1) Tabla de contadores ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_limit_counters_pkey PRIMARY KEY (key, window_start),
  CONSTRAINT rate_limit_counters_key_not_blank CHECK (btrim(key) <> ''),
  CONSTRAINT rate_limit_counters_count_nonnegative CHECK (count >= 0)
);

COMMENT ON TABLE public.rate_limit_counters IS
  'Contadores de rate limiting por ventana fija (fixed window), server-only. Nunca accesible desde el cliente ni siquiera con service_role — el único camino de acceso es check_rate_limit(). No contiene datos de negocio ni PII en texto plano; "key" es un HMAC-SHA256 opaco derivado en lib/rate-limit.ts (ver ese archivo), nunca un email/IP/token/user id literal.';

COMMENT ON COLUMN public.rate_limit_counters.key IS
  'HMAC-SHA256 (hex) de `${scope}:${windowSeconds}:${key lógica}`, calculado server-side en lib/rate-limit.ts con el secreto RATE_LIMIT_KEY_SECRET antes de llamar a check_rate_limit(). NUNCA contiene el valor lógico en texto plano (ni IP, ni email, ni token público, ni user id) — sólo el hash. Validado y saneado por la app; nunca SQL dinámico ni interpolación.';

COMMENT ON COLUMN public.rate_limit_counters.window_start IS
  'Inicio de la ventana fija (UTC), calculado de forma determinística dentro de check_rate_limit() como floor(epoch(now()) / window_seconds) * window_seconds — nunca escrito directamente por la app.';

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- A propósito: NINGUNA política para 'authenticated' ni 'anon'. Sin
-- políticas, RLS deniega todo acceso a esos roles.
--
-- El REVOKE de abajo incluye explícitamente a 'service_role', y esto NO es
-- redundante: en este proyecto se comprobó que los DEFAULT PRIVILEGES de
-- Postgres todavía le otorgan a 'service_role' privilegios administrativos
-- sobre tablas nuevas (no es sólo "bypassea RLS" — tiene privilegios de
-- tabla reales por default). Sin este REVOKE explícito, cualquier código
-- con el service role key podría hacer SELECT/INSERT/UPDATE/DELETE directo
-- sobre rate_limit_counters, evitando por completo check_rate_limit() y su
-- validación. Con este REVOKE, el único camino de acceso — para CUALQUIER
-- rol, incluido service_role — es esa función SECURITY DEFINER.
REVOKE ALL ON TABLE public.rate_limit_counters FROM anon, authenticated, service_role;

-- Índice para el housekeeping oportunista de check_rate_limit(): permite
-- localizar filas vencidas sin recorrer toda la tabla.
CREATE INDEX IF NOT EXISTS rate_limit_counters_window_start_idx
  ON public.rate_limit_counters (window_start);

-- 2) Función atómica de rate limiting -----------------------------------------
--
-- SECURITY DEFINER, no SECURITY INVOKER: la tabla de arriba revoca TODO
-- privilegio directo, incluido a 'service_role' (ver el REVOKE de arriba y
-- su comentario) — a propósito, el único camino de acceso a
-- rate_limit_counters es esta función. Con SECURITY INVOKER, 'service_role'
-- necesitaría privilegios de tabla otorgados directamente para que esta
-- función funcionara, lo que — según lo comprobado en este proyecto sobre
-- los DEFAULT PRIVILEGES — reabriría exactamente el acceso administrativo
-- amplio que el REVOKE de arriba busca cerrar. Con SECURITY DEFINER (dueña:
-- el rol que aplique esta migración, típicamente 'postgres'), la función
-- corre siempre con los privilegios de su dueño, sin importar qué privilegios
-- de tabla tenga quien la invoca (ninguno, en el caso de 'service_role') —
-- así se puede mantener la tabla completamente cerrada y esta función como
-- única puerta.
--
-- El riesgo clásico de SECURITY DEFINER es el "search_path hijacking": se
-- neutraliza fijando `SET search_path = ''` y calificando cada identificador
-- con su schema (public., pg_catalog.) — nunca se confía en el search_path
-- de quien ejecuta la función.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_max_count integer
)
RETURNS TABLE (
  allowed boolean,
  current_count integer,
  limit_count integer,
  window_start timestamptz,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_window_start timestamptz;
  v_count integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  -- Validación defensiva de inputs. La app (lib/rate-limit.ts) ya valida
  -- antes de llamar, pero esta función es SECURITY DEFINER: no confía
  -- ciegamente en el caller.
  v_key := btrim(coalesce(p_key, ''));
  IF v_key = '' THEN
    RAISE EXCEPTION 'check_rate_limit: p_key no puede ser vacío' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_key) > 200 THEN
    RAISE EXCEPTION 'check_rate_limit: p_key excede 200 caracteres' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'check_rate_limit: p_window_seconds fuera de rango (1-86400)' USING ERRCODE = '22023';
  END IF;
  IF p_max_count IS NULL OR p_max_count <= 0 OR p_max_count > 1000000 THEN
    RAISE EXCEPTION 'check_rate_limit: p_max_count fuera de rango (1-1000000)' USING ERRCODE = '22023';
  END IF;

  -- Ventana fija determinística (UTC, vía epoch — no depende del timezone de
  -- la sesión): todos los requests dentro del mismo intervalo de
  -- p_window_seconds caen en el mismo window_start, sin necesitar estado
  -- previo ni una tabla de "ventanas" separada.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM v_now) / p_window_seconds) * p_window_seconds
  );

  -- Incremento atómico: una sola sentencia INSERT ... ON CONFLICT ... DO
  -- UPDATE ... RETURNING. No hay SELECT-then-UPDATE, así que no existe
  -- ventana de carrera entre leer el contador y escribirlo aunque lleguen
  -- requests concurrentes para la misma key+window (el propio motor
  -- serializa el conflicto).
  -- ON CONFLICT ON CONSTRAINT rate_limit_counters_pkey (no `(key, window_start)`
  -- por nombre de columna): probado en vivo en Supabase, la forma por lista
  -- de columnas producía "column reference "window_start" is ambiguous"
  -- dentro de este bloque PL/pgSQL (la variable local `v_window_start` no es
  -- la ambigüedad — es el propio nombre de columna `window_start` chocando
  -- con el nombre de la columna de salida `window_start` de la función,
  -- declarado en el RETURNS TABLE de arriba). Apuntar al constraint por
  -- nombre elimina la ambigüedad sin cambiar la semántica del upsert.
  INSERT INTO public.rate_limit_counters AS rlc (key, window_start, count, updated_at)
  VALUES (v_key, v_window_start, 1, v_now)
  ON CONFLICT ON CONSTRAINT rate_limit_counters_pkey
  DO UPDATE SET count = rlc.count + 1, updated_at = v_now
  RETURNING rlc.count INTO v_count;

  -- Housekeeping oportunista y acotado: sólo ~1% de las llamadas dispara un
  -- borrado, y ese borrado está limitado a un lote chico (500 filas) de
  -- contadores vencidos (>1 día) — nunca un DELETE masivo síncrono en cada
  -- request. Sin cron: el propio tráfico de la app es lo que dispara la
  -- limpieza, de forma probabilística y barata.
  --
  -- Aliases explícitos (old_rlc / cleanup_rlc) en vez de nombres de columna
  -- pelados, por la misma razón que el ON CONFLICT de arriba: evitar
  -- cualquier ambigüedad entre `window_start` columna y `window_start`
  -- nombre de salida de la función.
  IF pg_catalog.random() < 0.01 THEN
    DELETE FROM public.rate_limit_counters AS old_rlc
    WHERE (old_rlc.key, old_rlc.window_start) IN (
      SELECT cleanup_rlc.key, cleanup_rlc.window_start
      FROM public.rate_limit_counters AS cleanup_rlc
      WHERE cleanup_rlc.window_start < v_now - interval '1 day'
      ORDER BY cleanup_rlc.window_start
      LIMIT 500
    );
  END IF;

  RETURN QUERY SELECT
    v_count <= p_max_count,
    v_count,
    p_max_count,
    v_window_start,
    greatest(
      0,
      ceil(
        extract(
          epoch FROM (
            v_window_start
            + (p_window_seconds * interval '1 second')
            - v_now
          )
        )
      )::integer
    );
END;
$$;

COMMENT ON FUNCTION public.check_rate_limit(text, integer, integer) IS
  'Incrementa atómicamente el contador de la ventana fija actual para p_key y devuelve si está permitido. p_key se espera ya opaco (HMAC-SHA256 hex derivado en lib/rate-limit.ts) — esta función no lo interpreta ni conoce su significado lógico, sólo lo usa como clave. SECURITY DEFINER a propósito (ver comentario arriba de la función) — el único camino de acceso a rate_limit_counters, para cualquier rol incluido service_role. Sin SQL dinámico: p_key siempre se usa como valor parametrizado, nunca interpolado en texto de sentencia. Ejecutable únicamente por service_role (ver privilegios abajo).';

-- Privilegios de ejecución: nadie puede llamar a esta función salvo
-- service_role. Postgres otorga EXECUTE a PUBLIC por defecto en funciones
-- nuevas, así que el REVOKE explícito de PUBLIC es imprescindible; los
-- REVOKE puntuales de anon/authenticated quedan como capa extra por si
-- PUBLIC tuviera privilegios no estándar en este proyecto.
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;

-- ============================================================================
-- Fin de la migración propuesta. NO EJECUTAR sin autorización explícita de
-- Dario. Fase 2 (fuera de esta migración): integrar lib/rate-limit.ts en
-- login, /t/[token], webhook de WhatsApp y exports.
-- ============================================================================
