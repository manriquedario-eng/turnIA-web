'use client';

import { useState } from 'react';

export type NotificationHistoryItem = {
  id: string;
  action: 'confirm' | 'cancel' | 'reschedule';
  title: string;
  text: string;
  createdAtLabel: string;
  read: boolean;
};

export function NotificationHistoryList({
  initialItems,
}: {
  initialItems: NotificationHistoryItem[];
}) {
  const [items, setItems] = useState(initialItems);

  async function markRead(id: string) {
    const current = items.find((item) => item.id === id);
    if (!current || current.read) return;

    const response = await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!response.ok) return;

    setItems((rows) =>
      rows.map((row) => (row.id === id ? { ...row, read: true } : row)),
    );
    window.dispatchEvent(new Event('turnia:notification-count-refresh'));
  }

  async function remove(id: string) {
    const response = await fetch('/api/notifications/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!response.ok) return;

    setItems((rows) => rows.filter((row) => row.id !== id));
    window.dispatchEvent(new Event('turnia:notification-count-refresh'));
  }

  if (items.length === 0) {
    return (
      <div className="empty-state" style={{ margin: 0 }}>
        <strong>No hay notificaciones todavía</strong>
        <span className="muted">
          Cuando un paciente confirme, cancele o pida reprogramar un turno, va a quedar registrado acá.
        </span>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="stack" style={{ gap: 0 }}>
        {items.map((item) => {
          const stateClass =
            item.action === 'confirm'
              ? 'is-confirm'
              : item.action === 'cancel'
                ? 'is-cancel'
                : 'is-reschedule';

          return (
            <div
              key={item.id}
              className={`notification-history-row ${stateClass} ${item.read ? '' : 'is-unread'}`}
              role="button"
              tabIndex={0}
              onClick={() => void markRead(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void markRead(item.id);
                }
              }}
              aria-label={item.read ? item.title : `${item.title}, sin leer`}
            >
              <span className="notification-history-dot" aria-hidden="true" />
              <span className="notification-history-copy">
                <span className="notification-history-title">
                  {item.title}
                  {!item.read ? <span className="notification-unread-text"> · Sin leer</span> : null}
                </span>
                <span className="notification-history-text">{item.text}</span>
                <span className="notification-history-time">{item.createdAtLabel}</span>
              </span>
              <button
                type="button"
                className="notification-delete-btn"
                aria-label="Borrar notificación"
                title="Borrar notificación"
                onClick={(event) => {
                  event.stopPropagation();
                  void remove(item.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
