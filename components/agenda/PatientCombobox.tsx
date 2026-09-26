'use client';

import { useEffect, useRef, useState } from 'react';
import { searchPatients, quickCreatePatient, type PatientSearchResult } from '@/lib/patients/search-actions';
import type { KnownCountryPrefix } from '@/lib/phone';

function partialPhone(phone: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return phone;
  return `···${digits.slice(-4)}`;
}

/**
 * Combobox de paciente para el drawer de turno: escribir para filtrar
 * pacientes existentes del consultorio, elegir uno, o crear uno nuevo al
 * vuelo sin salir de Agenda. Emite un input oculto `name="patient_id"` para
 * que el <form> del drawer siga funcionando exactamente igual que antes.
 */
export function PatientCombobox({
  defaultPatientId,
  defaultPatientName,
}: {
  defaultPatientId?: string;
  defaultPatientName?: string;
}) {
  const [query, setQuery] = useState(defaultPatientName ?? '');
  const [selectedId, setSelectedId] = useState(defaultPatientId ?? '');
  const [results, setResults] = useState<PatientSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newPhonePrefix, setNewPhonePrefix] = useState<KnownCountryPrefix>('+54 9');
  const [newEmail, setNewEmail] = useState('');
  const [newWhatsappOptIn, setNewWhatsappOptIn] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (selectedId) return; // ya eligieron uno; no hace falta buscar de nuevo
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
  }, [query, selectedId]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function selectPatient(patient: PatientSearchResult) {
    setSelectedId(patient.id);
    setQuery(patient.name);
    setResults([]);
    setOpen(false);
    setCreateError(null);
    setDuplicateId(null);
    setShowQuickCreate(false);
  }

  function startQuickCreate() {
    if (query.trim().length < 2) return;
    setShowQuickCreate(true);
    setOpen(false);
    setCreateError(null);
    setDuplicateId(null);
  }

  async function handleCreate() {
    const name = query.trim();
    if (name.length < 2) return;
    setCreating(true);
    setCreateError(null);
    setDuplicateId(null);
    const result = await quickCreatePatient({
      name,
      phone: newPhone.trim() || undefined,
      phonePrefix: newPhone.trim() ? newPhonePrefix : undefined,
      email: newEmail.trim() || undefined,
      whatsappOptIn: newWhatsappOptIn,
    });
    setCreating(false);
    if (result.ok) {
      setSelectedId(result.id);
      setQuery(result.name);
      setOpen(false);
      setShowQuickCreate(false);
      setNewPhone('');
      setNewEmail('');
      setNewWhatsappOptIn(false);
    } else {
      setCreateError(result.error);
      setDuplicateId(result.duplicatePatientId ?? null);
    }
  }

  const showCreateOption = !selectedId && query.trim().length >= 2
    && !results.some((r) => r.name.toLowerCase() === query.trim().toLowerCase());
  const optionCount = results.length + (showCreateOption ? 1 : 0);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, optionCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted < results.length) {
        selectPatient(results[highlighted]);
      } else if (showCreateOption) {
        startQuickCreate();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="combobox" ref={containerRef}>
      <label htmlFor="patient-combobox-input">Paciente</label>
      <input
        id="patient-combobox-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Escribí el nombre del paciente"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedId('');
          setOpen(true);
          setShowQuickCreate(false);
          setCreateError(null);
          setDuplicateId(null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      <input type="hidden" name="patient_id" value={selectedId} />

      {open && (loading || results.length > 0 || showCreateOption) ? (
        <div className="combobox-panel" role="listbox">
          {loading ? <div className="combobox-empty">Buscando…</div> : null}
          {!loading && results.map((patient, i) => (
            <button
              type="button"
              key={patient.id}
              role="option"
              aria-selected={i === highlighted}
              className={`combobox-option ${i === highlighted ? 'is-highlighted' : ''}`}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => selectPatient(patient)}
            >
              <span className="combobox-option-name">{patient.name}</span>
              {(patient.phone || patient.email) ? (
                <span className="combobox-option-meta">
                  {[partialPhone(patient.phone), patient.email].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </button>
          ))}
          {!loading && showCreateOption ? (
            <button
              type="button"
              role="option"
              aria-selected={highlighted === results.length}
              className={`combobox-option combobox-option-create ${highlighted === results.length ? 'is-highlighted' : ''}`}
              onMouseEnter={() => setHighlighted(results.length)}
              onClick={startQuickCreate}
            >
              + Nuevo paciente
            </button>
          ) : null}
        </div>
      ) : null}

      {showQuickCreate ? (
        <div
          className="quick-patient-create"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (!creating) void handleCreate();
            }
          }}
        >
          <div className="quick-patient-create-head">
            <strong>Nuevo paciente</strong>
            <button
              type="button"
              className="quick-patient-create-close"
              aria-label="Cerrar alta rápida"
              onClick={() => setShowQuickCreate(false)}
            >
              ×
            </button>
          </div>

          <label>
            Nombre
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nombre y apellido"
              autoComplete="name"
            />
          </label>

          <div className="quick-patient-phone-row">
            <label>
              Prefijo
              <select
                value={newPhonePrefix}
                onChange={(event) => setNewPhonePrefix(event.target.value as KnownCountryPrefix)}
              >
                <option value="+54 9">+54 9 AR celular</option>
                <option value="+54">+54 AR</option>
                <option value="+598">+598 UY</option>
                <option value="+595">+595 PY</option>
                <option value="+56">+56 CL</option>
                <option value="+34">+34 ES</option>
                <option value="+1">+1 US/CA</option>
              </select>
            </label>
            <label className="quick-patient-phone">
              Teléfono
              <input
                type="tel"
                value={newPhone}
                onChange={(event) => setNewPhone(event.target.value)}
                placeholder="261 555 1234"
                autoComplete="tel"
              />
            </label>
          </div>

          <label>
            Email
            <input
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="paciente@email.com"
              autoComplete="email"
            />
          </label>

          <label className="quick-patient-consent">
            <input
              type="checkbox"
              checked={newWhatsappOptIn}
              onChange={(event) => setNewWhatsappOptIn(event.target.checked)}
            />
            <span>Autoriza WhatsApp y recordatorio del turno</span>
          </label>

          <div className="nav" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setShowQuickCreate(false)}
              disabled={creating}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void handleCreate()}
              disabled={creating || query.trim().length < 2}
            >
              {creating ? 'Guardando…' : 'Guardar paciente'}
            </button>
          </div>
        </div>
      ) : null}

      {createError ? (
        <p className="field-hint" style={{ color: 'var(--color-danger)' }}>
          {createError}
          {duplicateId ? (
            <>
              {' '}
              <a href={`/patients/${duplicateId}`} target="_blank" rel="noreferrer">Abrir ese paciente</a>
            </>
          ) : null}
        </p>
      ) : null}
      {!createError && !selectedId && query.trim().length >= 2 ? (
        <p className="field-hint">Elegí un paciente de la lista o creá uno nuevo.</p>
      ) : null}
    </div>
  );
}
