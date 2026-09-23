import 'server-only';

import { digilogixPost } from './client';
import type {
  DigilogixOnboardingRequest,
  DigilogixRegistrationRequest,
  DigilogixUnknownResponse,
} from './types';

export function beginDigilogixUserRegistration(body: DigilogixRegistrationRequest) {
  return digilogixPost<DigilogixUnknownResponse>(
    '/FirmaDigital/PostIniciarRegistracionUsuario',
    body,
  );
}

export function beginDigilogixPersonOnboarding(body: DigilogixOnboardingRequest) {
  return digilogixPost<DigilogixUnknownResponse>(
    '/FirmaDigital/PostIniciarOnboardingPersonaFisica',
    body,
  );
}
