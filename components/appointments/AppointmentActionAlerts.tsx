'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

type AppointmentActionAlert = {
  id: string;
  action: 'confirm' | 'cancel' | 'reschedule';
  title: string;
  description: string;
  created_at: string;
  href: string;
};

const DISMISSED_KEY = 'turnia:dismissed-appointment-action-alerts';

function readDismissed() {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set<string>(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids).slice(-200)));
  } catch {
    // La alerta visual sigue funcionando aunque localStorage no esté disponible.
  }
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function AppointmentActionAlerts() {
  const [active, setActive] = useState<AppointmentActionAlert | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundedRef = useRef(new Set<string>());

  useEffect(() => {
    const unlock = async () => {
      try {
        const AudioCtx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = audioContextRef.current ?? new AudioCtx();
        audioContextRef.current = ctx;
        if (ctx.state === 'suspended') await ctx.resume();
      } catch {
        // El aviso visual no depende del sonido.
      }
    };

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const playSound = useCallback(async (id: string) => {
    if (soundedRef.current.has(id)) return;
    soundedRef.current.add(id);

    try {
      const AudioCtx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = audioContextRef.current ?? new AudioCtx();
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      if (ctx.state !== 'running') return;

      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      gain.connect(ctx.destination);

      [0, 0.2].forEach((offset) => {
        const oscillator = ctx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(760, now + offset);
        oscillator.connect(gain);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.13);
      });
    } catch {
      // Silencioso: el popup sigue siendo la señal principal.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const response = await fetch('/api/appointment-action-alerts/pending', { cache: 'no-store' });
        if (!response.ok || cancelled) return;

        const payload = await response.json() as { alerts?: AppointmentActionAlert[] };
        const dismissed = readDismissed();
        const next = (payload.alerts ?? []).find((alert) => !dismissed.has(alert.id)) ?? null;

        setActive((current) => current?.id === next?.id ? current : next);
        if (next) void playSound(next.id);
      } catch {
        // Nunca interferir con la navegación de TurnIA.
      }
    };

    void check();
    const interval = window.setInterval(check, 5000);
    window.addEventListener('focus', check);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', check);
    };
  }, [playSound]);

  function dismiss() {
    if (!active) return;
    const dismissed = readDismissed();
    dismissed.add(active.id);
    saveDismissed(dismissed);
    setActive(null);
  }

  if (!active) return null;

  return (
    <div
      className={`reminder-alert appointment-action-alert is-${active.action}`}
      role="alertdialog"
      aria-live="assertive"
      aria-label={active.title}
    >
      <div className="reminder-alert-pulse" aria-hidden="true" />
      <div className="reminder-alert-content">
        <div className="reminder-alert-eyebrow">Turno · Acción del paciente</div>
        <div className="reminder-alert-title">{active.title}</div>
        <div className="reminder-alert-description">{active.description}</div>
        <div className="reminder-alert-time">{formatWhen(active.created_at)}</div>
      </div>
      <div className="reminder-alert-actions">
        <Link className="btn secondary" href={active.href} onClick={dismiss}>Ver turno</Link>
        <button type="button" className="btn" onClick={dismiss}>Entendido</button>
      </div>
    </div>
  );
}
