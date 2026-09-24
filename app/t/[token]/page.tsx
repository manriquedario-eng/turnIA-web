import Link from 'next/link';
import { getAppointmentByPublicToken } from '@/lib/appointments/public-token';
import { confirmAppointmentPublic, cancelAppointmentPublic, requestReschedulePublic } from './actions';

const TZ = 'America/Argentina/Buenos_Aires';

function isCancelled(status: string | null) {
  return status === 'cancelled' || status === 'cancelado';
}

function modalityText(modality: string | null) {
  if (modality === 'online') return 'Online';
  if (modality === 'domicilio') return 'A domicilio';
  return 'Presencial';
}

function statusText(status: string | null) {
  if (isCancelled(status)) return 'Cancelado';
  if (status === 'confirmed' || status === 'confirmado') return 'Confirmado';
  if (status === 'completed' || status === 'completado') return 'Atendido';
  return 'Agendado';
}

/**
 * Página pública de un turno (PARTE 18-20 del pedido): a la que llegan los
 * botones del email. Nunca requiere cuenta TurnIA. Sólo muestra los datos
 * operativos del turno — nada clínico, nunca el tenant_id, nunca otros
 * turnos ni otros pacientes.
 */
export default async function PublicAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ action?: string; done?: string; error?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const appointment = await getAppointmentByPublicToken(token);

  if (!appointment) {
    return (
      <main className="login-wrap">
        <section className="card login-card">
          <h1>TurnIA</h1>
          <p className="muted">Este enlace no es válido o el turno ya no está disponible.</p>
        </section>
      </main>
    );
  }

  const dateLabel = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'full' }).format(new Date(appointment.startsAt));
  const timeLabel = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(appointment.startsAt));
  const cancelled = isCancelled(appointment.status);

  const doneMessages: Record<string, string> = {
    confirmed: 'Tu turno fue confirmado correctamente.',
    cancelled: 'Tu turno fue cancelado.',
    reschedule_requested: 'Recibimos tu solicitud de reprogramación. Tu profesional se va a comunicar para coordinar un nuevo horario.',
  };

  return (
    <main className="login-wrap">
      <section className="card login-card" style={{ maxWidth: 420 }}>
        <p className="muted" style={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>TurnIA</p>
        <h1 style={{ marginTop: 0 }}>Tu turno</h1>

        {query.error ? <p className="alert error">{query.error}</p> : null}
        {query.done && doneMessages[query.done] ? <p className="alert success">{doneMessages[query.done]}</p> : null}

        <div className="stack" style={{ gap: 6, margin: '16px 0' }}>
          <div><strong>Paciente:</strong> {appointment.patientName}</div>
          <div><strong>Profesional:</strong> {appointment.professionalName}</div>
          {appointment.serviceName ? <div><strong>Servicio:</strong> {appointment.serviceName}</div> : null}
          <div><strong>Fecha:</strong> {dateLabel}</div>
          <div><strong>Hora:</strong> {timeLabel}</div>
          <div><strong>Modalidad:</strong> {modalityText(appointment.modality)}</div>
          <div><strong>Estado:</strong> {statusText(appointment.status)}</div>
        </div>

        {appointment.modality === 'online' && appointment.meetingUrl && !cancelled ? (
          <p style={{ margin: '0 0 16px' }}>
            <a className="btn secondary" href={appointment.meetingUrl} target="_blank" rel="noreferrer">
              Unirse a Google Meet
            </a>
          </p>
        ) : null}

        {cancelled ? null : query.action === 'cancel' ? (
          <div className="stack" style={{ gap: 10 }}>
            <p><strong>¿Querés cancelar este turno?</strong></p>
            <div className="nav" style={{ gap: 8 }}>
              <form action={cancelAppointmentPublic}>
                <input type="hidden" name="token" value={token} />
                <button className="btn danger" type="submit">Cancelar turno</button>
              </form>
              <Link className="btn secondary" href={`/t/${token}`}>Volver</Link>
            </div>
          </div>
        ) : query.action === 'reschedule' ? (
          <form action={requestReschedulePublic} className="stack" style={{ gap: 10 }}>
            <input type="hidden" name="token" value={token} />
            <label>
              Preferencia de horario (opcional)
              <textarea name="note" maxLength={500} rows={3} placeholder="Ej: prefiero por la tarde, cualquier día de la semana que viene" style={{ width: '100%' }} />
            </label>
            <div className="nav" style={{ gap: 8 }}>
              <button className="btn" type="submit">Enviar solicitud</button>
              <Link className="btn secondary" href={`/t/${token}`}>Volver</Link>
            </div>
          </form>
        ) : (
          <div className="nav" style={{ gap: 8, flexWrap: 'wrap' }}>
            <form action={confirmAppointmentPublic}>
              <input type="hidden" name="token" value={token} />
              <button className="btn" type="submit">Confirmar turno</button>
            </form>
            <Link className="btn-ghost danger" href={`/t/${token}?action=cancel`}>Cancelar turno</Link>
            <Link className="btn secondary" href={`/t/${token}?action=reschedule`}>Solicitar reprogramación</Link>
          </div>
        )}

        {appointment.rescheduleRequestedAt && !cancelled && query.action !== 'reschedule' ? (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Ya enviaste una solicitud de reprogramación para este turno. Tu profesional la va a revisar.
          </p>
        ) : null}
      </section>
    </main>
  );
}
