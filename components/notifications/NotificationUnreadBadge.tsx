'use client';

import { useCallback, useEffect, useState } from 'react';

export function NotificationUnreadBadge() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/unread-count', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json() as { count?: number };
      setCount(Number(payload.count ?? 0));
    } catch {
      // El contador es informativo y nunca debe romper la navegación.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(refresh, 10000);
    const onRead = () => setCount(0);
    window.addEventListener('focus', refresh);
    window.addEventListener('turnia:notifications-read', onRead);
    window.addEventListener('turnia:notification-count-refresh', refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('turnia:notifications-read', onRead);
      window.removeEventListener('turnia:notification-count-refresh', refresh);
    };
  }, [refresh]);

  if (count <= 0) return null;

  return (
    <span className="notification-unread-badge" aria-label={count + ' notificaciones sin leer'}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
