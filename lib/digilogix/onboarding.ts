import 'server-only';

import { digilogixPost } from './client';
import type {
  DigilogixOnboardingRequest,
  DigilogixRegistrationRequest,
  DigilogixSimpleResponse,
} from './types';

export function beginDigilogixUserRegistration(body: DigilogixRegistrationRequest) {
  return digilogixPost<DigilogixSimpleResponse>(
    '/FirmaDigital/PostIniciarRegistracionUsuario',
    body,
  );
}

export function beginDigilogixPersonOnboarding(body: DigilogixOnboardingRequest) {
  return digilogixPost<DigilogixSimpleResponse>(
    '/FirmaDigital/PostIniciarOnboardingPersonaFisica',
    body,
  );
}
