'use client';

import { useMemo, useState } from 'react';

// Prefijos comunes para consultorios en Argentina y la región. "Otro" habilita
// el modo manual (un solo campo de texto), para cualquier caso que no entre
// en esta lista corta — nunca bloqueamos la carga por no tener el prefijo.
const PREFIXES = [
  { code: '+54 9', label: 'Argentina (celular) +54 9' },
  { code: '+54', label: 'Argentina (fijo) +54' },
  { code: '+598', label: 'Uruguay +598' },
  { code: '+595', label: 'Paraguay +595' },
  { code: '+56', label: 'Chile +56' },
  { code: '+34', label: 'España +34' },
  { code: '+1', label: 'EE.UU./Canadá +1' },
];

function splitExisting(value: string): { prefix: string; local: string; manual: boolean } {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return { prefix: '+54 9', local: '', manual: false };
  for (const { code } of PREFIXES) {
    if (trimmed.startsWith(code)) {
      return { prefix: code, local: trimmed.slice(code.length).trim(), manual: false };
    }
  }
  // No matchea ningún prefijo conocido (número guardado en otro formato,
  // sin código de país, etc.) — se edita como texto libre para no alterar
  // un valor que la persona ya cargó a propósito.
  return { prefix: '+54 9', local: trimmed, manual: true };
}

/**
 * Campo de teléfono reutilizable: prefijo de país + número local, con
 * Argentina celular (+54 9) como valor por defecto.
 *
 * Emite DOS campos ocultos:
 * - `name={name}` (por defecto "phone"): el valor combinado en texto libre,
 *   para mostrarlo tal cual al reabrir el formulario y como respaldo.
 * - `name={name}_country_prefix` (por defecto "phone_country_prefix"): el
 *   prefijo elegido en el selector, tal cual, para que el servidor no
 *   tenga que adivinarlo volviendo a parsear el texto combinado — se lo
 *   pasa directo a `normalizePhone(raw, { selectedPrefix })`. En modo
 *   manual este campo va vacío: ahí el servidor cae al parseo de siempre
 *   sobre el texto libre, sin asumir ningún país.
 */
export function PhoneInput({
  name = 'phone',
  defaultValue = '',
  label = 'Teléfono',
}: {
  name?: string;
  defaultValue?: string;
  label?: string;
}) {
  const initial = useMemo(() => splitExisting(defaultValue), [defaultValue]);
  const [manual, setManual] = useState(initial.manual);
  const [prefix, setPrefix] = useState(initial.prefix);
  const [local, setLocal] = useState(initial.local);
  const [manualValue, setManualValue] = useState(manual ? initial.local : defaultValue);

  const combined = manual ? manualValue.trim() : (local.trim() ? `${prefix} ${local.trim()}` : '');
  // Vacío en modo manual a propósito: ahí el servidor no debe asumir país.
  const countryPrefixField = manual ? '' : prefix;

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label htmlFor={`${name}-field`} style={{ display: 'block' }}>{label}</label>
      {manual ? (
        <input
          id={`${name}-field`}
          type="text"
          value={manualValue}
          onChange={(e) => setManualValue(e.target.value)}
          placeholder="Ej: +54 261 555 1234"
          maxLength={160}
        />
      ) : (
        <div className="phone-input">
          <select
            id={`${name}-field`}
            aria-label="Prefijo del país"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          >
            {PREFIXES.map((p) => (
              <option key={p.code} value={p.code}>{p.code}</option>
            ))}
          </select>
          <input
            type="tel"
            inputMode="numeric"
            aria-label="Número"
            placeholder="261 555 1234"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            maxLength={40}
          />
        </div>
      )}
      <button
        type="button"
        className="phone-input-manual-toggle"
        onClick={() => setManual((m) => !m)}
      >
        {manual ? 'Elegir prefijo de una lista' : 'Ingresar manualmente'}
      </button>
      <input type="hidden" name={name} value={combined} />
      <input type="hidden" name={`${name}_country_prefix`} value={countryPrefixField} />
    </div>
  );
}
