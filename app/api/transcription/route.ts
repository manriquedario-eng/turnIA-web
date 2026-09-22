import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MIN_RESERVATION_SECONDS = 30;
const MAX_DICTATION_SECONDS = 5 * 60;
const TRANSCRIPTION_WINDOW_SECONDS = 15 * 60;
const TRANSCRIPTION_USER_MAX = 20;
const TRANSCRIPTION_TENANT_MAX = 30;

const ALLOWED_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/flac',
]);

type OpenAiTranscriptionResponse = {
  text?: string;
  duration?: number;
  usage?: {
    seconds?: number;
    [key: string]: unknown;
  };
};

function normalizeDictationSeconds(value: number): number {
  return Math.max(1, Math.ceil(value));
}

export async function POST(request: Request) {
  const { supabase, user, tenantId } = await requireTenant();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'La transcripción por voz todavía no está configurada en el servidor.' },
      { status: 503 },
    );
  }

  const [userLimit, tenantLimit] = await Promise.all([
    checkRateLimit({
      scope: 'transcription-professional',
      key: user.id,
      windowSeconds: TRANSCRIPTION_WINDOW_SECONDS,
      maxCount: TRANSCRIPTION_USER_MAX,
    }),
    checkRateLimit({
      scope: 'transcription-tenant',
      key: tenantId,
      windowSeconds: TRANSCRIPTION_WINDOW_SECONDS,
      maxCount: TRANSCRIPTION_TENANT_MAX,
    }),
  ]);

  if (!userLimit.allowed || !tenantLimit.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas transcripciones en poco tiempo. Probá nuevamente en unos minutos.' },
      { status: 429 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el audio recibido.' }, { status: 400 });
  }

  const audio = formData.get('audio');
  const durationRaw = formData.get('duration_seconds');
  const durationSeconds = Math.ceil(Number(durationRaw));
  const usageContextRaw = formData.get('usage_context');
  const usageContext =
    usageContextRaw === 'session' || usageContextRaw === 'follow_up'
      ? usageContextRaw
      : 'other';

  const patientIdRaw = formData.get('patient_id');
  const patientIdValue =
    typeof patientIdRaw === 'string' && patientIdRaw.trim() ? patientIdRaw.trim() : null;
  const patientIdParsed = patientIdValue
    ? z.string().uuid().safeParse(patientIdValue)
    : null;

  if (!(audio instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo de audio.' }, { status: 400 });
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > MAX_DICTATION_SECONDS) {
    return NextResponse.json(
      { error: 'El dictado puede durar como máximo 5 minutos.' },
      { status: 400 },
    );
  }

  if (patientIdParsed && !patientIdParsed.success) {
    return NextResponse.json({ error: 'Paciente inválido.' }, { status: 400 });
  }

  const patientId = patientIdParsed?.success ? patientIdParsed.data : null;

  if ((usageContext === 'session' || usageContext === 'follow_up') && !patientId) {
    return NextResponse.json({ error: 'Falta identificar al paciente.' }, { status: 400 });
  }

  if (patientId) {
    const { data: patient, error: patientError } = await supabase
      .from('patients')
      .select('id')
      .eq('id', patientId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (patientError || !patient) {
      return NextResponse.json({ error: 'Paciente no disponible.' }, { status: 404 });
    }
  }

  if (audio.size <= 0 || audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'El audio está vacío o supera el límite permitido.' }, { status: 400 });
  }

  const mime = audio.type.split(';')[0].toLowerCase();
  if (mime && !ALLOWED_TYPES.has(mime)) {
    return NextResponse.json({ error: 'Formato de audio no compatible.' }, { status: 415 });
  }

  const { data: account, error: accountError } = await supabase
    .from('ai_transcription_accounts')
    .select('enabled,balance_seconds')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (accountError) {
    return NextResponse.json(
      { error: 'El control de Transcripción IA todavía no está habilitado en este entorno.' },
      { status: 503 },
    );
  }

  if (!account?.enabled) {
    return NextResponse.json(
      { error: 'La Transcripción IA está desactivada. Podés activarla desde Configuración.' },
      { status: 403 },
    );
  }

  const reservationSeconds = normalizeDictationSeconds(Math.max(durationSeconds, MIN_RESERVATION_SECONDS));

  if (Number(account.balance_seconds ?? 0) < reservationSeconds) {
    return NextResponse.json(
      { error: 'No tenés minutos de transcripción disponibles.' },
      { status: 402 },
    );
  }

  const { data: reservationId, error: reserveError } = await supabase.rpc(
    'reserve_ai_transcription_seconds',
    {
      p_tenant_id: tenantId,
      p_professional_id: user.id,
      p_seconds: reservationSeconds,
      p_usage_context: usageContext,
      p_patient_id: patientId,
    },
  );

  if (reserveError || typeof reservationId !== 'string') {
    return NextResponse.json(
      { error: 'No pudimos reservar los minutos necesarios para esta transcripción.' },
      { status: 409 },
    );
  }

  async function refundReservation() {
    try {
      await supabase.rpc('refund_ai_transcription_reservation', {
        p_reservation_id: reservationId,
        p_tenant_id: tenantId,
        p_professional_id: user.id,
      });
    } catch {
      // Best effort. The reservation remains auditable if the refund fails.
    }
  }

  const upstream = new FormData();
  upstream.append('file', audio, audio.name || 'nota.webm');
  upstream.append('model', 'gpt-4o-mini-transcribe');
  upstream.append('language', 'es');

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: upstream,
      cache: 'no-store',
    });

    if (!response.ok) {
      await refundReservation();
      return NextResponse.json(
        { error: 'No se pudo transcribir la nota en este momento.' },
        { status: 502 },
      );
    }

    const result = (await response.json()) as OpenAiTranscriptionResponse;
    const text = typeof result.text === 'string' ? result.text.trim() : '';

    const providerSecondsRaw =
      typeof result.usage?.seconds === 'number'
        ? result.usage.seconds
        : typeof result.duration === 'number'
          ? result.duration
          : durationSeconds;

    const actualSeconds = normalizeDictationSeconds(providerSecondsRaw);

    const { data: settled, error: settleError } = await supabase.rpc(
      'settle_ai_transcription_reservation',
      {
        p_reservation_id: reservationId,
        p_tenant_id: tenantId,
        p_professional_id: user.id,
        p_actual_seconds: actualSeconds,
      },
    );

    if (settleError || settled !== true) {
      return NextResponse.json(
        { error: 'La nota fue procesada, pero no pudimos conciliar correctamente el consumo. Volvé a intentar.' },
        { status: 409 },
      );
    }

    if (!text) {
      return NextResponse.json(
        { error: 'No se detectó voz suficiente para generar una transcripción.' },
        { status: 422 },
      );
    }

    return NextResponse.json(
      { text, consumed_seconds: actualSeconds },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch {
    await refundReservation();
    return NextResponse.json(
      { error: 'No se pudo conectar con el servicio de transcripción.' },
      { status: 502 },
    );
  }
}
