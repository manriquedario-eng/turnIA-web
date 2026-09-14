import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';

function safeTerm(value: string) {
  return value.replace(/[%_,()]/g, ' ').trim().slice(0, 100);
}

function relatedName(value: unknown, fallback: string) {
  if (Array.isArray(value)) return value[0]?.name ?? fallback;
  if (value && typeof value === 'object' && 'name' in value) {
    return String((value as { name?: unknown }).name ?? fallback);
  }
  return fallback;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = safeTerm(String(params.q ?? ''));
  const { supabase, tenantId } = await requireTenant();

  let patients: any[] = [];
  let followUps: any[] = [];
  let records: any[] = [];
  let appointments: any[] = [];
  let payments: any[] = [];

  if (q.length >= 2) {
    const pattern = `%${q}%`;
    const [patientResult, followUpResult, recordResult, serviceResult] = await Promise.all([
      supabase
        .from('patients')
        .select('id,name,phone,email,dni,insurance_name')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},dni.ilike.${pattern},insurance_name.ilike.${pattern}`)
        .order('name')
        .limit(30),
      supabase
        .from('patient_follow_ups')
        .select('id,patient_id,content,created_at,patients(name)')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .ilike('content', pattern)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('patient_records')
        .select('id,patient_id,reason,follow_up,background,notes,plan,updated_at,patients(name)')
        .eq('tenant_id', tenantId)
        .or(`reason.ilike.${pattern},follow_up.ilike.${pattern},background.ilike.${pattern},notes.ilike.${pattern},plan.ilike.${pattern}`)
        .order('updated_at', { ascending: false })
        .limit(20),
      supabase
        .from('services')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('name', pattern)
        .limit(30),
    ]);

    patients = patientResult.data ?? [];
    followUps = followUpResult.data ?? [];
    records = recordResult.data ?? [];

    const patientIds = patients.map((patient) => patient.id);
    const serviceIds = (serviceResult.data ?? []).map((service) => service.id);
    const numericTerm = Number(q.replace(',', '.'));
    const appointmentFilters = [
      `guest_name.ilike.${pattern}`,
      `status.ilike.${pattern}`,
      `modality.ilike.${pattern}`,
      `currency.ilike.${pattern}`,
    ];

    if (patientIds.length > 0) appointmentFilters.push(`patient_id.in.(${patientIds.join(',')})`);
    if (serviceIds.length > 0) appointmentFilters.push(`service_id.in.(${serviceIds.join(',')})`);
    if (Number.isFinite(numericTerm)) appointmentFilters.push(`quoted_amount.eq.${numericTerm}`);

    const appointmentResult = await supabase
      .from('appointments')
      .select('id,patient_id,guest_name,starts_at,status,modality,quoted_amount,currency,patients(name),services(name)')
      .eq('tenant_id', tenantId)
      .or(appointmentFilters.join(','))
      .order('starts_at', { ascending: false })
      .limit(30);

    appointments = appointmentResult.data ?? [];

    const appointmentIds = appointments.map((appointment) => appointment.id);
    const paymentFilters = [`method.ilike.${pattern}`, `currency.ilike.${pattern}`];
    if (patientIds.length > 0) paymentFilters.push(`patient_id.in.(${patientIds.join(',')})`);
    if (appointmentIds.length > 0) paymentFilters.push(`appointment_id.in.(${appointmentIds.join(',')})`);
    if (Number.isFinite(numericTerm)) paymentFilters.push(`amount.eq.${numericTerm}`);

    const paymentResult = await supabase
      .from('payments')
      .select('id,patient_id,appointment_id,amount,currency,method,created_at,patients(name)')
      .eq('tenant_id', tenantId)
      .or(paymentFilters.join(','))
      .order('created_at', { ascending: false })
      .limit(30);

    payments = paymentResult.data ?? [];
  }

  return (
    <section className="stack">
      <div>
        <h1>Búsqueda global</h1>
        <p className="muted">Busca dentro del consultorio actual por pacientes, turnos, pagos, seguimientos o contenido de ficha.</p>
      </div>

      <div className="card">
        <form method="get" className="nav" style={{ flexWrap: 'wrap' }}>
          <input name="q" defaultValue={q} placeholder="Ej.: García, 261..., DNI, consulta, transferencia, 25000" minLength={2} maxLength={100} style={{ minWidth: 320 }} />
          <button className="btn" type="submit">Buscar</button>
        </form>
      </div>

      {q.length > 0 && q.length < 2 ? <p className="alert error">Escribí al menos 2 caracteres.</p> : null}

      {q.length >= 2 ? (
        <>
          <div className="card">
            <h2>Pacientes</h2>
            {patients.length === 0 ? <p className="muted">No se encontraron pacientes.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>Paciente</th><th>Teléfono</th><th>Email</th><th>DNI</th><th>Obra social</th><th>Acciones</th></tr></thead>
                  <tbody>{patients.map((patient) => (
                    <tr key={patient.id}>
                      <td><Link href={`/patients/${patient.id}`}>{patient.name}</Link></td>
                      <td>{patient.phone ?? '—'}</td><td>{patient.email ?? '—'}</td><td>{patient.dni ?? '—'}</td><td>{patient.insurance_name ?? '—'}</td>
                      <td><Link href={`/patients/${patient.id}`}>Abrir timeline</Link></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Turnos</h2>
            {appointments.length === 0 ? <p className="muted">No se encontraron turnos.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>Fecha</th><th>Paciente</th><th>Servicio</th><th>Estado</th><th>Monto</th><th>Acciones</th></tr></thead>
                  <tbody>{appointments.map((appointment) => {
                    const patientName = appointment.patient_id ? relatedName(appointment.patients, 'Paciente') : appointment.guest_name ?? 'Sin paciente';
                    return (
                      <tr key={appointment.id}>
                        <td>{new Date(appointment.starts_at).toLocaleString('es-AR')}</td>
                        <td>{appointment.patient_id ? <Link href={`/patients/${appointment.patient_id}`}>{patientName}</Link> : patientName}</td>
                        <td>{relatedName(appointment.services, 'Sin servicio')}</td>
                        <td>{appointment.status}</td>
                        <td>{appointment.quoted_amount != null ? `${appointment.currency} ${appointment.quoted_amount}` : '—'}</td>
                        <td><Link href="/agenda">Abrir agenda</Link></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Pagos</h2>
            {payments.length === 0 ? <p className="muted">No se encontraron pagos.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>Fecha</th><th>Paciente</th><th>Monto</th><th>Método</th><th>Acciones</th></tr></thead>
                  <tbody>{payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{new Date(payment.created_at).toLocaleString('es-AR')}</td>
                      <td>{payment.patient_id ? <Link href={`/patients/${payment.patient_id}`}>{relatedName(payment.patients, 'Paciente')}</Link> : 'Sin paciente'}</td>
                      <td>{payment.currency} {payment.amount}</td>
                      <td>{payment.method}</td>
                      <td><Link href="/payments">Abrir pagos</Link></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Seguimientos</h2>
            {followUps.length === 0 ? <p className="muted">No se encontró ese texto en seguimientos.</p> : followUps.map((item) => (
              <article key={item.id} style={{ padding: '12px 0', borderBottom: '1px solid #e5e7eb' }}>
                <small className="muted">{new Date(item.created_at).toLocaleString('es-AR')} · {relatedName(item.patients, 'Paciente')}</small>
                <p style={{ whiteSpace: 'pre-wrap' }}>{item.content}</p>
                <Link href={`/patients/${item.patient_id}`}>Abrir paciente</Link>
              </article>
            ))}
          </div>

          <div className="card">
            <h2>Ficha del paciente</h2>
            {records.length === 0 ? <p className="muted">No se encontró ese texto en fichas.</p> : records.map((item) => {
              const detail = item.reason || item.follow_up || item.background || item.notes || item.plan || 'Coincidencia en ficha';
              return (
                <article key={item.id} style={{ padding: '12px 0', borderBottom: '1px solid #e5e7eb' }}>
                  <small className="muted">{new Date(item.updated_at).toLocaleString('es-AR')} · {relatedName(item.patients, 'Paciente')}</small>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{detail}</p>
                  <Link href={`/patients/${item.patient_id}`}>Abrir timeline</Link>
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}
