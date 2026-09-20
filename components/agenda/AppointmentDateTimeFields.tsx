'use client';

import { useMemo, useState } from 'react';

type ServiceOption = {
  id: string;
  name: string;
  duration_minutes: number;
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

// Suma minutos a una fecha+hora "de pared" (sin husos horarios) usando
// aritmética UTC como truco para no arrastrar el huso local del navegador.
// El resultado se interpreta después en el servidor como hora de Buenos
// Aires, igual que ya hacía el resto de la agenda.
function addMinutesToLocal(date: string, time: string, minutes: number) {
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

/**
 * Servicio + Fecha + Hora del turno. Reemplaza los campos separados
 * "Inicio"/"Fin": la hora de fin se calcula sola a partir de la duración
 * del servicio elegido. Sigue emitiendo los mismos campos ocultos
 * `starts_at_local` / `ends_at_local` (formato YYYY-MM-DDTHH:mm) que ya
 * esperaba `agenda/actions.ts`, así que el server action no cambia.
 *
 * Duración histórica: al editar un turno existente, `initialDurationMinutes`
 * (calculada en la página a partir de starts_at/ends_at ya guardados) es la
 * que se usa al montar el formulario — NUNCA la duración actual del
 * servicio. La duración sólo se recalcula cuando la persona elige
 * explícitamente otro servicio en el <select> (acción deliberada); cambiar
 * sólo la fecha o la hora nunca la toca. Para un turno nuevo (sin
 * `initialDurationMinutes`), la duración sigue al servicio elegido desde el
 * principio, que es el comportamiento esperado al crear.
 */
export function AppointmentDateTimeFields({
  services,
  defaultServiceId,
  defaultDate,
  defaultTime,
  initialDurationMinutes,
}: {
  services: ServiceOption[];
  defaultServiceId?: string;
  defaultDate: string;
  defaultTime: string;
  /** Duración ya guardada del turno (ends_at - starts_at), sólo al editar. */
  initialDurationMinutes?: number;
}) {
  const [serviceId, setServiceId] = useState(defaultServiceId ?? '');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [duration, setDuration] = useState<number | undefined>(
    initialDurationMinutes ?? services.find((s) => s.id === defaultServiceId)?.duration_minutes,
  );

  const end = useMemo(
    () => (duration ? addMinutesToLocal(date, time, duration) : { date: '', time: '' }),
    [date, time, duration],
  );

  const startsAtLocal = date && time ? `${date}T${time}` : '';
  const endsAtLocal = end.date && end.time ? `${end.date}T${end.time}` : '';

  function handleServiceChange(id: string) {
    setServiceId(id);
    // Cambio deliberado de servicio: ahí sí adoptamos su duración actual.
    setDuration(services.find((s) => s.id === id)?.duration_minutes);
  }

  return (
    <>
      <label>Servicio
        <select
          name="service_id"
          required
          value={serviceId}
          onChange={(e) => handleServiceChange(e.target.value)}
        >
          <option value="" disabled>Seleccionar servicio</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name} · {s.duration_minutes} min</option>
          ))}
        </select>
      </label>

      <div className="field-row">
        <label>Fecha
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>Hora
          <input
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
      </div>

      <p className="field-hint">
        {duration && end.time
          ? `Duración: ${duration} min · finaliza ${end.time}${end.date !== date ? ` (${end.date})` : ''}`
          : 'Elegí un servicio para calcular la hora de fin automáticamente.'}
      </p>

      <input type="hidden" name="starts_at_local" value={startsAtLocal} />
      <input type="hidden" name="ends_at_local" value={endsAtLocal} />
    </>
  );
}
