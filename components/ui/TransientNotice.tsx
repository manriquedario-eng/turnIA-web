'use client';

import { useEffect, useState } from 'react';

export function TransientNotice({
  message,
  kind = 'success',
  durationMs = 3200,
}: {
  message: string;
  kind?: 'success' | 'error' | 'info';
  durationMs?: number;
}) {
  const [visible, setVisible] = useState(Boolean(message));

  useEffect(() => {
    setVisible(Boolean(message));
    if (!message) return;
    const timeout = window.setTimeout(() => setVisible(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [message, durationMs]);

  if (!visible || !message) return null;

  const className = kind === 'success'
    ? 'alert success'
    : kind === 'error'
      ? 'alert error'
      : 'alert';

  return <div className={className} role="status">{message}</div>;
}
