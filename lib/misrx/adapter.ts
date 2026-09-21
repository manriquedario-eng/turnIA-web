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
  MisRxCancelPrescriptionPayload,
  MisRxPlan,
} from './types';

export class MisRxAdapter {
  constructor(
    private readonly credentials: { username: string; password: string },
    private readonly provider: { appId?: string; softId?: string } = {},
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

  async searchProducts(params: {
    query: string;
    convenioId: number;
    credential?: string;
    dni?: string;
    authorization?: string;
    planId?: number;
    noIncluyeBajas?: boolean;
  }): Promise<MisRxApiResult<MisRxListResponse<MisRxProduct>>> {
    if (!this.provider.softId) {
      return {
        ok: false,
        reason: 'not_configured',
        errorMessage: 'Falta configurar el soft_id oficial de MisRX para TurnIA.',
      };
    }

    return this.withToken((accessToken) =>
      misRxRequest<MisRxListResponse<MisRxProduct>>({
        path: '/api/productos_seleccion',
        accessToken,
        query: {
          soft_id: this.provider.softId,
          convenio_id: params.convenioId,
          query: params.query,
          afiliado_credencial: params.credential ?? '',
          afiliado_dni: params.dni ?? '',
          autorizacion: params.authorization ?? '',
          plan_id: params.planId ?? 0,
          no_incluye_bajas: params.noIncluyeBajas ?? true,
          verify_exp: false,
        },
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
    payload: Omit<MisRxPrescriptionPayload, 'soft_id'>,
  ): Promise<MisRxApiResult<MisRxPrescriptionResponse>> {
    if (!this.provider.softId) {
      return {
        ok: false,
        reason: 'not_configured',
        errorMessage: 'Falta configurar el soft_id oficial de MisRX para TurnIA.',
      };
    }

    return this.withToken((accessToken) =>
      misRxRequest<MisRxPrescriptionResponse>({
        path: '/api/informa_receta',
        method: 'PUT',
        accessToken,
        appId: this.provider.appId,
        body: {
          ...payload,
          soft_id: this.provider.softId,
        } satisfies MisRxPrescriptionPayload,
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

  async getPlans(params: {
    convenioId?: number;
    affiliateId?: number;
  }): Promise<MisRxApiResult<MisRxListResponse<MisRxPlan>>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxListResponse<MisRxPlan>>({
        path: '/api/planes',
        accessToken,
        query: {
          convenio_id: params.convenioId ?? 0,
          afiliado_id: params.affiliateId ?? 0,
          verify_exp: false,
        },
      }),
    );
  }

  async cancelPrescription(
    payload: Omit<MisRxCancelPrescriptionPayload, 'soft_id'>,
  ): Promise<MisRxApiResult<Record<string, unknown>>> {
    if (!this.provider.softId) {
      return {
        ok: false,
        reason: 'not_configured',
        errorMessage: 'Falta configurar el soft_id oficial de MisRX para TurnIA.',
      };
    }

    return this.withToken((accessToken) =>
      misRxRequest<Record<string, unknown>>({
        path: '/api/anular_receta',
        method: 'DELETE',
        accessToken,
        appId: this.provider.appId,
        body: {
          ...payload,
          soft_id: this.provider.softId,
        } satisfies MisRxCancelPrescriptionPayload,
        query: { verify_exp: false },
      }),
    );
  }
}
