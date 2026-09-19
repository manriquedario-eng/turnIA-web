'use client';

import { useMemo, useState } from 'react';
import { PatientRow, type PatientRowData } from './PatientRow';
import { IconSearch } from '@/components/ui/icons';

export function PatientsTable({ patients }: { patients: PatientRowData[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) =>
      [p.name, p.phone, p.email].filter(Boolean).some((field) => field!.toLowerCase().includes(q)),
    );
  }, [patients, query]);

  return (
    <>
      <div className="patients-search">
        <IconSearch size={15} />
        <input
          type="search"
          placeholder="Buscar por nombre, teléfono o email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar paciente"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-helper" style={{ padding: '0 20px 20px' }}>
          Sin resultados para &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table table-patients">
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Contacto</th>
                <th>Próximo turno</th>
                <th>Estado</th>
                <th aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((patient) => (
                <PatientRow key={patient.id} patient={patient} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
