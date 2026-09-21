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
  MisRxCancelPrescriptionResponse,
  MisRxExternalPrescriptionList,
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
    dni?: number;
    authorization?: number;
    planId?: number;
    monodrogaId?: number;
    formaFarmaId?: number;
    noIncluyeBajas?: number;
    productoId?: number;
  }): Promise<MisRxApiResult<MisRxListResponse<MisRxProduct>>> {
    const softId = this.provider.softId;
    if (!softId) {
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
          soft_id: softId,
          convenio_id: params.convenioId,
          query: params.query,
          afiliado_credencial: params.credential ?? '',
          afiliado_dni: params.dni ?? 0,
          autorizacion: params.authorization ?? 0,
          plan_id: params.planId ?? 0,
          monodroga_id: params.monodrogaId ?? 0,
          forma_farma_id: params.formaFarmaId ?? 0,
          no_incluye_bajas: params.noIncluyeBajas ?? 0,
          producto_id: params.productoId ?? 0,
          verify_exp: false,
        },
      }),
    );
  }

  async searchDiagnoses(params: {
    query: string;
    value?: number;
  }): Promise<MisRxApiResult<MisRxListResponse<MisRxDiagnosis>>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxListResponse<MisRxDiagnosis>>({
        path: '/api/diagnosticos_ci10',
        accessToken,
        query: {
          query: params.query,
          valor: params.value ?? 0,
          verify_exp: false,
        },
      }),
    );
  }

  async issuePrescription(
    payload: Omit<MisRxPrescriptionPayload, 'soft_id'>,
  ): Promise<MisRxApiResult<MisRxPrescriptionResponse>> {
    const softId = this.provider.softId;
    if (!softId) {
      return {
        ok: false,
        reason: 'not_configured',
        errorMessage: 'Falta configurar el soft_id oficial de MisRX para TurnIA.',
      };
    }

    return this.withToken((accessToken) =>
      misRxRequest<MisRxPrescriptionResponse>({
        path: '/api/informa_prescripcion',
        method: 'PUT',
        accessToken,
        body: {
          ...payload,
          soft_id: softId,
        } satisfies MisRxPrescriptionPayload,
        query: { verify_exp: false },
      }),
    );
  }

  async listPrescriptions(params: {
    convenioId: number;
    page?: number;
    filter?: string;
  }): Promise<MisRxApiResult<MisRxExternalPrescriptionList>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxExternalPrescriptionList>({
        path: '/api/prescripciones',
        accessToken,
        query: {
          convenio_id: params.convenioId,
          page: params.page ?? 0,
          filtro: params.filter ?? '',
          verify_exp: false,
        },
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
  ): Promise<MisRxApiResult<MisRxCancelPrescriptionResponse>> {
    const softId = this.provider.softId;
    if (!softId) {
      return {
        ok: false,
        reason: 'not_configured',
        errorMessage: 'Falta configurar el soft_id oficial de MisRX para TurnIA.',
      };
    }

    return this.withToken((accessToken) =>
      misRxRequest<MisRxCancelPrescriptionResponse>({
        path: '/api/anular_prescripcion',
        method: 'DELETE',
        accessToken,
        appId: this.provider.appId,
        body: {
          ...payload,
          soft_id: softId,
        } satisfies MisRxCancelPrescriptionPayload,
        query: { verify_exp: false },
      }),
    );
  }
}
