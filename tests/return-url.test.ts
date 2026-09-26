import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendQueryParam,
  appendQueryParams,
  safeAgendaReturnPath,
} from '../lib/navigation/return-url.ts';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';

test('safeAgendaReturnPath accepts only agenda and patient detail routes', () => {
  assert.equal(safeAgendaReturnPath('/agenda'), '/agenda');
  assert.equal(safeAgendaReturnPath('/agenda?view=week'), '/agenda?view=week');
  assert.equal(safeAgendaReturnPath('/agenda#turno-drawer'), '/agenda#turno-drawer');
  assert.equal(safeAgendaReturnPath(`/patients/${PATIENT_ID}`), `/patients/${PATIENT_ID}`);
  assert.equal(
    safeAgendaReturnPath(`/patients/${PATIENT_ID}?tab=turnos#turno-drawer`),
    `/patients/${PATIENT_ID}?tab=turnos#turno-drawer`,
  );

  assert.equal(safeAgendaReturnPath('/agenda-evil'), '/agenda');
  assert.equal(safeAgendaReturnPath('/patients/not-a-uuid'), '/agenda');
  assert.equal(safeAgendaReturnPath('https://evil.example/agenda'), '/agenda');
});

test('appendQueryParam chooses ? or & and preserves fragments', () => {
  assert.equal(appendQueryParam('/agenda', 'ok', 'Turno creado'), '/agenda?ok=Turno+creado');
  assert.equal(
    appendQueryParam('/agenda?view=week', 'error', 'Turno inválido'),
    '/agenda?view=week&error=Turno+inv%C3%A1lido',
  );
  assert.equal(
    appendQueryParam('/agenda#turno-drawer', 'ok', 'Listo'),
    '/agenda?ok=Listo#turno-drawer',
  );
});

test('appendQueryParams can replace the fragment for drawer navigation', () => {
  const params = new URLSearchParams({ error: 'Conflicto', edit: PATIENT_ID });
  assert.equal(
    appendQueryParams('/agenda?view=day#old', params, '#turno-drawer'),
    `/agenda?view=day&error=Conflicto&edit=${PATIENT_ID}#turno-drawer`,
  );
});
