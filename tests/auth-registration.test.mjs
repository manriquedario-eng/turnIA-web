import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistrationInput } from '../lib/auth/registration.ts';

test('normalizes valid registration input', () => {
  assert.deepEqual(
    validateRegistrationInput({
      email: '  Test.User@Example.com ',
      password: '1234567890',
      displayName: '  Ana   Pérez  ',
    }),
    {
      ok: true,
      email: 'test.user@example.com',
      password: '1234567890',
      displayName: 'Ana Pérez',
    },
  );
});

test('rejects weak passwords', () => {
  assert.equal(
    validateRegistrationInput({
      email: 'ana@example.com',
      password: 'short',
      displayName: 'Ana Pérez',
    }).ok,
    false,
  );
});

test('rejects malformed emails and names', () => {
  assert.equal(
    validateRegistrationInput({
      email: 'not-an-email',
      password: '1234567890',
      displayName: 'A',
    }).ok,
    false,
  );
});
