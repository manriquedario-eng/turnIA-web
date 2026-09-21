import 'server-only';

import { loginToMisRx } from './auth';
import { misRxRequest } from './client';
import type {
  MisRxAffiliate,
  MisRxApiResult,
  MisRxConvention,
  MisRxDiagnosis,
  MisRxListResponse,
  MisRxPrescriptionPayload,
  MisRxPrescriptionResponse,
  MisRxProduct,
  MisRxProfessionalProfile,
} from './types';

export class MisRxAdapter {
  constructor(
    private readonly credentials: { username: string; password: string },
    private readonly appId?: string,
  ) {}

  private async withToken<T>(
    operation: (accessToken: string) => Promise<MisRxApiResult<T>>,
  ): Promise<MisRxApiResult<T>> {
    const login = await loginToMisRx(this.credentials);
    if (!login.ok) return login;
    return operation(login.data.access_token);
  }

  async testConnection(): Promise<MisRxApiResult<MisRxProfessionalProfile>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxProfessionalProfile>({
        path: '/usuario/perfil',
        accessToken,
        query: { verify_exp: false },
      }),
    );
  }

  async getEnabledConventions(query = ''): Promise<MisRxApiResult<MisRxListResponse<MisRxConvention>>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxListResponse<MisRxConvention>>({
        path: '/api/medicos_convenios_habilitados',
        accessToken,
        query: { query, tramites: 0, enrolamientos: 0, verify_exp: false },
      }),
    );
  }

  async findAffiliate(params: {
    convenioId: number;
    dni?: string;
    affiliateNumber?: string;
    fullName?: string;
    affiliateId?: number;
  }): Promise<MisRxApiResult<MisRxListResponse<MisRxAffiliate>>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxListResponse<MisRxAffiliate>>({
        path: '/api/busca_afiliado',
        accessToken,
        query: {
          convenio_id: params.convenioId,
          dni: params.dni ?? '',
          nroafiliado: params.affiliateNumber ?? '',
          apellidonombre: params.fullName ?? '',
          afiliado_id: params.affiliateId ?? 0,
          verify_exp: false,
        },
      }),
    );
  }

  async searchProducts(query: string): Promise<MisRxApiResult<MisRxListResponse<MisRxProduct>>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxListResponse<MisRxProduct>>({
        path: '/api/productos_seleccion',
        accessToken,
        query: { query },
      }),
    );
  }

  async searchDiagnoses(query: string): Promise<MisRxApiResult<MisRxListResponse<MisRxDiagnosis>>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxListResponse<MisRxDiagnosis>>({
        path: '/api/diagnosticos_ci10',
        accessToken,
        query: { query },
      }),
    );
  }

  async issuePrescription(
    payload: MisRxPrescriptionPayload,
  ): Promise<MisRxApiResult<MisRxPrescriptionResponse>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxPrescriptionResponse>({
        path: '/api/informa_receta',
        method: 'PUT',
        accessToken,
        appId: this.appId,
        body: payload,
        query: { verify_exp: false },
      }),
    );
  }

  async getPrescription(token: string): Promise<MisRxApiResult<MisRxPrescriptionResponse>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxPrescriptionResponse>({
        path: '/api/receta',
        accessToken,
        query: { token, verify_exp: false },
      }),
    );
  }

  async cancelPrescription(token: string): Promise<MisRxApiResult<MisRxPrescriptionResponse>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxPrescriptionResponse>({
        path: '/api/anular_receta',
        method: 'DELETE',
        accessToken,
        appId: this.appId,
        query: { token, verify_exp: false },
      }),
    );
  }
}
