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

export type MisRxSessionTestResponse = { data: string };

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
  producto_id?: number;
  troquel?: number;
  codigobarra?: string;
  cantidad: number;
  porc_cobertura?: number;
  imprimeMarca?: boolean;
  sustituible?: boolean;
  diagnostico?: string;
  cie10?: string;
  solo_codigo_cie10?: boolean;
};

export type MisRxPrescriptionPayload = {
  soft_id: string;
  convenio_id: number;
  nrorecetario?: string;
  medico_id?: number;
  medico_dni?: number;
  medico_tipo_matricula?: string;
  medico_matricula?: number;
  medico_especialidad_id?: number;
  medico_apellido?: string;
  medico_nombres?: string;
  medico_sexo?: 'M' | 'F' | 'X';
  tercero_medico_id?: number;
  afiliado_id?: number;
  afiliado_dni?: number;
  afiliado_sexo?: 'M' | 'F' | 'X';
  afiliado_fecha_nacimiento?: string;
  afiliado_credencial?: string;
  afiliado_apellido?: string;
  afiliado_nombres?: string;
  autorizacion?: boolean;
  autorizacion_motivo?: string;
  autorizacion_numero?: string;
  diagnostico?: string;
  tProlongado?: boolean;
  convenio_plan_cod?: number;
  observaciones?: string;
  prestador_id?: number;
  fecha_receta?: string;
  vih?: 0 | 1;
  extra_params?: string;
  items: MisRxPrescriptionItemPayload[];
};

export type MisRxPrescriptionResponse = {
  status?: string;
  msg?: string;
  nrorecetario?: string;
  nrorecetario_os?: string;
  nrorecetario_receta?: string;
  afiliado_id?: number;
  afiliado_sexo?: string;
  afiliado_apellido?: string;
  afiliado_nombres?: string;
  afiliado_dni?: string | number;
  afiliado_fecha_nacimiento?: string;
  medico_id?: number;
  medico_dni?: number;
  medico_tipo_matricula?: string;
  medico_matricula?: number;
  medico_apellido?: string;
  medico_nombres?: string;
  medico_sexo?: string;
  medico_especialidad_id?: number;
  token?: string;
  items?: Array<{
    status?: string;
    msg?: string;
    cantidad?: number;
    codigoab?: number;
    codigobarra?: string;
    troquel?: number;
    laboratorio?: string;
    marca?: string;
    presentacion?: string;
    porc_cobertura?: number;
    nroitem?: number;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

export type MisRxCancelPrescriptionPayload = {
  soft_id: string;
  convenio_id: number;
  nro_recetario: string;
};

export type MisRxCancelPrescriptionResponse = {
  success?: boolean;
  resultado_id?: number;
  data?: string;
  [key: string]: unknown;
};

export type MisRxExternalPrescriptionList = {
  tot_reg: number;
  data: Array<Record<string, unknown>>;
};

export type MisRxPlan = {
  convenio_id?: number;
  plan_id?: number;
  descripcion?: string;
  porc_cobertura?: number;
  vdm_por_afiliado?: number;
  afiliados_global?: number;
  autorizaciones_recetas_por_afiliado?: number;
  regla_items_por_receta?: number;
  regla_unidades_por_receta?: number;
  convenio_plan_cod?: number;
  afiliado_id?: number;
  [key: string]: unknown;
};
