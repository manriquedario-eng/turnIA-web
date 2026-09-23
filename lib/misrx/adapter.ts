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
  MisRxSessionTestResponse,
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

  async testSession(): Promise<MisRxApiResult<MisRxSessionTestResponse>> {
    return this.withToken((accessToken) =>
      misRxRequest<MisRxSessionTestResponse>({
        path: '/test',
        accessToken,
      }),
    );
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


  async verifyExternalProvider(): Promise<MisRxApiResult<{
    usuarioId?: number;
    propioId?: number;
    roles?: string;
  }>> {
    const login = await loginToMisRx(this.credentials);
    if (!login.ok) {
      console.warn('[misrx] external provider login failed', {
        reason: login.reason,
        status: login.status ?? null,
      });
      return login;
    }

    const accountType = Number(login.data.tipo);
    if (accountType !== 3) {
      console.warn('[misrx] external provider account type rejected', {
        accountType: Number.isFinite(accountType) ? accountType : null,
        usuarioId: login.data.usuario_id ?? null,
        propioId: login.data.propio_id ?? null,
      });
      return {
        ok: false,
        reason: 'unauthorized',
        status: 403,
        errorMessage: Number.isFinite(accountType)
          ? `MisRX autenticó la cuenta, pero informó tipo de usuario ${accountType}; para prestador externo debe ser tipo 3.`
          : 'MisRX autenticó la cuenta, pero no informó un tipo de usuario válido para prestador externo.',
      };
    }

    return {
      ok: true,
      data: {
        usuarioId: login.data.usuario_id,
        propioId: login.data.propio_id,
        roles: login.data.roles,
      },
    };
  }

  async verifyPrescriber(): Promise<MisRxApiResult<{
    profile: MisRxProfessionalProfile;
    usuarioId?: number;
    propioId?: number;
    roles?: string;
  }>> {
    const login = await loginToMisRx(this.credentials);
    if (!login.ok) return login;

    if (Number(login.data.tipo) !== 3) {
      return {
        ok: false,
        reason: 'unauthorized',
        status: 403,
        errorMessage: 'La cuenta MisRX conectada no corresponde a un prestador externo habilitable para prescribir.',
      };
    }

    const profileResult = await misRxRequest<MisRxProfessionalProfile>({
      path: '/usuario/perfil',
      accessToken: login.data.access_token,
      query: { verify_exp: false },
    });

    if (!profileResult.ok) return profileResult;

    const profile = profileResult.data;
    const validProfessionalIdentity = Boolean(
      Number(profile.nrodoc) > 0 &&
      profile.tipo_matricula?.trim() &&
      Number(profile.matricula) > 0 &&
      Number(profile.especialidad_id) > 0
    );

    if (!validProfessionalIdentity) {
      return {
        ok: false,
        reason: 'unauthorized',
        status: 403,
        errorMessage: 'MisRX autenticó la cuenta, pero no devolvió una identidad profesional completa con DNI, matrícula y especialidad.',
      };
    }

    return {
      ok: true,
      data: {
        profile,
        usuarioId: login.data.usuario_id,
        propioId: login.data.propio_id,
        roles: login.data.roles,
      },
    };
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
          afiliado_credencial: params.credential,
          afiliado_dni: params.dni,
          autorizacion: params.authorization,
          plan_id: params.planId,
          monodroga_id: params.monodrogaId,
          forma_farma_id: params.formaFarmaId,
          no_incluye_bajas: params.noIncluyeBajas,
          producto_id: params.productoId,
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
          valor: params.value,
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
        body: {
          ...payload,
          soft_id: softId,
        } satisfies MisRxCancelPrescriptionPayload,
        query: { verify_exp: false },
      }),
    );
  }
}
