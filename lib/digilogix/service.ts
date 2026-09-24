import 'server-only';

import { getDigilogixConfig } from './config';
import { beginDigilogixPersonOnboarding } from './onboarding';
import { requestDocumentSignature } from './signing';
import type {
  DigilogixApiResult,
  DigilogixOnboardingResponse,
  DigilogixSignResponse,
} from './types';
import { getDigilogixOnboardingReturnUrls, getDigilogixSigningReturnUrls } from './urls';
import { isValidCuil, normalizeCuil } from './validation';
import { sha256Hex } from '@/lib/documents/hash';

function invalidInput(message: string): DigilogixApiResult<never> {
  return { ok: false, reason: 'invalid_configuration', errorMessage: message };
}

/**
 * Inicia el alta del profesional usando la integración global de TurnIA.
 * El email identifica el onboarding; las credenciales personales, PIN/OTP y
 * cualquier validación de identidad se completan exclusivamente en Digilogix.
 */
export async function startProfessionalDigilogixOnboarding(params: {
  email: string;
  showPaymentStep?: boolean;
}): Promise<DigilogixApiResult<DigilogixOnboardingResponse>> {
  const email = params.email.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return invalidInput('El email del profesional no es válido.');
  }

  const urls = getDigilogixOnboardingReturnUrls();

  return beginDigilogixPersonOnboarding({
    Email: email,
    MostrarPasoPagar: params.showPaymentStep ?? false,
    UrlRedireccionOK: urls.ok,
    UrlRedireccionError: urls.error,
    UrlRedireccionRechazar: urls.rejected,
  });
}

/**
 * Solicita una firma con la cuenta técnica global de TurnIA y señala al
 * profesional únicamente por CUIL. La autorización personal ocurre luego en
 * la URL de Digilogix; TurnIA no recibe el PIN ni la contraseña del firmante.
 */
export async function requestSinglePdfSignature(params: {
  pdf: Buffer;
  cuil: string;
  reason?: string;
  certificateSerial?: string;
  showDocumentWhenAuthorizing?: boolean;
  visibleSignatureTemplate?: 1 | 2 | 3 | 4;
  returnUrls?: { ok: string; error: string; rejected: string };
}): Promise<DigilogixApiResult<DigilogixSignResponse>> {
  const cuil = normalizeCuil(params.cuil);
  if (!isValidCuil(cuil)) {
    return invalidInput('El CUIL del profesional no es válido.');
  }

  if (!params.pdf.length) {
    return invalidInput('El documento a firmar está vacío.');
  }

  const config = getDigilogixConfig();
  if (!config?.companyId) {
    return {
      ok: false,
      reason: 'not_configured',
      errorMessage: 'Falta configurar el identificador de empresa de Digilogix.',
    };
  }

  const urls = params.returnUrls ?? getDigilogixSigningReturnUrls();
  const hash = sha256Hex(params.pdf);

  return requestDocumentSignature({
    DocumentoBase64: params.pdf.toString('base64'),
    HashSHA256Hexadecimal: hash,
    EmpresaID: config.companyId,
    UrlRedireccionOK: urls.ok,
    UrlRedireccionError: urls.error,
    UrlRedireccionRechazar: urls.rejected,
    MostrarDocumentoHashAutorizar: params.showDocumentWhenAuthorizing ?? true,
    Personas: [
      {
        CodigoUnicoIdentificacion: cuil,
        OrdenFirma: 1,
        CuadroVisibleFirma_PlantillaID: params.visibleSignatureTemplate ?? 1,
        RazonFirma: params.reason?.trim() || 'Firma digital de documento clínico',
        CuadroVisibleFirma_Pagina: -1,
        CuadroVisibleFirma_TodasPaginas: false,
        NroSerieCertificado: params.certificateSerial?.trim() || undefined,
      },
    ],
  });
}
