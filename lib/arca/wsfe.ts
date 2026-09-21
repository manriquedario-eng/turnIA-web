import 'server-only';

import { XMLParser } from 'fast-xml-parser';
import { getWsaaAuthContext, type ArcaEnvironment, type ArcaResult } from './wsaa';

const WSFE_ENDPOINTS = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
} as const;

const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const WSFE_NS = 'http://ar.gov.afip.dif.FEV1/';
const REQUEST_TIMEOUT_MS = 15_000;

type Dict = Record<string, unknown>;

export type WsfeParameterItem = {
  id: number | string;
  description: string;
  from?: string | null;
  to?: string | null;
  extra?: Record<string, string | number | boolean | null>;
};

export type WsfePointOfSale = {
  number: number;
  emissionType: string | null;
  blocked: boolean | null;
  from: string | null;
  to: string | null;
};

export type WsfeParametersSnapshot = {
  environment: ArcaEnvironment;
  pointsOfSale: WsfePointOfSale[];
  voucherTypes: WsfeParameterItem[];
  documentTypes: WsfeParameterItem[];
  conceptTypes: WsfeParameterItem[];
  vatRates: WsfeParameterItem[];
  receiverVatConditions: WsfeParameterItem[];
  warnings: string[];
  fetchedAt: string;
};

export type WsfeLastAuthorizedResult = {
  environment: ArcaEnvironment;
  pointOfSale: number;
  voucherType: number;
  lastAuthorizedNumber: number | null;
  events: string[];
  checkedAt: string;
};

export type WsfeTestInvoiceResult = {
  environment: ArcaEnvironment;
  pointOfSale: number;
  voucherType: number;
  voucherNumber: number;
  amount: number;
  result: 'A' | 'R' | 'P' | string;
  cae: string | null;
  caeExpiresAt: string | null;
  observations: string[];
  events: string[];
  processedAt: string | null;
  requestedAt: string;
};

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function arrayify<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Dict {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Dict) : {};
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractMessages(container: unknown, key: 'Err' | 'Evt' | 'Obs'): string[] {
  const record = asRecord(container);
  return arrayify(record[key] as unknown).map((entry) => {
    const item = asRecord(entry);
    const code = asString(item.Code) ?? '';
    const msg = asString(item.Msg) ?? '';
    return [code, msg].filter(Boolean).join(': ');
  });
}

function buildAuthXml(auth: { token: string; sign: string; cuit: string }): string {
  return (
    '<ar:Auth>' +
    '<ar:Token>' + escapeXml(auth.token) + '</ar:Token>' +
    '<ar:Sign>' + escapeXml(auth.sign) + '</ar:Sign>' +
    '<ar:Cuit>' + escapeXml(auth.cuit) + '</ar:Cuit>' +
    '</ar:Auth>'
  );
}

function buildEnvelope(operationElement: string, innerXml: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="' + SOAP_NS + '" xmlns:ar="' + WSFE_NS + '">' +
    '<soapenv:Header/>' +
    '<soapenv:Body>' +
    '<ar:' + operationElement + '>' + innerXml + '</ar:' + operationElement + '>' +
    '</soapenv:Body>' +
    '</soapenv:Envelope>'
  );
}

async function callWsfe(params: {
  environment: ArcaEnvironment;
  operationElement: string;
  soapActionOperation?: string;
  innerXml: string;
}): Promise<ArcaResult<Dict>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(WSFE_ENDPOINTS[params.environment], {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '"' + WSFE_NS + (params.soapActionOperation ?? params.operationElement) + '"',
      },
      body: buildEnvelope(params.operationElement, params.innerXml),
      cache: 'no-store',
      signal: controller.signal,
    });

    const xml = await response.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: true,
      trimValues: true,
    });

    let parsed: Dict;
    try {
      parsed = asRecord(parser.parse(xml));
    } catch {
      return { ok: false, reason: 'provider_error', errorMessage: 'ARCA devolvió una respuesta WSFE inválida.' };
    }

    const envelope = asRecord(parsed.Envelope);
    const body = asRecord(envelope.Body);

    const fault = asRecord(body.Fault);
    if (Object.keys(fault).length > 0) {
      const faultText = asString(fault.faultstring) ?? asString(fault.Reason) ?? 'Error SOAP de ARCA.';
      return { ok: false, reason: 'provider_error', errorMessage: faultText.slice(0, 300) };
    }

    if (!response.ok) {
      return { ok: false, reason: 'provider_error', errorMessage: ('ARCA WSFE respondió HTTP ' + response.status).slice(0, 300) };
    }

    return { ok: true, data: body };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'network_error', errorMessage: 'ARCA WSFE no respondió dentro del tiempo esperado.' };
    }
    return { ok: false, reason: 'network_error', errorMessage: 'No se pudo conectar con ARCA WSFE.' };
  } finally {
    clearTimeout(timeout);
  }
}

function extractResult(body: Dict, responseName: string, resultName: string): ArcaResult<Dict> {
  const responseNode = asRecord(body[responseName]);
  const resultNode = asRecord(responseNode[resultName]);

  const errors = extractMessages(resultNode.Errors, 'Err');

  // Código 602 de WSFEv1 significa "Sin Resultados". Para métodos de
  // parámetros no es un fallo de autenticación ni de conexión: simplemente
  // la CUIT no tiene filas para ese catálogo (por ejemplo, ningún punto de
  // venta WS gestionado todavía en homologación). Lo tratamos como conjunto
  // vacío para poder continuar consultando el resto de parámetros.
  const realErrors = errors.filter((message) => !/^602:\s/i.test(message));

  if (realErrors.length > 0) {
    return { ok: false, reason: 'provider_error', errorMessage: realErrors.join(' | ').slice(0, 300) };
  }

  return { ok: true, data: resultNode };
}

async function callAuthOnly(params: {
  tenantId: string;
  userId: string;
  environment: ArcaEnvironment;
  operationElement: string;
  responseName?: string;
  resultName?: string;
  soapActionOperation?: string;
  extraXml?: string;
}): Promise<ArcaResult<Dict>> {
  const auth = await getWsaaAuthContext({
    tenantId: params.tenantId,
    userId: params.userId,
    environment: params.environment,
  });
  if (!auth.ok) return auth;

  const called = await callWsfe({
    environment: params.environment,
    operationElement: params.operationElement,
    soapActionOperation: params.soapActionOperation,
    innerXml: buildAuthXml(auth.data) + (params.extraXml ?? ''),
  });
  if (!called.ok) return called;

  return extractResult(
    called.data,
    params.responseName ?? params.operationElement + 'Response',
    params.resultName ?? params.operationElement + 'Result',
  );
}

function parseGenericItems(result: Dict, nodeName: string): WsfeParameterItem[] {
  const resultGet = asRecord(result.ResultGet);
  return arrayify(resultGet[nodeName] as unknown).map((raw) => {
    const item = asRecord(raw);
    return {
      id: asNumber(item.Id) ?? asString(item.Id) ?? '',
      description: asString(item.Desc) ?? '',
      from: asString(item.FchDesde),
      to: asString(item.FchHasta),
    };
  });
}

async function getPointsOfSale(params: { tenantId: string; userId: string; environment: ArcaEnvironment }): Promise<ArcaResult<WsfePointOfSale[]>> {
  const result = await callAuthOnly({ ...params, operationElement: 'FEParamGetPtosVenta' });
  if (!result.ok) return result;

  const resultGet = asRecord(result.data.ResultGet);
  const rows = arrayify(resultGet.PtoVenta as unknown).map((raw) => {
    const item = asRecord(raw);
    return {
      number: asNumber(item.Nro) ?? 0,
      emissionType: asString(item.EmisionTipo),
      blocked: typeof item.Bloqueado === 'boolean' ? item.Bloqueado : asString(item.Bloqueado)?.toLowerCase() === 'true' ? true : asString(item.Bloqueado)?.toLowerCase() === 'false' ? false : null,
      from: asString(item.FchBaja) ? null : asString(item.FchDesde),
      to: asString(item.FchBaja) ?? null,
    };
  }).filter((item) => item.number > 0);

  return { ok: true, data: rows };
}

async function getGeneric(params: {
  tenantId: string;
  userId: string;
  environment: ArcaEnvironment;
  operationElement: string;
  nodeName: string;
}): Promise<ArcaResult<WsfeParameterItem[]>> {
  const result = await callAuthOnly(params);
  if (!result.ok) return result;
  return { ok: true, data: parseGenericItems(result.data, params.nodeName) };
}

async function getReceiverVatConditions(params: { tenantId: string; userId: string; environment: ArcaEnvironment }): Promise<ArcaResult<WsfeParameterItem[]>> {
  const auth = await getWsaaAuthContext({
    tenantId: params.tenantId,
    userId: params.userId,
    environment: params.environment,
  });
  if (!auth.ok) return auth;

  const callForClass = async (voucherClass?: string): Promise<ArcaResult<WsfeParameterItem[]>> => {
    const claseCmpXml = voucherClass ? '<ar:ClaseCmp>' + escapeXml(voucherClass) + '</ar:ClaseCmp>' : '';

    const called = await callWsfe({
      environment: params.environment,
      operationElement: 'FEParamGetCondicionFrenteIvaReceptor',
      soapActionOperation: 'FEParamGetCondicionIvaReceptor',
      innerXml:
        '<ar:Auth>' +
        '<ar:Token>' + escapeXml(auth.data.token) + '</ar:Token>' +
        '<ar:Sign>' + escapeXml(auth.data.sign) + '</ar:Sign>' +
        '<ar:Cuit>' + escapeXml(auth.data.cuit) + '</ar:Cuit>' +
        '</ar:Auth>' +
        claseCmpXml,
    });
    if (!called.ok) return called;

    const extracted = extractResult(
      called.data,
      'FEParamGetCondicionIvaReceptorResponse',
      'FEParamGetCondicionIvaReceptorResult',
    );
    if (!extracted.ok) return extracted;

    const resultGet = asRecord(extracted.data.ResultGet);
    const rows = arrayify(resultGet.CondicionIvaReceptor as unknown).map((raw) => {
      const item = asRecord(raw);
      return {
        id: asNumber(item.Id) ?? asString(item.Id) ?? '',
        description: asString(item.Desc) ?? '',
        extra: { voucherClass: asString(item.Cmp_Clase) ?? voucherClass ?? null },
      } satisfies WsfeParameterItem;
    });

    return { ok: true, data: rows };
  };

  // ARCA documenta ClaseCmp como opcional. Primero consultamos sin filtro.
  const all = await callForClass();
  if (all.ok) return all;

  // Homologación puede exigir el filtro de clase. Sólo hacemos fallback
  // ante el error 500 específico que devuelve el servicio para esta
  // operación; la autenticación se arma manualmente para conservar
  // exactamente la forma XML documentada por ARCA.
  const authShapeError =
    all.errorMessage.includes('500') &&
    all.errorMessage.toLowerCase().includes('campo auth');

  if (!authShapeError) return all;

  const classes = ['A', 'ALEY', 'B', 'C', '49'];
  const combined: WsfeParameterItem[] = [];

  for (const voucherClass of classes) {
    const one = await callForClass(voucherClass);
    if (!one.ok) {
      // "Sin resultados" para una clase concreta equivale a lista vacía.
      if (/^602:\s/i.test(one.errorMessage)) continue;
      return {
        ok: false,
        reason: one.reason,
        errorMessage: ('Condición IVA receptor (' + voucherClass + '): ' + one.errorMessage).slice(0, 300),
      };
    }
    combined.push(...one.data);
  }

  const seen = new Set<string>();
  const deduped = combined.filter((item) => {
    const key = String(item.id) + '|' + String(item.extra?.voucherClass ?? '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ok: true, data: deduped };
}

export async function getWsfeParametersSnapshot(params: {
  tenantId: string;
  userId: string;
  environment?: ArcaEnvironment;
}): Promise<ArcaResult<WsfeParametersSnapshot>> {
  const environment = params.environment ?? 'homologacion';
  const common = { tenantId: params.tenantId, userId: params.userId, environment };

  const points = await getPointsOfSale(common);
  if (!points.ok) return points;

  const voucherTypes = await getGeneric({ ...common, operationElement: 'FEParamGetTiposCbte', nodeName: 'CbteTipo' });
  if (!voucherTypes.ok) return voucherTypes;

  const documentTypes = await getGeneric({ ...common, operationElement: 'FEParamGetTiposDoc', nodeName: 'DocTipo' });
  if (!documentTypes.ok) return documentTypes;

  const conceptTypes = await getGeneric({ ...common, operationElement: 'FEParamGetTiposConcepto', nodeName: 'ConceptoTipo' });
  if (!conceptTypes.ok) return conceptTypes;

  const vatRates = await getGeneric({ ...common, operationElement: 'FEParamGetTiposIva', nodeName: 'IvaTipo' });
  if (!vatRates.ok) return vatRates;

  const warnings: string[] = [];

  const receiverVatConditions = await getReceiverVatConditions(common);
  let receiverVatConditionRows: WsfeParameterItem[] = [];

  if (receiverVatConditions.ok) {
    receiverVatConditionRows = receiverVatConditions.data;
  } else {
    const knownHomologationAuthQuirk =
      receiverVatConditions.errorMessage.includes('500') &&
      receiverVatConditions.errorMessage.toLowerCase().includes('campo auth');

    if (!knownHomologationAuthQuirk) return receiverVatConditions;

    // No frenamos toda la validación de WSFE por este método puntual.
    // ARCA homologación está aceptando el mismo TA para los otros métodos
    // pero rechaza FEParamGetCondicionIvaReceptor con código 500. Dejamos
    // constancia y seguimos con los catálogos que sí respondió el servicio.
    warnings.push(
      'ARCA homologación no devolvió Condición de IVA del receptor (error 500 en FEParamGetCondicionIvaReceptor). El resto de los parámetros se consultó normalmente.',
    );
  }

  return {
    ok: true,
    data: {
      environment,
      pointsOfSale: points.data,
      voucherTypes: voucherTypes.data,
      documentTypes: documentTypes.data,
      conceptTypes: conceptTypes.data,
      vatRates: vatRates.data,
      receiverVatConditions: receiverVatConditionRows,
      warnings,
      fetchedAt: new Date().toISOString(),
    },
  };
}


export async function getWsfeLastAuthorized(params: {
  tenantId: string;
  userId: string;
  pointOfSale: number;
  voucherType: number;
  environment?: ArcaEnvironment;
}): Promise<ArcaResult<WsfeLastAuthorizedResult>> {
  const environment = params.environment ?? 'homologacion';

  if (!Number.isInteger(params.pointOfSale) || params.pointOfSale <= 0 || params.pointOfSale > 99999) {
    return { ok: false, reason: 'provider_error', errorMessage: 'El punto de venta debe ser un entero entre 1 y 99999.' };
  }

  if (!Number.isInteger(params.voucherType) || params.voucherType <= 0 || params.voucherType > 999) {
    return { ok: false, reason: 'provider_error', errorMessage: 'El tipo de comprobante debe ser un entero entre 1 y 999.' };
  }

  const auth = await getWsaaAuthContext({
    tenantId: params.tenantId,
    userId: params.userId,
    environment,
  });
  if (!auth.ok) return auth;

  const called = await callWsfe({
    environment,
    operationElement: 'FECompUltimoAutorizado',
    innerXml:
      buildAuthXml(auth.data) +
      '<ar:PtoVta>' + String(params.pointOfSale) + '</ar:PtoVta>' +
      '<ar:CbteTipo>' + String(params.voucherType) + '</ar:CbteTipo>',
  });
  if (!called.ok) return called;

  const responseNode = asRecord(called.data.FECompUltimoAutorizadoResponse);
  const resultNode = asRecord(responseNode.FECompUltimoAutorizadoResult);

  const errors = extractMessages(resultNode.Errors, 'Err');
  if (errors.length > 0) {
    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: errors.join(' | ').slice(0, 300),
    };
  }

  const pointOfSale = asNumber(resultNode.PtoVta) ?? params.pointOfSale;
  const voucherType = asNumber(resultNode.CbteTipo) ?? params.voucherType;
  const lastAuthorizedNumber = asNumber(resultNode.CbteNro);
  const events = extractMessages(resultNode.Events, 'Evt');

  return {
    ok: true,
    data: {
      environment,
      pointOfSale,
      voucherType,
      lastAuthorizedNumber,
      events,
      checkedAt: new Date().toISOString(),
    },
  };
}


function argentinaTodayYYYYMMDD(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return String(byType.year) + String(byType.month) + String(byType.day);
}

export async function issueWsfeTestInvoiceC(params: {
  tenantId: string;
  userId: string;
}): Promise<ArcaResult<WsfeTestInvoiceResult>> {
  const environment: ArcaEnvironment = 'homologacion';
  const pointOfSale = 3;
  const voucherType = 11; // Factura C
  const amount = 1000;

  // La numeración debe ser correlativa por punto de venta y tipo de
  // comprobante. Consultamos inmediatamente antes de solicitar el CAE.
  const last = await getWsfeLastAuthorized({
    tenantId: params.tenantId,
    userId: params.userId,
    pointOfSale,
    voucherType,
    environment,
  });
  if (!last.ok) return last;

  const lastNumber = last.data.lastAuthorizedNumber ?? 0;
  const voucherNumber = lastNumber + 1;

  const auth = await getWsaaAuthContext({
    tenantId: params.tenantId,
    userId: params.userId,
    environment,
  });
  if (!auth.ok) return auth;

  const today = argentinaTodayYYYYMMDD();

  // Factura C de prueba, concepto Servicios, receptor Consumidor Final.
  // Para tipo C: ImpTotConc=0, ImpOpEx=0, ImpIVA=0 y no se informa array
  // IVA. CondicionIVAReceptorId=5 corresponde a Consumidor Final.
  const innerXml =
    buildAuthXml(auth.data) +
    '<ar:FeCAEReq>' +
      '<ar:FeCabReq>' +
        '<ar:CantReg>1</ar:CantReg>' +
        '<ar:PtoVta>' + String(pointOfSale) + '</ar:PtoVta>' +
        '<ar:CbteTipo>' + String(voucherType) + '</ar:CbteTipo>' +
      '</ar:FeCabReq>' +
      '<ar:FeDetReq>' +
        '<ar:FECAEDetRequest>' +
          '<ar:Concepto>2</ar:Concepto>' +
          '<ar:DocTipo>99</ar:DocTipo>' +
          '<ar:DocNro>0</ar:DocNro>' +
          '<ar:CbteDesde>' + String(voucherNumber) + '</ar:CbteDesde>' +
          '<ar:CbteHasta>' + String(voucherNumber) + '</ar:CbteHasta>' +
          '<ar:CbteFch>' + today + '</ar:CbteFch>' +
          '<ar:ImpTotal>' + amount.toFixed(2) + '</ar:ImpTotal>' +
          '<ar:ImpTotConc>0.00</ar:ImpTotConc>' +
          '<ar:ImpNeto>' + amount.toFixed(2) + '</ar:ImpNeto>' +
          '<ar:ImpOpEx>0.00</ar:ImpOpEx>' +
          '<ar:ImpTrib>0.00</ar:ImpTrib>' +
          '<ar:ImpIVA>0.00</ar:ImpIVA>' +
          '<ar:FchServDesde>' + today + '</ar:FchServDesde>' +
          '<ar:FchServHasta>' + today + '</ar:FchServHasta>' +
          '<ar:FchVtoPago>' + today + '</ar:FchVtoPago>' +
          '<ar:MonId>PES</ar:MonId>' +
          '<ar:MonCotiz>1</ar:MonCotiz>' +
          '<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>' +
        '</ar:FECAEDetRequest>' +
      '</ar:FeDetReq>' +
    '</ar:FeCAEReq>';

  const called = await callWsfe({
    environment,
    operationElement: 'FECAESolicitar',
    innerXml,
  });
  if (!called.ok) return called;

  const responseNode = asRecord(called.data.FECAESolicitarResponse);
  const resultNode = asRecord(responseNode.FECAESolicitarResult);

  const generalErrors = extractMessages(resultNode.Errors, 'Err');
  if (generalErrors.length > 0) {
    return {
      ok: false,
      reason: 'provider_error',
      errorMessage: generalErrors.join(' | ').slice(0, 500),
    };
  }

  const header = asRecord(resultNode.FeCabResp);
  const detailContainer = asRecord(resultNode.FeDetResp);
  const detailRaw = arrayify(detailContainer.FECAEDetResponse as unknown)[0];
  const detail = asRecord(detailRaw);

  const observations = extractMessages(detail.Observaciones, 'Obs');
  const events = extractMessages(resultNode.Events, 'Evt');

  const result = asString(detail.Resultado) ?? asString(header.Resultado) ?? '';
  const caeRaw = asString(detail.CAE);
  const cae = caeRaw && caeRaw.trim() ? caeRaw.trim() : null;
  const caeExpiresAtRaw = asString(detail.CAEFchVto);
  const caeExpiresAt = caeExpiresAtRaw && caeExpiresAtRaw.trim() ? caeExpiresAtRaw.trim() : null;

  return {
    ok: true,
    data: {
      environment,
      pointOfSale: asNumber(header.PtoVta) ?? pointOfSale,
      voucherType: asNumber(header.CbteTipo) ?? voucherType,
      voucherNumber: asNumber(detail.CbteDesde) ?? voucherNumber,
      amount,
      result,
      cae,
      caeExpiresAt,
      observations,
      events,
      processedAt: asString(header.FchProceso),
      requestedAt: new Date().toISOString(),
    },
  };
}
