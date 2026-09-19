'use client';

import { useEffect, useRef, useState } from 'react';

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type Props = {
  name: string;
  label: string;
  rows?: number;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
};

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
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const committedValueRef = useRef('');
  const microphonePermissionRef = useRef<PermissionState | 'unknown'>('unknown');

  useEffect(() => {
    let permissionStatus: PermissionStatus | null = null;

    void (async () => {
      try {
        if (navigator.permissions?.query) {
          permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          microphonePermissionRef.current = permissionStatus.state;

          const syncPermission = () => {
            microphonePermissionRef.current = permissionStatus?.state ?? 'unknown';
            if (permissionStatus?.state === 'granted') {
              setError((current) =>
                current.includes('permiso') || current.includes('bloqueó') ? '' : current,
              );
            }
          };

          permissionStatus.addEventListener('change', syncPermission);
        }
      } catch {
        microphonePermissionRef.current = 'unknown';
      }
    })();

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'es-AR';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalChunk += transcript;
        else interimChunk += transcript;
      }

      if (finalChunk) {
        const base = committedValueRef.current.trim();
        const next = [base, finalChunk.trim()].filter(Boolean).join(' ');
        committedValueRef.current = next;
        setValue(next);
      } else if (interimChunk) {
        const base = committedValueRef.current.trim();
        setValue([base, interimChunk.trim()].filter(Boolean).join(' '));
      }
    };

    recognition.onerror = (event) => {
      setListening(false);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        if (microphonePermissionRef.current === 'granted') {
          setError('El micrófono está permitido, pero Chrome no pudo iniciar el reconocimiento de voz. Recargá la página y volvé a intentar; si continúa, revisaremos el motor de transcripción.');
        } else {
          setError('Chrome no tiene permiso para usar el micrófono en TurnIA. Abrí los permisos del sitio → Micrófono → Permitir y recargá la página.');
        }
      } else if (event.error === 'no-speech') {
        setError('No se detectó voz. Acercate al micrófono y volvé a intentar.');
      } else if (event.error === 'audio-capture') {
        setError('Chrome no pudo capturar audio del micrófono seleccionado.');
      } else {
        setError('No se pudo continuar con el dictado. Podés escribir la nota manualmente.');
      }
    };

    recognition.onend = () => {
      setListening(false);
      setValue(committedValueRef.current);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
      recognitionRef.current = null;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, []);

  async function toggleDictation() {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    setError('');

    if (listening) {
      recognition.stop();
      setListening(false);
      return;
    }

    // Chrome exige que el permiso del micrófono se solicite desde una acción
    // explícita del usuario. Pedimos acceso primero, soltamos inmediatamente
    // el stream (TurnIA no graba ni conserva audio) y recién después iniciamos
    // SpeechRecognition para convertir la voz en texto.
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador no permite solicitar acceso al micrófono desde TurnIA.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphonePermissionRef.current = 'granted';
      setError('');
      stream.getTracks().forEach((track) => track.stop());
    } catch (permissionError) {
      const name = permissionError instanceof DOMException ? permissionError.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        if (microphonePermissionRef.current === 'granted') {
          setError('Chrome tiene permitido el micrófono para TurnIA, pero Windows o el dispositivo está bloqueando el acceso. Revisá Configuración de Windows → Privacidad y seguridad → Micrófono.');
        } else {
          setError('Chrome no tiene permiso para usar el micrófono en TurnIA. Abrí los permisos del sitio → Micrófono → Permitir y recargá la página.');
        }
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('No se encontró ningún micrófono disponible en este equipo.');
      } else {
        setError('No se pudo acceder al micrófono. Revisá los permisos de Chrome y de Windows.');
      }
      return;
    }

    committedValueRef.current = value.trim();
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError('No se pudo iniciar el dictado. Esperá un instante y volvé a intentar.');
    }
  }

  function handleChange(next: string) {
    setValue(next);
    committedValueRef.current = next;
  }

  return (
    <div className="voice-note-field">
      <div className="voice-note-label-row">
        <label htmlFor={`voice-note-${name}`}>{label}</label>
        <button
          type="button"
          className={`voice-note-button ${listening ? 'is-listening' : ''}`}
          onClick={toggleDictation}
          disabled={!supported}
          aria-pressed={listening}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Zm-6-3.75a.75.75 0 0 1 1.5 0 4.5 4.5 0 0 0 9 0 .75.75 0 0 1 1.5 0 6 6 0 0 1-5.25 5.95V20h2.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.5v-3.3A6 6 0 0 1 6 10.75Z" />
          </svg>
          {listening ? 'Detener dictado' : 'Dictar nota'}
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
        onChange={(event) => handleChange(event.target.value)}
        style={{ width: '100%' }}
      />

      <div className="voice-note-help">
        {listening ? (
          <span className="voice-note-status"><span className="voice-note-dot" /> Escuchando… el texto aparece mientras hablás.</span>
        ) : supported ? (
          <span>TurnIA conserva sólo el texto de la nota; no guarda un archivo de audio.</span>
        ) : (
          <span>El dictado por voz no está disponible en este navegador. Podés escribir la nota normalmente.</span>
        )}
      </div>

      {error ? <p className="field-hint is-warning" role="alert">{error}</p> : null}
    </div>
  );
}
