'use client';

import { useMemo, useState } from 'react';

type ServiceOption = { id: string; name: string; duration_minutes: number };

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'semanales',
  biweekly: 'quincenales',
  monthly: 'mensuales',
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function addMinutes(date: string, time: string, minutes: number) {
  if (!date || !time) return { date: '', time: '' };
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return { date: '', time: '' };
  const value = new Date(Date.UTC(y, m - 1, d, hh, mm));
  value.setUTCMinutes(value.getUTCMinutes() + minutes);
  return {
    date: `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`,
    time: `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`,
  };
}

function formatDateEs(date: string) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/**
 * Servicio + Fecha + Hora + Frecuencia + Cantidad para la serie recurrente,
 * con el mismo patrón "Fecha + Hora, fin calculado solo" que ya usa el
 * turno individual en Agenda (nada de campos "Primer inicio"/"Primer fin").
 * Muestra un resumen en lenguaje natural antes de confirmar. Sigue
 * emitiendo `starts_at_local` / `ends_at_local` en el mismo formato que ya
 * esperaba `createRecurringAppointments`, así que el server action no
 * cambia.
 */
export function RecurringAppointmentFields({ services }: { services: ServiceOption[] }) {
  const today = useMemo(() => new Intl.DateTimeFormat('en-CA').format(new Date()), []);
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('09:00');
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [occurrences, setOccurrences] = useState(4);

  const duration = services.find((s) => s.id === serviceId)?.duration_minutes;
  const end = duration ? addMinutes(date, time, duration) : { date: '', time: '' };
  const startsAtLocal = date && time ? `${date}T${time}` : '';
  const endsAtLocal = end.date && end.time ? `${end.date}T${end.time}` : '';

  const summary = duration && date && time
    ? `Se crearán ${occurrences} turnos ${FREQUENCY_LABELS[frequency]} de ${duration} min, comenzando el ${formatDateEs(date)} a las ${time}.`
    : null;

  return (
    <>
      <label>Servicio
        <select name="service_id" required value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="" disabled>Seleccionar servicio</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min</option>
          ))}
        </select>
      </label>

      <div className="field-row">
        <label>Fecha
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>Hora
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>

      <label>Frecuencia
        <select name="frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
          <option value="weekly">Semanal</option>
          <option value="biweekly">Cada 2 semanas</option>
          <option value="monthly">Mensual</option>
        </select>
      </label>

      <label>Cantidad
        <input
          name="occurrences"
          type="number"
          min="2"
          max="24"
          required
          value={occurrences}
          onChange={(e) => setOccurrences(Number(e.target.value) || 2)}
        />
      </label>

      {summary ? <p className="field-hint">{summary}</p> : <p className="field-hint">Elegí un servicio para ver el resumen de la serie.</p>}

      <input type="hidden" name="starts_at_local" value={startsAtLocal} />
      <input type="hidden" name="ends_at_local" value={endsAtLocal} />
    </>
  );
}
