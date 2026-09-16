'use client';

import { useMemo, useState } from 'react';
import { decomposeE164, type KnownCountryPrefix } from '@/lib/phone';

// Prefijos comunes para consultorios en Argentina y la región.
const PREFIXES: { code: KnownCountryPrefix; label: string }[] = [
  { code: '+54 9', label: 'Argentina (celular) +54 9' },
  { code: '+54', label: 'Argentina (fijo) +54' },
  { code: '+598', label: 'Uruguay +598' },
  { code: '+595', label: 'Paraguay +595' },
  { code: '+56', label: 'Chile +56' },
  { code: '+34', label: 'España +34' },
  { code: '+1', label: 'EE.UU./Canadá +1' },
];

const PREFIX_LABEL: Record<string, string> = Object.fromEntries(PREFIXES.map((p) => [p.code, p.code]));

// Decompone el valor de texto libre (histórico, sin `phone_e164`) usando el
// mismo criterio que antes, pero comparando dígitos en vez de substrings con
// espacio — evita el bug donde "+5492616807361" (E.164 compacto, sin espacio)
// matcheaba "+54" antes que "+54 9" y dejaba el "9" pegado al número local.
function splitFreeText(value: string): { prefix: KnownCountryPrefix; local: string } {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return { prefix: '+54 9', local: '' };

  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    const decomposed = decomposeE164(`+${digits}`);
    if (decomposed) return decomposed;
  }

  // No matchea ningún prefijo conocido: se deja el texto tal cual como
  // número local con el prefijo por defecto, para no perder el dato ya
  // cargado (nunca se descarta lo que la persona tipeó).
  return { prefix: '+54 9', local: trimmed.replace(/^\+?54\s?9?/, '').trim() || trimmed };
}

/**
 * Campo de teléfono reutilizable: prefijo de país + número local, con
 * Argentina celular (+54 9) como valor por defecto.
 *
 * Prioriza `defaultE164` (el valor ya normalizado en base, ej. `phone_e164`)
 * para descomponer prefijo/local de forma inequívoca. Si no viene, cae al
 * parseo del texto libre (`defaultValue`) sólo como respaldo.
 *
 * El prefijo se muestra como texto fijo por defecto (no un <select> siempre
 * visible) — un link discreto "Editar prefijo" lo convierte en selector
 * editable sólo cuando se lo pide.
 *
 * Emite DOS campos ocultos:
 * - `name={name}`: el valor combinado en texto libre.
 * - `name={name}_country_prefix`: el prefijo elegido, para que el servidor
 *   lo use directo en `normalizePhone(raw, { selectedPrefix })`.
 */
export function PhoneInput({
  name = 'phone',
  defaultValue = '',
  defaultE164 = null,
  label = 'Teléfono',
}: {
  name?: string;
  defaultValue?: string;
  defaultE164?: string | null;
  label?: string;
}) {
  const initial = useMemo(() => {
    const fromE164 = decomposeE164(defaultE164);
    if (fromE164) return fromE164;
    return splitFreeText(defaultValue);
  }, [defaultE164, defaultValue]);

  const [prefix, setPrefix] = useState<KnownCountryPrefix>(initial.prefix);
  const [local, setLocal] = useState(initial.local);
  const [editingPrefix, setEditingPrefix] = useState(false);

  const combined = local.trim() ? `${prefix} ${local.trim()}` : '';

  return (
    // OJO: este contenedor (no un <label>) es el que efectivamente ocupa la
    // columna "Teléfono" dentro de .form-grid. La regla global `label {
    // min-width: 0 }` NO lo alcanza porque esto es un <div> — por eso se le
    // pone min-width:0 acá explícitamente, además de en la clase
    // .phone-field (globals.css).
    <div className="phone-field" style={{ display: 'grid', gap: 6, minWidth: 0, width: '100%' }}>
      <label htmlFor={`${name}-field`} style={{ display: 'block' }}>{label}</label>
      <div className="phone-input">
        {editingPrefix ? (
          <select
            id={`${name}-field`}
            aria-label="Prefijo del país"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value as KnownCountryPrefix)}
          >
            {PREFIXES.map((p) => (
              <option key={p.code} value={p.code}>{p.label}</option>
            ))}
          </select>
        ) : (
          <span className="phone-input-prefix-static" aria-hidden="true">{PREFIX_LABEL[prefix] ?? prefix}</span>
        )}
        <input
          id={editingPrefix ? undefined : `${name}-field`}
          type="tel"
          inputMode="numeric"
          aria-label="Número"
          placeholder="261 6807361"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          maxLength={40}
        />
      </div>
      <button
        type="button"
        className="phone-input-prefix-toggle"
        onClick={() => setEditingPrefix((v) => !v)}
      >
        {editingPrefix ? 'Listo' : 'Editar prefijo'}
      </button>
      <input type="hidden" name={name} value={combined} />
      <input type="hidden" name={`${name}_country_prefix`} value={prefix} />
    </div>
  );
}
