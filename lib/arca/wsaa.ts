// Cliente WSAA (Web Service de Autenticación y Autorización) de ARCA.
//
// FASE 1: esto SOLO guarda la conexión fiscal (certificado + clave privada)
// de cada profesional y obtiene/renueva un Ticket de Acceso (Token+Sign)
// para service="wsfe" en HOMOLOGACIÓN. NO llama a WSFEv1, NO consulta
// punto de venta, NO emite nada — eso es una fase posterior y usará la
// conexión que este módulo guarda.
//
// Ambiente: todo este módulo acepta `environment` como parámetro porque el
// CHECK de la base ya admite 'homologacion' | 'produccion' (para no
// requerir otra migración a futuro), pero NINGÚN caller de Fase 1 pasa otra
// cosa que 'homologacion' — el fijado a homologación vive en la capa de
// aplicación (app/(protected)/settings/actions.ts), no acá.
//
// Protocolo (documentación oficial ARCA, WSAA):
//  1. Armar un TRA (Ticket de Requerimiento de Acceso) XML.
//  2. Firmarlo como CMS/PKCS#7 (SignedData, enveloping — el TRA viaja DENTRO
//     del CMS) con el certificado X.509 + clave privada del profesional.
//  3. Enviar el CMS (base64) al método loginCms del servicio WSAA (SOAP).
//  4. ARCA responde un loginTicketResponse XML (embebido en el SOAP) con
//     token, sign y expirationTime.
//
// Endpoint de homologación (verificado contra la documentación vigente de
// ARCA al momento de escribir esto):
//   https://wsaahomo.afip.gov.ar/ws/services/LoginCms
//
// Nunca loguea: certificado, clave privada, CMS firmado, token, sign, ni el
// XML completo de la respuesta de ARCA (sólo códigos/mensajes de error,
// truncados y sin datos sensibles).
//
// Variables de entorno: ninguna variable de credencial global — a
// diferencia de Google/Mercado Pago (client id/secret de la app), acá no
// hay "app" de TurnIA ante ARCA: cada profesional trae su propio
// certificado/clave, guardados en arca_connections. Sólo se necesitan
// SUPABASE_SERVICE_ROLE_KEY (lib/supabase/service.ts) y
// ARCA_TOKEN_ENCRYPTION_KEY (./token-crypto.ts).

import 'server-only';
import forge from 'node-forge';
import { XMLParser } from 'fast-xml-parser';
import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { encryptArcaSecret, decryptArcaSecret, isArcaTokenEncryptionConfigured } from './token-crypto';

const WSAA_ENDPOINTS = {
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  // Sin uso en Fase 1 — ningún código llama a WSAA con environment
  // 'produccion' todavía (ver comentario de cabecera).
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
} as const;

export type ArcaEnvironment = 'homologacion' | 'produccion';

// Versión del esquema de cifrado con la que se guardan los secretos de ARCA
// — corresponde al envelope `enc:v1:...` de ./token-crypto.ts. Se fija acá
// explícitamente en cada escritura (arca_connections y arca_auth_tickets),
// mismo criterio que lib/mercadopago/oauth.ts.
const CURRENT_ENCRYPTION_KEY_VERSION = 1;

// Margen de seguridad: se pide un ticket nuevo si al vigente le quedan
// menos de 5 minutos, para no arriesgarse a que expire a mitad de una
// operación futura (Fase 2).
const EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;

// Timeout explícito de la llamada SOAP a WSAA — una función serverless no
// debe quedar colgada esperando a ARCA indefinidamente (ver notas de
// riesgos de Vercel/serverless del plan).
const WSAA_REQUEST_TIMEOUT_MS = 15_000;

export function isArcaWsaaConfigured(): boolean {
  return isServiceRoleConfigured() && isArcaTokenEncryptionConfigured();
}

export type ArcaResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: 'not_configured' | 'not_connected' | 'invalid_credentials' | 'provider_error' | 'network_error';
      errorMessage: string;
    };

// ----------------------------------------------------------------------------
// 1) TRA — Ticket de Requerimiento de Acceso
// ----------------------------------------------------------------------------

function buildTra(service: string): string {
  const now = Date.now();
  // Ventana de tolerancia de reloj recomendada por ARCA: 10 minutos antes y
  // después del momento actual para generationTime/expirationTime del TRA
  // — esto NO es la duración del ticket resultante, que la fija ARCA en la
  // respuesta (ver header.expirationTime del loginTicketResponse).
  const generationTime = new Date(now - 10 * 60 * 1000).toISOString();
  const expirationTime = new Date(now + 10 * 60 * 1000).toISOString();
  // uniqueId: entero: ARCA sólo exige que sea razonablemente único — segundos
  // desde epoch alcanza y evita depender de estado externo (contador, etc).
  const uniqueId = Math.floor(now / 1000);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${generationTime}</generationTime>` +
    `<expirationTime>${expirationTime}</expirationTime>` +
    `</header>` +
    `<service>${service}</service>` +
    `</loginTicketRequest>`
  );
}

// ----------------------------------------------------------------------------
// 2) Firma CMS/PKCS#7 (node-forge, sin dependencias nativas — ver plan §4)
// ----------------------------------------------------------------------------

type SignResult = { ok: true; cmsBase64: string } | { ok: false; errorMessage: string };

function signTra(traXml: string, certificatePem: string, privateKeyPem: string): SignResult {
  try {
    const cert = forge.pki.certificateFromPem(certificatePem);
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);

    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(traXml, 'utf8');
    p7.addCertificate(cert);
    p7.addSigner({
      key: privateKey,
      certificate: cert,
      // SHA1 acá es obligatorio por especificación técnica de WSAA (CMS
      // SignedData con SHA1+RSA) — no es una elección criptográfica
      // general, es compatibilidad forzada con lo que WSAA exige.
      digestAlgorithm: forge.pki.oids.sha1,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest }, // node-forge lo calcula
        { type: forge.pki.oids.signingTime }, // node-forge lo completa automáticamente en p7.sign(); @types/node-forge tipa `value` como string, así que no se le pasa un Date acá
      ],
    });
    // sign({ detached: false }): el TRA viaja DENTRO del CMS (enveloping) —
    // así lo exige loginCms, nunca detached.
    p7.sign({ detached: false });

    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    const cmsBase64 = forge.util.encode64(der);
    return { ok: true, cmsBase64 };
  } catch {
    // Nunca exponer el motivo real (puede filtrar detalle de la clave o el
    // certificado) — típicamente significa cert/key con formato inválido o
    // que no corresponden entre sí (ver validateCertificateKeyPair, que
    // debería haber atajado ese caso antes de llegar acá).
    return { ok: false, errorMessage: 'No se pudo firmar el TRA con el certificado/clave provistos.' };
  }
}

// ----------------------------------------------------------------------------
// 3) SOAP loginCms — envelope armado a mano (ver plan §4: se descartó la
//    librería `soap` porque WSAA en esta fase es una única operación fija).
// ----------------------------------------------------------------------------

async function callLoginCms(cmsBase64: string, environment: ArcaEnvironment): Promise<ArcaResult<string>> {
  const endpoint = WSAA_ENDPOINTS[environment];
  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/>` +
    `<soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms></soapenv:Body>` +
    `</soapenv:Envelope>`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WSAA_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
      body: envelope,
      signal: controller.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      // Caso conocido y no fatal: ARCA ya tiene un TA vigente para este
      // certificado/service (por ejemplo, pedido desde otro proceso/pestaña
      // casi al mismo tiempo). No hay forma de recuperar ESE ticket — se
      // informa como error transitorio, nunca como "credenciales inválidas".
      if (/ya posee un TA valido/i.test(text) || /already has a valid TA/i.test(text)) {
        return { ok: false, reason: 'provider_error', errorMessage: 'ALREADY_HAS_VALID_TA' };
      }
      const faultMatch = text.match(/<faultstring>(.*?)<\/faultstring>/i);
      return {
        ok: false,
        reason: 'provider_error',
        errorMessage: (faultMatch?.[1] || `WSAA respondió ${response.status}`).slice(0, 300),
      };
    }
    return { ok: true, data: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error de red desconocido';
    return { ok: false, reason: 'network_error', errorMessage: message.slice(0, 300) };
  } finally {
    clearTimeout(timeout);
  }
}

// ----------------------------------------------------------------------------
// 4) Parseo de la respuesta (fast-xml-parser, sin dependencias nativas)
// ----------------------------------------------------------------------------

type ParsedTicket = { token: string; sign: string; expirationTime: string };

function parseLoginCmsResponse(soapXml: string): ArcaResult<ParsedTicket> {
  try {
    const parser = new XMLParser({ ignoreAttributes: true });
    const soapDoc = parser.parse(soapXml);
    const loginCmsReturn = soapDoc?.['soapenv:Envelope']?.['soapenv:Body']?.loginCmsResponse?.loginCmsReturn;
    if (typeof loginCmsReturn !== 'string') {
      return { ok: false, reason: 'provider_error', errorMessage: 'Respuesta de WSAA con formato inesperado.' };
    }
    // loginCmsReturn es, a su vez, el XML del loginTicketResponse como texto
    // (ARCA lo devuelve como un string XML-escapado dentro del SOAP).
    const inner = parser.parse(loginCmsReturn);
    const credentials = inner?.loginTicketResponse?.credentials;
    const header = inner?.loginTicketResponse?.header;
    if (!credentials?.token || !credentials?.sign || !header?.expirationTime) {
      return { ok: false, reason: 'provider_error', errorMessage: 'WSAA no devolvió token/sign/expirationTime.' };
    }
    return {
      ok: true,
      data: {
        token: String(credentials.token),
        sign: String(credentials.sign),
        expirationTime: String(header.expirationTime),
      },
    };
  } catch {
    return { ok: false, reason: 'provider_error', errorMessage: 'No se pudo interpretar la respuesta de WSAA.' };
  }
}

// ----------------------------------------------------------------------------
// 5) Validación de par certificado/clave (antes de guardar en Settings)
// ----------------------------------------------------------------------------

export function validateCertificateKeyPair(
  certificatePem: string,
  privateKeyPem: string,
): { ok: true } | { ok: false; errorMessage: string } {
  try {
    const cert = forge.pki.certificateFromPem(certificatePem);
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey;
    const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
    // Comparación de módulo RSA: si coinciden, la clave privada corresponde
    // matemáticamente a la clave pública del certificado. Comprobación
    // estructural directa, no requiere firmar/verificar un desafío.
    if (publicKey.n.toString(16) !== privateKey.n.toString(16)) {
      return { ok: false, errorMessage: 'El certificado y la clave privada no corresponden entre sí.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, errorMessage: 'Certificado o clave privada con formato inválido.' };
  }
}

// ----------------------------------------------------------------------------
// 6) Guardar la conexión fiscal (Settings → "Facturación ARCA")
// ----------------------------------------------------------------------------
//
// IMPORTANTE: esto NUNCA establece connected_at. Cargar certificado/clave no
// es "estar conectado" — sólo lo es una autenticación WSAA real y exitosa
// (ver getOrRefreshWsaaTicket más abajo, único lugar que escribe
// connected_at). punto_venta es opcional acá a propósito: WSAA no lo
// necesita en esta fase.

export async function saveArcaConnection(params: {
  tenantId: string;
  userId: string;
  cuit: string;
  puntoVenta: number | null;
  certificatePem: string;
  privateKeyPem: string;
}): Promise<ArcaResult<true>> {
  if (!isArcaWsaaConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'La integración ARCA no está configurada.' };
  }

  const validation = validateCertificateKeyPair(params.certificatePem, params.privateKeyPem);
  if (!validation.ok) {
    return { ok: false, reason: 'invalid_credentials', errorMessage: validation.errorMessage };
  }

  // Cifrar ANTES de cualquier upsert — en ningún momento se guarda la clave
  // privada en texto plano. Si el cifrado falla, se aborta sin persistir
  // nada (mismo criterio que completeMercadoPagoOAuthConnection).
  const encryptedKey = encryptArcaSecret(params.privateKeyPem);
  if (!encryptedKey.ok) {
    console.error('ARCA: no se pudo cifrar la clave privada antes de guardarla — conexión abortada');
    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: 'No se pudo guardar la conexión de forma segura. Probá de nuevo en unos minutos.',
    };
  }

  try {
    const serviceClient = createSupabaseServiceClient();
    const { error } = await serviceClient.from('arca_connections').upsert(
      {
        tenant_id: params.tenantId,
        user_id: params.userId,
        environment: 'homologacion', // fijo en Fase 1 — ver comentario de cabecera del archivo
        cuit: params.cuit,
        punto_venta: params.puntoVenta,
        certificate_pem: params.certificatePem,
        private_key_ciphertext: encryptedKey.data,
        encryption_key_version: CURRENT_ENCRYPTION_KEY_VERSION,
        // connected_at se resetea a NULL explícitamente en CADA guardado
        // (alta o reemplazo por igual): cargar/reemplazar certificado o
        // clave nunca implica "conectado" — sólo lo hace una autenticación
        // WSAA real y exitosa posterior (ver getOrRefreshWsaaTicket, único
        // lugar que vuelve a poner connected_at). Si el profesional
        // reemplaza sus credenciales, la validación anterior queda anulada
        // hasta que se pruebe la conexión de nuevo con las nuevas.
        connected_at: null,
        updated_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: 'tenant_id,user_id,environment' },
    );

    if (error) {
      console.error('ARCA: fallo de Supabase al guardar arca_connections', { code: error.code, message: error.message });
      return { ok: false, reason: 'provider_error', errorMessage: 'No se pudo guardar la conexión ARCA.' };
    }

    // Si el profesional está REEMPLAZANDO certificado/clave, cualquier
    // ticket cacheado de las credenciales anteriores queda inválido para
    // este propósito — se firmó con una clave que ya no es la vigente.
    // Se borra explícitamente en vez de dejar que expire solo, para que
    // getOrRefreshWsaaTicket nunca reutilice por error un ticket obtenido
    // con credenciales viejas. Server-side, con service_role — el cliente
    // nunca ve ni pide este borrado directamente.
    const { error: deleteTicketError } = await serviceClient
      .from('arca_auth_tickets')
      .delete()
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.userId)
      .eq('environment', 'homologacion');

    if (deleteTicketError) {
      // No se exponen detalles de Supabase más allá de code/message (nunca
      // datos de la conexión). No se trata como "conexión guardada
      // exitosamente" aunque el upsert de arca_connections sí haya
      // funcionado: si un ticket viejo pudiera sobrevivir sin que lo
      // sepamos, getOrRefreshWsaaTicket podría reutilizarlo por error.
      console.error('ARCA: fallo de Supabase al borrar tickets previos tras reemplazar credenciales', {
        code: deleteTicketError.code,
        message: deleteTicketError.message,
      });
      return {
        ok: false,
        reason: 'provider_error',
        errorMessage: 'Las credenciales se guardaron, pero no se pudo invalidar la conexión anterior. Probá de nuevo antes de usarla.',
      };
    }

    return { ok: true, data: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error desconocido al guardar la conexión';
    return { ok: false, reason: 'provider_error', errorMessage: errorMessage.slice(0, 300) };
  }
}

// ----------------------------------------------------------------------------
// 7) Resumen no-secreto para mostrar en Settings (nunca cert/key/token/sign)
// ----------------------------------------------------------------------------

export type ArcaConnectionSummary = {
  cuit: string;
  puntoVenta: number | null;
  activityCode: string | null;
  activityDescription: string | null;
  environment: ArcaEnvironment;
  connectedAt: string | null;
};

export async function getArcaConnectionSummary(params: {
  tenantId: string;
  userId: string;
}): Promise<ArcaConnectionSummary | null> {
  if (!isServiceRoleConfigured()) return null;

  const serviceClient = createSupabaseServiceClient();
  const { data } = await serviceClient
    .from('arca_connections')
    .select('cuit, punto_venta, activity_code, activity_description, environment, connected_at')
    .eq('tenant_id', params.tenantId)
    .eq('user_id', params.userId)
    .eq('environment', 'homologacion')
    .is('revoked_at', null)
    .maybeSingle();

  if (!data) return null;

  return {
    cuit: data.cuit,
    puntoVenta: data.punto_venta,
    activityCode: data.activity_code ?? null,
    activityDescription: data.activity_description ?? null,
    environment: data.environment as ArcaEnvironment,
    connectedAt: data.connected_at,
  };
}

// ----------------------------------------------------------------------------
// 7.b) Preferencias operativas de facturación ARCA
// ----------------------------------------------------------------------------

export async function updateArcaBillingPreferences(params: {
  tenantId: string;
  userId: string;
  puntoVenta: number | null;
  activityCode: string | null;
  activityDescription: string | null;
}): Promise<ArcaResult<true>> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'La integración ARCA no está configurada.' };
  }

  const serviceClient = createSupabaseServiceClient();

  const { data: connection } = await serviceClient
    .from('arca_connections')
    .select('id')
    .eq('tenant_id', params.tenantId)
    .eq('user_id', params.userId)
    .eq('environment', 'homologacion')
    .is('revoked_at', null)
    .maybeSingle();

  if (!connection) {
    return { ok: false, reason: 'not_connected', errorMessage: 'Primero conectá ARCA antes de guardar preferencias de facturación.' };
  }

  const { error } = await serviceClient
    .from('arca_connections')
    .update({
      punto_venta: params.puntoVenta,
      activity_code: params.activityCode,
      activity_description: params.activityDescription,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connection.id);

  if (error) {
    console.error('ARCA: no se pudieron actualizar preferencias de facturación', {
      code: error.code,
      message: error.message,
    });
    return { ok: false, reason: 'provider_error', errorMessage: 'No se pudieron guardar las preferencias de facturación.' };
  }

  return { ok: true, data: true };
}

// ----------------------------------------------------------------------------
// 8) Entry point: obtener (o reutilizar) el Ticket de Acceso
// ----------------------------------------------------------------------------

export async function getOrRefreshWsaaTicket(params: {
  tenantId: string;
  userId: string;
  environment: ArcaEnvironment;
  service?: string;
}): Promise<ArcaResult<{ reused: boolean }>> {
  const service = params.service ?? 'wsfe';

  if (!isArcaWsaaConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'La integración ARCA no está configurada.' };
  }

  const serviceClient = createSupabaseServiceClient();

  // a) Cargar PRIMERO la conexión fiscal — antes de mirar el cache de
  // tickets. Es deliberado: connected_at de esta fila es lo que decide más
  // abajo si un ticket cacheado puede reutilizarse o no (ver c), así que
  // necesitamos conocerlo antes de decidir nada sobre el cache.
  const { data: connection } = await serviceClient
    .from('arca_connections')
    .select('certificate_pem, private_key_ciphertext, connected_at')
    .eq('tenant_id', params.tenantId)
    .eq('user_id', params.userId)
    .eq('environment', params.environment)
    .is('revoked_at', null)
    .maybeSingle();

  if (!connection) {
    return { ok: false, reason: 'not_connected', errorMessage: 'No hay una conexión ARCA configurada.' };
  }

  // b) ¿Hay un ticket vigente cacheado?
  const { data: cachedTicket } = await serviceClient
    .from('arca_auth_tickets')
    .select('expires_at')
    .eq('tenant_id', params.tenantId)
    .eq('user_id', params.userId)
    .eq('environment', params.environment)
    .eq('service', service)
    .maybeSingle();

  // c) Un ticket cacheado sólo se reutiliza si además la conexión está
  // marcada como conectada (connected_at !== null). Si connected_at es
  // NULL — por ejemplo, justo después de que saveArcaConnection reseteó la
  // conexión al reemplazar certificado/clave — el ticket cacheado se
  // ignora aunque no haya expirado todavía, y se sigue de largo a
  // autenticar de nuevo contra WSAA con las credenciales actuales. Esto es
  // lo que evita que un ticket viejo (firmado con una clave ya
  // reemplazada) se reutilice por error.
  if (
    cachedTicket &&
    new Date(cachedTicket.expires_at).getTime() - Date.now() > EXPIRY_SAFETY_MARGIN_MS &&
    connection.connected_at !== null
  ) {
    return { ok: true, data: { reused: true } };
  }

  const decryptedKey = decryptArcaSecret(connection.private_key_ciphertext);
  if (!decryptedKey.ok) {
    return { ok: false, reason: 'provider_error', errorMessage: 'No se pudo leer la clave privada guardada.' };
  }

  // c) Armar TRA, firmar, llamar WSAA.
  const traXml = buildTra(service);
  const signed = signTra(traXml, connection.certificate_pem, decryptedKey.data);
  if (!signed.ok) {
    return { ok: false, reason: 'invalid_credentials', errorMessage: signed.errorMessage };
  }

  const soapResult = await callLoginCms(signed.cmsBase64, params.environment);
  if (!soapResult.ok) {
    if (soapResult.errorMessage === 'ALREADY_HAS_VALID_TA') {
      return {
        ok: false,
        reason: 'provider_error',
        errorMessage: 'Ya existe un ticket vigente en ARCA; probá de nuevo en unos minutos.',
      };
    }
    return soapResult;
  }

  const parsed = parseLoginCmsResponse(soapResult.data);
  if (!parsed.ok) return parsed;

  const encryptedToken = encryptArcaSecret(parsed.data.token);
  const encryptedSign = encryptArcaSecret(parsed.data.sign);
  if (!encryptedToken.ok || !encryptedSign.ok) {
    return { ok: false, reason: 'provider_error', errorMessage: 'No se pudo cifrar el ticket recibido.' };
  }

  const nowIso = new Date().toISOString();

  const { error: upsertError } = await serviceClient.from('arca_auth_tickets').upsert(
    {
      tenant_id: params.tenantId,
      user_id: params.userId,
      environment: params.environment,
      service,
      token_ciphertext: encryptedToken.data,
      sign_ciphertext: encryptedSign.data,
      encryption_key_version: CURRENT_ENCRYPTION_KEY_VERSION,
      expires_at: parsed.data.expirationTime,
      requested_at: nowIso,
    },
    { onConflict: 'tenant_id,user_id,environment,service' },
  );

  if (upsertError) {
    console.error('ARCA: fallo de Supabase al guardar arca_auth_tickets', { code: upsertError.code, message: upsertError.message });
    return { ok: false, reason: 'provider_error', errorMessage: 'No se pudo guardar el ticket obtenido.' };
  }

  // Recién ACÁ, tras obtener Token+Sign realmente de WSAA, se marca la
  // conexión como conectada. Nunca se hace esto en saveArcaConnection.
  const { error: connectionUpdateError } = await serviceClient
    .from('arca_connections')
    .update({ connected_at: nowIso, updated_at: nowIso })
    .eq('tenant_id', params.tenantId)
    .eq('user_id', params.userId)
    .eq('environment', params.environment);

  if (connectionUpdateError) {
    // El ticket ya se guardó correctamente — no se revierte nada por esto,
    // pero se deja constancia en logs (sin datos sensibles) porque
    // connected_at quedaría desactualizado en la UI.
    console.error('ARCA: ticket obtenido pero no se pudo actualizar connected_at', {
      code: connectionUpdateError.code,
      message: connectionUpdateError.message,
    });
  }

  return { ok: true, data: { reused: false } };
}

// ----------------------------------------------------------------------------
// 9) Contexto de autenticación para WSFEv1 (server-only)
// ----------------------------------------------------------------------------
//
// Este helper NO se expone al browser. Asegura primero que exista un TA
// vigente para service="wsfe" y recién después lee + descifra Token/Sign y
// el CUIT representado. Los secretos sólo viven en memoria del servidor
// durante la llamada al WS de negocio.
export async function getWsaaAuthContext(params: {
  tenantId: string;
  userId: string;
  environment: ArcaEnvironment;
}): Promise<ArcaResult<{ token: string; sign: string; cuit: string }>> {
  const ensured = await getOrRefreshWsaaTicket({
    tenantId: params.tenantId,
    userId: params.userId,
    environment: params.environment,
    service: 'wsfe',
  });
  if (!ensured.ok) return ensured;

  if (!isArcaWsaaConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'La integración ARCA no está configurada.' };
  }

  const serviceClient = createSupabaseServiceClient();

  const [{ data: connection }, { data: ticket }] = await Promise.all([
    serviceClient
      .from('arca_connections')
      .select('cuit')
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.userId)
      .eq('environment', params.environment)
      .is('revoked_at', null)
      .maybeSingle(),
    serviceClient
      .from('arca_auth_tickets')
      .select('token_ciphertext, sign_ciphertext, expires_at')
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.userId)
      .eq('environment', params.environment)
      .eq('service', 'wsfe')
      .maybeSingle(),
  ]);

  if (!connection || !ticket) {
    return { ok: false, reason: 'not_connected', errorMessage: 'No hay una autenticación ARCA disponible.' };
  }

  if (new Date(ticket.expires_at).getTime() - Date.now() <= EXPIRY_SAFETY_MARGIN_MS) {
    return { ok: false, reason: 'provider_error', errorMessage: 'El ticket ARCA expiró antes de poder usarlo. Probá nuevamente.' };
  }

  const token = decryptArcaSecret(ticket.token_ciphertext);
  const sign = decryptArcaSecret(ticket.sign_ciphertext);
  if (!token.ok || !sign.ok) {
    return { ok: false, reason: 'provider_error', errorMessage: 'No se pudo leer el ticket ARCA guardado.' };
  }

  return { ok: true, data: { token: token.data, sign: sign.data, cuit: connection.cuit } };
}

// Wrapper de cara al botón "Probar conexión" — nunca devuelve token/sign/
// cert/key, sólo éxito o un mensaje sanitizado.
export async function testArcaConnection(params: { tenantId: string; userId: string }): Promise<ArcaResult<true>> {
  const result = await getOrRefreshWsaaTicket({
    tenantId: params.tenantId,
    userId: params.userId,
    environment: 'homologacion', // fijo en Fase 1 — ver comentario de cabecera del archivo
  });
  if (!result.ok) return result;
  return { ok: true, data: true };
}
