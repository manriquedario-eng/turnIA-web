'use client';

import { useEffect } from 'react';

export function MarkNotificationsRead() {
  useEffect(() => {
    let cancelled = false;

    const mark = async () => {
      try {
        const response = await fetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true }),
        });

        if (!cancelled && response.ok) {
          window.dispatchEvent(new Event('turnia:notifications-read'));
        }
      } catch {
        // El historial sigue visible aunque falle el marcado.
      }
    };

    void mark();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
