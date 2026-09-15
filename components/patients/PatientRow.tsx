'use client';

import { useRouter } from 'next/navigation';
import { StatusBadge } from '@/components/ui/StatusBadge';

export type PatientRowData = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  nextLabel: string | null;
  nextStatus: string | null;
  lastLabel: string | null;
};

/**
 * Fila de la tabla de pacientes. Toda la fila es clickeable (navega a la
 * ficha) sin depender de un botón "Abrir ficha" repetido en cada renglón —
 * como la página de Pacientes es un Server Component, este wrapper cliente
 * sólo maneja el click; el resto de la tabla sigue renderizada en servidor.
 */
export function PatientRow({ patient }: { patient: PatientRowData }) {
  const router = useRouter();
  const initials = patient.name.trim().slice(0, 2).toUpperCase();

  return (
    <tr
      className="row-link"
      onClick={() => router.push(`/patients/${patient.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(`/patients/${patient.id}`);
      }}
      tabIndex={0}
      role="link"
      aria-label={`Abrir ficha de ${patient.name}`}
    >
      <td>
        <div className="table-cell-identity">
          <span className="table-avatar">{initials}</span>
          <strong>{patient.name}</strong>
        </div>
      </td>
      <td>
        <div className="muted" style={{ fontSize: 13 }}>
          {[patient.phone, patient.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
        </div>
      </td>
      <td>
        {patient.nextLabel ? (
          <span>{patient.nextLabel}</span>
        ) : patient.lastLabel ? (
          <span className="muted">Último: {patient.lastLabel}</span>
        ) : (
          <span className="muted">Sin turnos</span>
        )}
      </td>
      <td>
        {patient.nextStatus ? <StatusBadge status={patient.nextStatus} /> : <span className="muted">—</span>}
      </td>
    </tr>
  );
}
