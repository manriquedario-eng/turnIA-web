export type MisRxLoginResponse = {
  token_type: string;
  access_token: string;
  descripcion?: string;
  tipo?: number;
  roles?: string;
  usuario_id?: number;
  propio_id?: number;
  usuario?: string;
};

export type MisRxApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason:
        | 'not_configured'
        | 'unauthorized'
        | 'provider_error'
        | 'network_error'
        | 'invalid_response';
      errorMessage: string;
      status?: number;
    };

export type MisRxProfessionalProfile = {
  nrodoc: number;
  sexo: string;
  apellido: string;
  nombres: string;
  fecha_nacimiento: string;
  telefono: string;
  email: string;
  tipo_matricula: string;
  matricula: number;
  especialidad_id: number;
  cuil: number;
  login: string;
  convenio_id: number;
  credencial: string;
  direccion: string;
  localidad: string;
  provincia: string;
  localidad_codigo: string;
  provincia_codigo: string;
};

export type MisRxConvention = {
  convenio_id: number;
  nombre: string;
  autorizado: number;
  diagnostico_requerido?: number;
  posologia_requierida?: number;
  permite_sustitucion?: boolean;
  check_arca?: number;
  [key: string]: unknown;
};

export type MisRxListResponse<T> = {
  total: number;
  data: T[];
};

export type MisRxAffiliate = {
  afiliado_id: number;
  nroafiliado: string;
  apenomb_afiliado: string;
  nrodoc: number;
  status?: string;
  data?: string;
  [key: string]: unknown;
};

export type MisRxProduct = Record<string, unknown>;
export type MisRxDiagnosis = Record<string, unknown>;

export type MisRxPrescriptionPayload = Record<string, unknown>;
export type MisRxPrescriptionResponse = Record<string, unknown>;
