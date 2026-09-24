import 'server-only';

import { digilogixPost } from './client';
import type {
  DigilogixOnboardingRequest,
  DigilogixOnboardingResponse,
  DigilogixRegistrationRequest,
  DigilogixRegistrationResponse,
} from './types';

export function beginDigilogixUserRegistration(body: DigilogixRegistrationRequest) {
  return digilogixPost<DigilogixRegistrationResponse>(
    '/FirmaDigital/PostIniciarRegistracionUsuario',
    body,
  );
}

export function beginDigilogixPersonOnboarding(body: DigilogixOnboardingRequest) {
  return digilogixPost<DigilogixOnboardingResponse>(
    '/FirmaDigital/PostIniciarOnboardingPersonaFisica',
    body,
  );
}
