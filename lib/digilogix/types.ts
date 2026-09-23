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

export type DigilogixEnvelope<T = undefined, TResultCode extends number = number> = {
  CodigoResultado: TResultCode;
  MensajeResultado: string;
  Datos?: T;
};

export type DigilogixCommonResultCode = -2 | -1 | 0 | 1;
export type DigilogixDocumentStateResultCode = -2 | -1 | 0 | 1 | 2 | 3;
export type DigilogixCertificateResultCode = -2 | -1 | 0 | 1 | 2 | 3;

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

export type DigilogixAuthorizationResult = {
  IdentificadorPersonaDocumento: string;
  CodigoUnicoIdentificacion: string;
  CuitOrganizacion?: string;
  URLAutorizacion: string;
  OrdenFirma: number;
};

export type DigilogixUploadedDocumentResult = {
  IdentificadorDocumento: string;
  IdentificadorGrupo: string;
  HashSHA256Hexadecimal: string;
  Autorizaciones: DigilogixAuthorizationResult[];
};

export type DigilogixSignResponseData = {
  Resultados: DigilogixUploadedDocumentResult[];
};

export type DigilogixSignResponse =
  DigilogixEnvelope<DigilogixSignResponseData, DigilogixCommonResultCode>;

export type DigilogixDocumentStateRequest = {
  IdentificadorDocumento: string;
};

export type DigilogixDocumentOverallStateCode = 1 | 2 | 3;
export type DigilogixSignerStateCode = 1 | 2 | 3 | 4 | 5 | 6;

export type DigilogixSignerState = {
  CodigoUnicoIdentificacion: string;
  CuitOrganizacion?: string;
  CodigoEstado: DigilogixSignerStateCode;
  DescripcionEstado: string;
};

export type DigilogixDocumentStateData = {
  CodigoEstado: DigilogixDocumentOverallStateCode;
  DescripcionEstado: string;
  ArchivoFirmadoBase64?: string;
  HashSHA256FirmadoHexadecimal?: string;
  Estados: DigilogixSignerState[];
  IdentificadorDocumento: string;
};

export type DigilogixDocumentStateResponse =
  DigilogixEnvelope<DigilogixDocumentStateData, DigilogixDocumentStateResultCode>;

export type DigilogixCertificateRequest = {
  CodigoUnicoIdentificacion: string;
  CuitOrganizacion?: string;
};

export type DigilogixCertificateData = {
  Certificado: string;
  ClavePublica: string;
  CertificadoDerBase64: string;
};

export type DigilogixCertificateResponse =
  DigilogixEnvelope<DigilogixCertificateData, DigilogixCertificateResultCode>;

export type DigilogixVerifyHashRequest = {
  CertificadoBase64: string;
  HashSHA256Hexadecimal: string;
  HashSHA256FirmadoHexadecimal: string;
};

export type DigilogixVerifyHashResponse =
  DigilogixEnvelope<undefined, DigilogixCommonResultCode>;

export type DigilogixRegistrationRequest = {
  Email?: string;
};

export type DigilogixRegistrationResponse =
  DigilogixEnvelope<undefined, DigilogixCommonResultCode>;

export type DigilogixOnboardingRequest = {
  Email: string;
  MostrarPasoPagar?: boolean;
  UrlRedireccionOK?: string;
  UrlRedireccionError?: string;
  UrlRedireccionRechazar?: string;
};

export type DigilogixOnboardingResponse =
  DigilogixEnvelope<undefined, DigilogixCommonResultCode>;
