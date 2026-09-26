'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isEmailAllowedForSignup, validateRegistrationInput } from '@/lib/auth/registration';

function getAppUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (!raw) {
    throw new Error('APP_URL no está configurada');
  }

  const url = new URL(raw);
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('APP_URL debe usar HTTPS en producción');
  }

  return url.origin;
}

export async function signup(formData: FormData) {
  if (process.env.SIGNUP_ENABLED !== 'true') {
    redirect('/signup?error=registration_closed');
  }

  const validated = validateRegistrationInput({
    displayName: String(formData.get('display_name') ?? ''),
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });

  if (!validated.ok) {
    redirect(`/signup?error=${validated.error}`);
  }

  if (!isEmailAllowedForSignup(validated.email, process.env.SIGNUP_ALLOWED_EMAILS)) {
    redirect('/signup?error=not_invited');
  }

  let emailRedirectTo: string;
  try {
    emailRedirectTo = new URL('/auth/confirm', getAppUrl()).toString();
  } catch {
    redirect('/signup?error=server_configuration');
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: validated.email,
    password: validated.password,
    options: {
      emailRedirectTo,
      data: {
        display_name: validated.displayName,
      },
    },
  });

  if (error) {
    console.error('Signup failed', {
      code: error.code,
      status: error.status,
    });
    redirect('/signup?error=signup_failed');
  }

  // Fail closed: con Confirm Email correctamente habilitado, Supabase NO
  // devuelve una sesión en el alta. Si aparece una sesión, el entorno está
  // auto-confirmando emails y no cumple la política de TurnIA.
  if (data.session) {
    await supabase.auth.signOut();
    console.error('Signup blocked because email confirmation is disabled in Supabase Auth');
    redirect('/signup?error=server_configuration');
  }

  redirect(`/signup/check-email?email=${encodeURIComponent(validated.email)}`);
}
