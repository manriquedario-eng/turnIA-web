import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth/require-user';
import { archivePatient, createManualFollowUp, updatePatient } from '../actions';

type TimelineItem = {
  id: string;
  at: string;
  type: 'Turno' | 'Pago' | 'Seguimiento' | 'Ficha';
  title: string;
  detail?: string;
};

export default async function PatientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, tenantId } = await requireTenant();

  const [patientResult, followUpResult, appointmentResult, paymentResult, recordResult] = await Promise.all([
    supabase
      .from('patients')
      .select('id,name,phone,email,dni,insurance_name,insurance_member_number,insurance_plan,care_location,default_price,created_at')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('patient_follow_ups')
      .select('id,content,source_type,created_at,professional_id')
      .eq('patient_id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('appointments')
      .select('id,starts_at,status,modality,quoted_amount,currency,services(name)')
      .eq('patient_id', id)
      .eq('tenant_id', tenantId)
      .order('starts_at', { ascending: false }),
    supabase
      .from('payments')
      .select('id,appointment_id,amount,currency,method,created_at')
      .eq('patient_id', id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('patient_records')
      .select('id,reason,follow_up,background,notes,plan,updated_at')
      .eq('patient_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  const patient = patientResult.data;
  const followUps = followUpResult.data ?? [];
  const appointments = appointmentResult.data ?? [];
  const payments = paymentResult.data ?? [];
  const record = recordResult.data;

  if (!patient) notFound();

  const timeline: TimelineItem[] = [
    ...appointments.map((item: any) => ({
      id: `appointment-${item.id}`,
      at: item.starts_at,
      type: 'Turno' as const,
      title: `${item.services?.name ?? 'Servicio'} · ${item.status}`,
      detail: `${item.modality}${item.quoted_amount != null ? ` · ${item.currency} ${item.quoted_amount}` : ''}`,
    })),
    ...payments.map((item: any) => ({
      id: `payment-${item.id}`,
      at: item.created_at,
      type: 'Pago' as const,
      title: `${item.currency} ${item.amount}`,
      detail: item.method,
    })),
    ...followUps.map((item: any) => ({
      id: `followup-${item.id}`,
      at: item.created_at,
      type: 'Seguimiento' as const,
      title: item.source_type === 'manual_text' ? 'Seguimiento manual' : item.source_type,
      detail: item.content,
    })),
    ...(record ? [{
      id: `record-${record.id}`,
      at: record.updated_at,
      type: 'Ficha' as const,
      title: 'Ficha del paciente actualizada',
      detail: record.reason || record.follow_up || record.notes || record.plan || undefined,
    }] : []),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <section>
      <p><Link href="/patients">← Volver a pacientes</Link></p>
      <h1>{patient.name}</h1>
      <p className="muted">Ficha protegida por tenant y RLS.</p>

      {query.error ? <p className="alert error">{query.error}</p> : null}
      {query.success === 'updated' ? <p className="alert success">Datos actualizados.</p> : null}
      {query.success === 'followup' ? <p className="alert success">Seguimiento guardado.</p> : null}

      <div className="card" style={{ marginTop: 20 }}>
        <h2>Datos del paciente</h2>
        <form action={updatePatient} className="form-grid">
          <input type="hidden" name="id" value={patient.id} />
          <label>Nombre<input name="name" defaultValue={patient.name} required minLength={2} maxLength={160} /></label>
          <label>Teléfono<input name="phone" defaultValue={patient.phone ?? ''} maxLength={160} /></label>
          <label>Email<input name="email" type="email" defaultValue={patient.email ?? ''} maxLength={200} /></label>
          <label>DNI<input name="dni" defaultValue={patient.dni ?? ''} maxLength={160} /></label>
          <label>Obra social<input name="insurance_name" defaultValue={patient.insurance_name ?? ''} maxLength={160} /></label>
          <label>Nº afiliado<input name="insurance_member_number" defaultValue={patient.insurance_member_number ?? ''} maxLength={160} /></label>
          <label>Plan<input name="insurance_plan" defaultValue={patient.insurance_plan ?? ''} maxLength={160} /></label>
          <label>Lugar de atención<input name="care_location" defaultValue={patient.care_location ?? ''} maxLength={160} /></label>
          <label>Precio habitual<input name="default_price" type="number" min="0" step="0.01" defaultValue={patient.default_price ?? ''} /></label>
          <div><button type="submit">Guardar cambios</button></div>
        </form>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2>Timeline del paciente</h2>
        <p className="muted">Turnos, pagos, seguimientos y actualización de ficha en una sola línea de tiempo.</p>
        {timeline.length === 0 ? <p className="muted">Todavía no hay actividad registrada.</p> : timeline.map((item) => (
          <article key={item.id} style={{ padding: '12px 0', borderBottom: '1px solid #e5e7eb' }}>
            <small className="muted">{new Date(item.at).toLocaleString('es-AR')} · {item.type}</small>
            <p style={{ marginBottom: item.detail ? 4 : 0 }}><strong>{item.title}</strong></p>
            {item.detail ? <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{item.detail}</p> : null}
          </article>
        ))}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2>Nuevo seguimiento</h2>
        <form action={createManualFollowUp}>
          <input type="hidden" name="patientId" value={patient.id} />
          <label>
            Nota de seguimiento
            <textarea name="content" required minLength={2} maxLength={10000} rows={5} style={{ width: '100%' }} />
          </label>
          <button type="submit" style={{ marginTop: 12 }}>Guardar seguimiento</button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2>Historial de seguimientos</h2>
        {followUps.map((item) => (
          <article key={item.id} style={{ padding: '12px 0', borderBottom: '1px solid #e5e7eb' }}>
            <small className="muted">{new Date(item.created_at).toLocaleString('es-AR')} · {item.source_type === 'manual_text' ? 'Manual' : item.source_type}</small>
            <p style={{ whiteSpace: 'pre-wrap' }}>{item.content}</p>
          </article>
        ))}
        {!followUps.length ? <p className="muted">Todavía no hay seguimientos.</p> : null}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2>Archivar paciente</h2>
        <p className="muted">No elimina físicamente los datos. Marca el paciente como archivado.</p>
        <form action={archivePatient}>
          <input type="hidden" name="id" value={patient.id} />
          <button type="submit">Archivar</button>
        </form>
      </div>
    </section>
  );
}
