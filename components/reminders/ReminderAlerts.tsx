'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

type Reminder = {
  id: string;
  title: string;
  description: string | null;
  remind_at: string;
  status: string;
};

const DISMISSED_KEY = 'turnia:dismissed-reminder-alerts';

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
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids).slice(-100)));
  } catch {
    // El aviso visual sigue funcionando aunque localStorage no esté disponible.
  }
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function ReminderAlerts() {
  const [active, setActive] = useState<Reminder | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundUnlockedRef = useRef(false);
  const notifiedRef = useRef(new Set<string>());

  useEffect(() => {
    if ('Notification' in window) setNotificationPermission(Notification.permission);

    const unlock = async () => {
      try {
        const AudioCtx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = audioContextRef.current ?? new AudioCtx();
        audioContextRef.current = ctx;
        if (ctx.state === 'suspended') await ctx.resume();
        soundUnlockedRef.current = ctx.state === 'running';
      } catch {
        // El aviso visual es la garantía principal; el sonido es complementario.
      }
    };

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const playSound = useCallback(async () => {
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
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
      gain.connect(ctx.destination);

      [0, 0.24].forEach((offset) => {
        const oscillator = ctx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, now + offset);
        oscillator.connect(gain);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.16);
      });
    } catch {
      // No bloquear ni romper la UI si el browser decide impedir autoplay.
    }
  }, []);

  const maybeNotify = useCallback(async (reminder: Reminder) => {
    if (notifiedRef.current.has(reminder.id)) return;
    notifiedRef.current.add(reminder.id);

    await playSound();

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('TurnIA · Recordatorio', {
          body: reminder.description ? `${reminder.title} — ${reminder.description}` : reminder.title,
          tag: `turnia-reminder-${reminder.id}`,
        });
      } catch {
        // La alerta dentro de TurnIA permanece visible.
      }
    }
  }, [playSound]);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const response = await fetch('/api/reminders/pending', { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const payload = await response.json() as { reminders?: Reminder[] };
        const now = Date.now();
        const dismissed = readDismissed();
        const due = (payload.reminders ?? []).find(
          (reminder) => new Date(reminder.remind_at).getTime() <= now && !dismissed.has(reminder.id),
        );

        if (due) {
          setActive((current) => current?.id === due.id ? current : due);
          void maybeNotify(due);
        } else {
          setActive(null);
        }
      } catch {
        // Silencioso: no debe interferir con la navegación de TurnIA.
      }
    };

    void check();
    const interval = window.setInterval(check, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [maybeNotify]);

  function dismiss() {
    if (!active) return;
    const dismissed = readDismissed();
    dismissed.add(active.id);
    saveDismissed(dismissed);
    setActive(null);
  }

  async function enableNotifications() {
    if (!('Notification' in window)) return;
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    } catch {
      // La alerta propia de TurnIA sigue disponible.
    }
  }

  if (!active) return null;

  return (
    <div className="reminder-alert" role="alertdialog" aria-live="assertive" aria-label="Recordatorio de TurnIA">
      <div className="reminder-alert-pulse" aria-hidden="true" />
      <div className="reminder-alert-content">
        <div className="reminder-alert-eyebrow">Recordatorio</div>
        <div className="reminder-alert-title">{active.title}</div>
        {active.description ? <div className="reminder-alert-description">{active.description}</div> : null}
        <div className="reminder-alert-time">{formatWhen(active.remind_at)}</div>
      </div>
      <div className="reminder-alert-actions">
        {notificationPermission === 'default' ? (
          <button type="button" className="btn-ghost reminder-alert-notifications" onClick={enableNotifications}>
            Activar notificaciones
          </button>
        ) : null}
        <Link className="btn secondary" href="/reminders">Ver</Link>
        <button type="button" className="btn" onClick={dismiss}>Entendido</button>
      </div>
    </div>
  );
}
