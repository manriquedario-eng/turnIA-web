'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  name: string;
  label: string;
  rows?: number;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
};

function preferredMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function fileExtension(mimeType: string) {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

export function VoiceTranscriptionTextarea({
  name,
  label,
  rows = 5,
  required = false,
  minLength,
  maxLength,
  placeholder,
}: Props) {
  const [value, setValue] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const available =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined';
    setSupported(available);

    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function transcribe(blob: Blob, mimeType: string, durationSeconds: number) {
    setTranscribing(true);
    setError('');

    try {
      const extension = fileExtension(mimeType);
      const file = new File([blob], `nota-turnia.${extension}`, {
        type: mimeType || 'audio/webm',
      });
      const form = new FormData();
      form.append('audio', file);
      form.append('duration_seconds', String(Math.max(1, Math.min(900, Math.ceil(durationSeconds)))));

      const response = await fetch('/api/transcription', {
        method: 'POST',
        body: form,
        cache: 'no-store',
      });

      const payload = await response.json().catch(() => ({})) as { text?: string; error?: string };

      if (!response.ok || !payload.text) {
        setError(payload.error || 'No se pudo transcribir la nota.');
        return;
      }

      const base = value.trim();
      const next = [base, payload.text.trim()].filter(Boolean).join(base ? '\n' : '');
      setValue(next);
    } catch {
      setError('No se pudo enviar el audio para transcribir.');
    } finally {
      setTranscribing(false);
    }
  }

  async function startRecording() {
    setError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = preferredMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        setError('Se produjo un error mientras se grababa la nota.');
      };

      recorder.onstop = () => {
        const elapsedSeconds = startedAtRef.current
          ? Math.max(1, Math.ceil((Date.now() - startedAtRef.current) / 1000))
          : 1;
        startedAtRef.current = null;
        if (timerRef.current != null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const actualType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: actualType });

        chunksRef.current = [];
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        setSeconds(0);

        if (blob.size > 0) void transcribe(blob, actualType, elapsedSeconds);
        else setError('No se capturó audio. Volvé a intentar.');
      };

      recorder.start(250);
      startedAtRef.current = Date.now();
      setSeconds(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        setSeconds((current) => {
          const next = current + 1;
          if (next >= 900 && recorder.state !== 'inactive') {
            recorder.stop();
          }
          return next;
        });
      }, 1000);
    } catch (permissionError) {
      const errorName = permissionError instanceof DOMException ? permissionError.name : '';
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        setError('El sistema no permitió abrir el micrófono. Verificá que Chrome tenga acceso al dispositivo.');
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setError('No se encontró ningún micrófono disponible.');
      } else {
        setError('No se pudo abrir el micrófono.');
      }
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
  }

  function toggleRecording() {
    if (transcribing) return;
    if (recording) stopRecording();
    else void startRecording();
  }

  return (
    <div className="voice-note-field">
      <div className="voice-note-label-row">
        <label htmlFor={`voice-note-${name}`}>{label}</label>
        <button
          type="button"
          className={`voice-note-button ${recording ? 'is-listening' : ''}`}
          onClick={toggleRecording}
          disabled={!supported || transcribing}
          aria-pressed={recording}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Zm-6-3.75a.75.75 0 0 1 1.5 0 4.5 4.5 0 0 0 9 0 .75.75 0 0 1 1.5 0 6 6 0 0 1-5.25 5.95V20h2.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.5v-3.3A6 6 0 0 1 6 10.75Z" />
          </svg>
          {transcribing ? 'Transcribiendo…' : recording ? `Detener · ${seconds}s` : 'Dictar nota'}
        </button>
      </div>

      <textarea
        id={`voice-note-${name}`}
        name={name}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        style={{ width: '100%' }}
      />

      <div className="voice-note-help">
        {recording ? (
          <span className="voice-note-status"><span className="voice-note-dot" /> Grabando… tocá “Detener” cuando termines.</span>
        ) : transcribing ? (
          <span>Procesando la nota y convirtiéndola a texto…</span>
        ) : supported ? (
          <span>TurnIA usa el audio sólo para transcribir esta nota y conserva únicamente el texto.</span>
        ) : (
          <span>La grabación de voz no está disponible en este navegador.</span>
        )}
      </div>

      {error ? <p className="field-hint is-warning" role="alert">{error}</p> : null}
    </div>
  );
}
