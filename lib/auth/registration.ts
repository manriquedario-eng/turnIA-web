export type RegistrationInput =
  | { ok: true; email: string; password: string; displayName: string }
  | { ok: false; error: 'missing_fields' | 'invalid_email' | 'weak_password' | 'invalid_name' };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRegistrationInput(params: {
  email: string;
  password: string;
  displayName: string;
}): RegistrationInput {
  const email = params.email.trim().toLowerCase();
  const password = params.password;
  const displayName = params.displayName.trim().replace(/\s+/g, ' ');

  if (!email || !password || !displayName) {
    return { ok: false, error: 'missing_fields' };
  }

  if (!EMAIL_REGEX.test(email) || email.length > 254) {
    return { ok: false, error: 'invalid_email' };
  }

  if (password.length < 10 || password.length > 128) {
    return { ok: false, error: 'weak_password' };
  }

  if (displayName.length < 2 || displayName.length > 120) {
    return { ok: false, error: 'invalid_name' };
  }

  return { ok: true, email, password, displayName };
}
