'use client';

import { useState } from 'react';

export function DigilogixSignButton({ action }: { action: string }) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      action={action}
      method="post"
      onSubmit={() => setSubmitting(true)}
      style={{ display: 'inline-flex' }}
    >
      <button className="btn btn-compact" type="submit" disabled={submitting}>
        {submitting ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span
              aria-hidden="true"
              style={{
                width: 14,
                height: 14,
                border: '2px solid currentColor',
                borderRightColor: 'transparent',
                borderRadius: '999px',
                display: 'inline-block',
                animation: 'turnia-spin .8s linear infinite',
              }}
            />
            Preparando firma segura con Digilogix…
            <style jsx>{`
              @keyframes turnia-spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </span>
        ) : (
          'Firmar con Digilogix'
        )}
      </button>
    </form>
  );
}
