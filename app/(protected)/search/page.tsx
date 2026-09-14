import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';

function safeTerm(value: string) {
  return value.replace(/[%_,()]/g, ' ').trim().slice(0, 100);
}

function relatedPatientName(value: unknown) {
  if (Array.isArray(value)) return value[0]?.name ?? 'Paciente';
  if (value && typeof value === 'object' && 'name' in value) {
    return String((value as { name?: unknown }).name ?? 'Paciente');
  }
  return 'Paciente';
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

  if (q.length >= 2) {
    const pattern = `%${q}%`;
    const [patientResult, followUpResult, recordResult] = await Promise.all([
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
    ]);

    patients = patientResult.data ?? [];
    followUps = followUpResult.data ?? [];
    records = recordResult.data ?? [];
  }

  return (
    <section className="stack">
      <div>
        <h1>Búsqueda global</h1>
        <p className="muted">Busca dentro del consultorio actual por paciente, teléfono, email, DNI, obra social, seguimientos o contenido de ficha.</p>
      </div>

      <div className="card">
        <form method="get" className="nav" style={{ flexWrap: 'wrap' }}>
          <input name="q" defaultValue={q} placeholder="Ej.: García, 261..., DNI, Swiss Medical" minLength={2} maxLength={100} style={{ minWidth: 320 }} />
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
                  <thead><tr><th>Paciente</th><th>Teléfono</th><th>Email</th><th>DNI</th><th>Obra social</th></tr></thead>
                  <tbody>{patients.map((patient) => (
                    <tr key={patient.id}>
                      <td><Link href={`/patients/${patient.id}`}>{patient.name}</Link></td>
                      <td>{patient.phone ?? '—'}</td><td>{patient.email ?? '—'}</td><td>{patient.dni ?? '—'}</td><td>{patient.insurance_name ?? '—'}</td>
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
                <small className="muted">{new Date(item.created_at).toLocaleString('es-AR')} · {relatedPatientName(item.patients)}</small>
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
                  <small className="muted">{new Date(item.updated_at).toLocaleString('es-AR')} · {relatedPatientName(item.patients)}</small>
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
