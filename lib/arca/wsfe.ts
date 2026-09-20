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
  fetchedAt: string;
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

function extractMessages(container: unknown, key: 'Err' | 'Evt'): string[] {
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
  if (errors.length > 0) {
    return { ok: false, reason: 'provider_error', errorMessage: errors.join(' | ').slice(0, 300) };
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
  // El manual v4.8 documenta el endpoint/op público como
  // FEParamGetCondicionIvaReceptor, pero el elemento XML de request como
  // FEParamGetCondicionFrenteIvaReceptor. Se respeta exactamente esa forma.
  const result = await callAuthOnly({
    ...params,
    operationElement: 'FEParamGetCondicionFrenteIvaReceptor',
    soapActionOperation: 'FEParamGetCondicionIvaReceptor',
    responseName: 'FEParamGetCondicionIvaReceptorResponse',
    resultName: 'FEParamGetCondicionIvaReceptorResult',
  });
  if (!result.ok) return result;

  const resultGet = asRecord(result.data.ResultGet);
  const rows = arrayify(resultGet.CondicionIvaReceptor as unknown).map((raw) => {
    const item = asRecord(raw);
    return {
      id: asNumber(item.Id) ?? asString(item.Id) ?? '',
      description: asString(item.Desc) ?? '',
      extra: { voucherClass: asString(item.Cmp_Clase) },
    } satisfies WsfeParameterItem;
  });

  return { ok: true, data: rows };
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

  const receiverVatConditions = await getReceiverVatConditions(common);
  if (!receiverVatConditions.ok) return receiverVatConditions;

  return {
    ok: true,
    data: {
      environment,
      pointsOfSale: points.data,
      voucherTypes: voucherTypes.data,
      documentTypes: documentTypes.data,
      conceptTypes: conceptTypes.data,
      vatRates: vatRates.data,
      receiverVatConditions: receiverVatConditions.data,
      fetchedAt: new Date().toISOString(),
    },
  };
}
