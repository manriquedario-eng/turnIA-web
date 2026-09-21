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

export type MisRxProduct = {
  code?: string;
  descripcion?: string;
  producto_id?: number;
  nombre?: string;
  presentacion?: string;
  unidades?: number;
  forma_farma?: string;
  accion_farma?: string;
  troquel?: string | number;
  codigobarra?: string;
  monodroga?: string;
  potencia?: string;
  monodroga_id?: number;
  laboratorio?: string;
  baja?: boolean;
  cubierto?: boolean;
  precio?: number;
  [key: string]: unknown;
};

export type MisRxDiagnosis = {
  cie10_id?: number;
  codigo_3c?: string;
  descripcion_3c?: string;
  codigo_4c?: string;
  descripcion_4c?: string;
  [key: string]: unknown;
};

export type MisRxPrescriptionItemPayload = {
  code: string;
  cantidad: number;
  porc_cobertura?: number;
  imprimeMarca?: boolean;
  sinMarca?: string;
  sustituible?: boolean;
  promo_id?: number;
  diagnostico?: string;
  cie10?: string;
  solo_codigo_cie10?: boolean;
};

export type MisRxPrescriptionPayload = {
  soft_id: string;
  convenio_id: number;
  afiliado_id?: number;
  afiliado_dni?: number;
  afiliado_sexo?: string;
  afiliado_fecha_nacimiento?: string;
  afiliado_credencial?: string;
  afiliado_apellido?: string;
  afiliado_nombres?: string;
  autorizacion?: boolean;
  autorizacion_motivo?: string;
  autorizacion_numero?: string;
  diagnostico?: string;
  cie10?: string;
  solo_codigo_cie10?: boolean;
  tProlongado?: boolean;
  items: MisRxPrescriptionItemPayload[];
  plan_id?: number;
  convenio_plan_cod?: number;
  observaciones?: string;
  prestador_id?: number;
  fecha_receta?: string;
  repetir_fechas?: string[];
  vih?: number;
  extra_params?: string;
  medico_data?: {
    tipo_matricula?: string;
    matricula?: number;
    especialidad_id?: number;
    provincia?: string;
    localidad?: string;
    direccion?: string;
  };
};

export type MisRxPrescriptionResponse = {
  convenio_id?: number;
  status?: string;
  msg?: string;
  nrorecetario?: string;
  nrorecetario_os?: string;
  nrorecetario_receta?: string;
  afiliado_id?: number;
  medico_id?: number;
  token?: string;
  lote_token?: string;
  items?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type MisRxCancelPrescriptionPayload = {
  soft_id: string;
  convenio_id: number;
  nro_recetario: string;
  lote_token: string;
};

export type MisRxPlan = {
  convenio_id?: number;
  plan_id?: number;
  descripcion?: string;
  cobertura?: number;
  convenio_plan_cod?: number;
  afiliado_id?: number;
  [key: string]: unknown;
};
