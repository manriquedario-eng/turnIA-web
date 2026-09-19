import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
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

export async function POST(request: Request) {
  const { supabase, user, tenantId } = await requireTenant();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'La transcripción por voz todavía no está configurada en el servidor.' },
      { status: 503 },
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

  if (!(audio instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo de audio.' }, { status: 400 });
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 900) {
    return NextResponse.json({ error: 'Duración de audio inválida.' }, { status: 400 });
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

  if (Number(account.balance_seconds ?? 0) < durationSeconds) {
    return NextResponse.json(
      { error: 'No tenés minutos de transcripción disponibles.' },
      { status: 402 },
    );
  }

  if (audio.size <= 0 || audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'El audio está vacío o supera el límite permitido.' }, { status: 400 });
  }

  const mime = audio.type.split(';')[0].toLowerCase();
  if (mime && !ALLOWED_TYPES.has(mime)) {
    return NextResponse.json({ error: 'Formato de audio no compatible.' }, { status: 415 });
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
      // No devolver el cuerpo completo del proveedor ni registrar audio/texto
      // clínico. La UI sólo necesita saber que falló la transcripción.
      return NextResponse.json(
        { error: 'No se pudo transcribir la nota en este momento.' },
        { status: 502 },
      );
    }

    const result = await response.json() as { text?: string };
    const text = typeof result.text === 'string' ? result.text.trim() : '';

    if (!text) {
      return NextResponse.json(
        { error: 'No se detectó voz suficiente para generar una transcripción.' },
        { status: 422 },
      );
    }

    const { data: consumed, error: consumeError } = await supabase.rpc(
      'consume_ai_transcription_seconds',
      {
        p_tenant_id: tenantId,
        p_professional_id: user.id,
        p_seconds: durationSeconds,
      },
    );

    if (consumeError || consumed !== true) {
      return NextResponse.json(
        { error: 'La nota fue transcripta, pero no pudimos registrar el consumo. Volvé a intentar.' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { text, consumed_seconds: durationSeconds },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'No se pudo conectar con el servicio de transcripción.' },
      { status: 502 },
    );
  }
}
