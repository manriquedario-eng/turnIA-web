'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { validateRegistrationInput } from '@/lib/auth/registration';

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
  const validated = validateRegistrationInput({
    displayName: String(formData.get('display_name') ?? ''),
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });

  if (!validated.ok) {
    redirect(`/signup?error=${validated.error}`);
  }

  let emailRedirectTo: string;
  try {
    emailRedirectTo = new URL('/auth/confirm', getAppUrl()).toString();
  } catch {
    redirect('/signup?error=server_configuration');
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
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

  redirect(`/signup/check-email?email=${encodeURIComponent(validated.email)}`);
}
