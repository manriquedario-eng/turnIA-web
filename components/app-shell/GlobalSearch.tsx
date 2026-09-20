'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconSearch } from '@/components/ui/icons';
import { searchPatients, type PatientSearchResult } from '@/lib/patients/search-actions';

function partialPhone(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return phone;
  return `···${digits.slice(-4)}`;
}

/**
 * Buscador global del Topbar: resultados en vivo mientras se escribe, con
 * salto directo a la ficha del paciente. `/search` sigue existiendo como
 * página de resultados completa (Enter, o "Ver todos los resultados"),
 * nunca se elimina la ruta.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const currentRequest = ++requestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const found = await searchPatients(term);
      if (requestId.current === currentRequest) {
        setResults(found);
        setLoading(false);
        setHighlighted(0);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function goToPatient(patient: PatientSearchResult) {
    setOpen(false);
    setQuery('');
    router.push(`/patients/${patient.id}`);
  }

  function goToFullResults() {
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted < results.length) {
        goToPatient(results[highlighted]);
      } else if (query.trim().length >= 2) {
        goToFullResults();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="topbar-search" ref={containerRef}>
      <IconSearch size={16} />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Buscar paciente, teléfono, DNI..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        minLength={2}
        maxLength={100}
      />

      {open && query.trim().length >= 2 ? (
        <div className="combobox-panel" role="listbox">
          {loading ? <div className="combobox-empty">Buscando…</div> : null}
          {!loading && results.length === 0 ? (
            <div className="combobox-empty">Sin resultados para &quot;{query.trim()}&quot;.</div>
          ) : null}
          {!loading && results.map((patient, i) => (
            <button
              type="button"
              key={patient.id}
              role="option"
              aria-selected={i === highlighted}
              className={`combobox-option ${i === highlighted ? 'is-highlighted' : ''}`}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => goToPatient(patient)}
            >
              <span className="combobox-option-name">{patient.name}</span>
              {(patient.phone || patient.email) ? (
                <span className="combobox-option-meta">
                  {[partialPhone(patient.phone), patient.email].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </button>
          ))}
          {!loading ? (
            <button
              type="button"
              role="option"
              aria-selected={highlighted === results.length}
              className={`combobox-option combobox-option-create ${highlighted === results.length ? 'is-highlighted' : ''}`}
              onMouseEnter={() => setHighlighted(results.length)}
              onClick={goToFullResults}
            >
              Ver todos los resultados
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
