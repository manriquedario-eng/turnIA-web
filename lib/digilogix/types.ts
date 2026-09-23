export type DigilogixFailureReason =
  | 'not_configured'
  | 'disabled'
  | 'invalid_configuration'
  | 'unauthorized'
  | 'provider_error'
  | 'network_error'
  | 'invalid_response';

export type DigilogixApiResult<T> =
  | { ok: true; data: T; status: number }
  | {
      ok: false;
      reason: DigilogixFailureReason;
      errorMessage: string;
      status?: number;
    };

export type DigilogixPerson = {
  CodigoUnicoIdentificacion: string;
  CuitOrganizacion?: string;
  OrdenFirma?: number;
  CuadroVisibleFirma_X?: number;
  CuadroVisibleFirma_Y?: number;
  CuadroVisibleFirma_Ancho?: number;
  CuadroVisibleFirma_Alto?: number;
  CuadroVisibleFirma_ImagenBase64?: string;
  CuadroVisibleFirma_PlantillaID?: 1 | 2 | 3 | 4;
  RazonFirma?: string;
  CuadroVisibleFirma_Pagina?: number;
  CuadroVisibleFirma_TodasPaginas?: boolean;
  UrlRedireccionOK?: string;
  UrlRedireccionError?: string;
  UrlRedireccionRechazar?: string;
  ForzarGeneracionErrorParaTest?: boolean;
  NroSerieCertificado?: string;
};

export type DigilogixDocumentToSign = {
  DocumentoBase64?: string;
  HashSHA256Hexadecimal?: string;
  IdentificadorGrupo?: string;
  EmpresaID?: string;
  UrlRedireccionOK?: string;
  UrlRedireccionError?: string;
  UrlRedireccionRechazar?: string;
  MostrarDocumentoHashAutorizar?: boolean;
  Personas: DigilogixPerson[];
};

export type DigilogixSignDocumentRequest = DigilogixDocumentToSign;

export type DigilogixSignDocumentsRequest = {
  Documentos: DigilogixDocumentToSign[];
};

export type DigilogixDocumentStateRequest = {
  IdentificadorDocumento: string;
};

export type DigilogixCertificateRequest = {
  CodigoUnicoIdentificacion: string;
  CuitOrganizacion?: string;
};

export type DigilogixVerifyHashRequest = {
  CertificadoBase64: string;
  HashSHA256Hexadecimal: string;
  HashSHA256FirmadoHexadecimal: string;
};

export type DigilogixRegistrationRequest = {
  Email?: string;
};

export type DigilogixOnboardingRequest = {
  Email: string;
  MostrarPasoPagar?: boolean;
  UrlRedireccionOK?: string;
  UrlRedireccionError?: string;
  UrlRedireccionRechazar?: string;
};

/**
 * Digilogix todavía no nos entregó el contrato formal de las respuestas.
 * Hasta tenerlo, se preserva la respuesta como objeto desconocido y los
 * callers NO deben inferir IDs/estados a partir de nombres inventados.
 */
export type DigilogixUnknownResponse = Record<string, unknown>;
