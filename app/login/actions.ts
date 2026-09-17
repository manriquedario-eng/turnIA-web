'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';

// Rate limiting Fase 2 — SOLO login (PARTE de la pasada de hardening).
// Dos límites complementarios cuando hay IP resoluble:
//   - login-ip-email: cuenta puntual detrás de una IP puntual — el que
//     protege más directamente contra fuerza bruta sobre una cuenta.
//   - login-ip: toda una IP contra cualquier cuenta — protege contra
//     credential stuffing (probar muchos emails distintos desde la misma
//     IP), que login-ip-email solo no cubriría.
// Cuando NO hay IP resoluble, ver el bloque `else` de abajo — nunca cae en
// una key global compartida por todo el tráfico sin IP.
const LOGIN_IP_EMAIL_SCOPE = 'login-ip-email';
const LOGIN_IP_EMAIL_WINDOW_SECONDS = 300; // 5 minutos
const LOGIN_IP_EMAIL_MAX_ATTEMPTS = 5;

const LOGIN_IP_SCOPE = 'login-ip';
const LOGIN_IP_WINDOW_SECONDS = 900; // 15 minutos
const LOGIN_IP_MAX_ATTEMPTS = 20;

// Scope propio y separado de LOGIN_IP_EMAIL_SCOPE — a propósito nunca
// comparte namespace ni contador con el caso "con IP", para que ninguna key
// pueda colisionar entre ambas ramas (ver checkRateLimit en
// lib/rate-limit.ts: el HMAC ya namespacea por `scope`, pero el nombre
// también se elige distinto acá por claridad).
const LOGIN_EMAIL_NOIP_SCOPE = 'login-email-noip';
const LOGIN_EMAIL_NOIP_WINDOW_SECONDS = 300; // 5 minutos
const LOGIN_EMAIL_NOIP_MAX_ATTEMPTS = 5;

export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) redirect('/login?error=missing_credentials');

  // Normalización SOLO para las keys de rate limiting (trim + lowercase).
  // No cambia qué se le manda a Supabase Auth más abajo, y nunca se loguea
  // en ningún punto de este archivo.
  const normalizedEmail = email.toLowerCase();
  const ip = await getClientIp();

  // Rate limiting ANTES de tocar Supabase Auth: si cualquiera de los
  // limitadores aplicables deniega, ni siquiera se llama a
  // signInWithPassword. La redirección es la MISMA sin importar cuál de los
  // límites se excedió (cuenta+IP, IP global, o email sin IP) — no se
  // filtra esa distinción a quien está intentando loguearse.
  if (ip) {
    const [byIpEmail, byIp] = await Promise.all([
      checkRateLimit({
        scope: LOGIN_IP_EMAIL_SCOPE,
        key: `${ip}:${normalizedEmail}`,
        windowSeconds: LOGIN_IP_EMAIL_WINDOW_SECONDS,
        maxCount: LOGIN_IP_EMAIL_MAX_ATTEMPTS,
      }),
      checkRateLimit({
        scope: LOGIN_IP_SCOPE,
        key: ip,
        windowSeconds: LOGIN_IP_WINDOW_SECONDS,
        maxCount: LOGIN_IP_MAX_ATTEMPTS,
      }),
    ]);

    if (!byIpEmail.allowed || !byIp.allowed) {
      redirect('/login?error=too_many_attempts');
    }
  } else {
    // Sin IP resoluble (ver getClientIp() en lib/request-ip.ts para cuándo
    // puede pasar esto): a propósito NO existe un balde global tipo
    // 'unknown' compartido por todo el tráfico sin IP — eso permitiría que
    // cualquiera agote el límite de todos los demás con solo no mandar esos
    // headers. En su lugar, se aplica únicamente el límite por email, en un
    // scope separado (LOGIN_EMAIL_NOIP_SCOPE) que nunca comparte contador
    // con la rama que sí tiene IP.
    const byEmailNoIp = await checkRateLimit({
      scope: LOGIN_EMAIL_NOIP_SCOPE,
      key: normalizedEmail,
      windowSeconds: LOGIN_EMAIL_NOIP_WINDOW_SECONDS,
      maxCount: LOGIN_EMAIL_NOIP_MAX_ATTEMPTS,
    });

    if (!byEmailNoIp.allowed) {
      redirect('/login?error=too_many_attempts');
    }
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) redirect('/login?error=invalid_credentials');
  redirect('/dashboard');
}

export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
