'use client';

import { useState } from 'react';

/**
 * Selector de modalidad + monto. El aviso sobre Google Meet sólo tiene
 * sentido cuando la modalidad es "online" — antes se mostraba siempre,
 * incluso para turnos presenciales o a domicilio. Ahora reacciona al
 * cambio de modalidad sin recargar la página.
 */
export function ModalityField({
  defaultModality,
  defaultAmount,
  googleConnected,
}: {
  defaultModality: string;
  defaultAmount: number | string;
  googleConnected: boolean;
}) {
  const [modality, setModality] = useState(defaultModality);
  const isOnline = modality === 'online';

  return (
    <>
      <div className="field-row">
        <label>Modalidad
          <select name="modality" value={modality} onChange={(e) => setModality(e.target.value)}>
            <option value="presencial">Presencial</option>
            <option value="domicilio">Domicilio</option>
            <option value="online">Online</option>
          </select>
        </label>

        <label>Monto
          <input name="quoted_amount" type="number" min="0" step="0.01" defaultValue={defaultAmount} />
        </label>
      </div>

      {isOnline ? (
        <p className={`field-hint ${googleConnected ? '' : 'is-warning'}`}>
          {googleConnected
            ? 'Se generará automáticamente un enlace de Google Meet.'
            : 'Google no está conectado: este turno online se va a guardar sin videollamada. Conectalo en Configuración.'}
        </p>
      ) : null}
    </>
  );
}
