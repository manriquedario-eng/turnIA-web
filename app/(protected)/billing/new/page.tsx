import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth/require-user';
import { getArcaConnectionSummary } from '@/lib/arca/wsaa';
import { BillingDraftForm } from '@/components/billing/BillingDraftForm';

const TZ = 'America/Argentina/Buenos_Aires';

function dateInArgentina(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

export default async function NewBillingInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ patient?: string; error?: string }>;
}) {
  const query = await searchParams;
  const { supabase, user, tenantId } = await requireTenant();

  const { data: patients, error: patientsError } = await supabase
    .from('patients')
    .select('id,name,dni,insurance_name')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (patientsError) {
    throw new Error(`No se pudieron cargar los pacientes: ${patientsError.message}`);
  }

  if (!query.patient) {
    return (
      <section className="stack">
        <div className="page-header">
          <div>
            <p><Link href="/billing">← Volver a Facturación</Link></p>
            <h1>Nueva factura</h1>
            <p className="muted">Elegí el paciente cuyas sesiones querés facturar.</p>
          </div>
        </div>

        {query.error ? <p className="alert error">{query.error}</p> : null}

        <div className="card">
          <form method="get" action="/billing/new" className="form-grid">
            <label style={{ gridColumn: '1 / -1' }}>
              Paciente
              <select name="patient" defaultValue="" required>
                <option value="" disabled>Seleccionar paciente...</option>
                {(patients ?? []).map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.name}{patient.dni ? ` · DNI ${patient.dni}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button className="btn" type="submit">Continuar</button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('id,name,dni,default_price,insurance_name,billing_entity_id')
    .eq('id', query.patient)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (patientError || !patient) notFound();

  const [{ data: billingEntity }, { data: rawAppointments }, arcaConnection] = await Promise.all([
    patient.billing_entity_id
      ? supabase
          .from('billing_entities')
          .select('id,display_name,legal_name,cuit,vat_condition_id,commercial_address,billing_email,default_sale_condition')
          .eq('id', patient.billing_entity_id)
          .eq('tenant_id', tenantId)
          .is('deleted_at', null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('appointments')
      .select('id,starts_at,status,quoted_amount,services(name)')
      .eq('tenant_id', tenantId)
      .eq('patient_id', patient.id)
      .lte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: false })
      .limit(48),
    getArcaConnectionSummary({ tenantId, userId: user.id }),
  ]);

  const candidates = (rawAppointments ?? []).filter(
    (appointment: any) => appointment.status !== 'cancelled' && appointment.status !== 'cancelado',
  );

  const candidateIds = candidates.map((appointment: any) => appointment.id);
  const blockedAppointmentIds = new Set<string>();

  if (candidateIds.length > 0) {
    const { data: links } = await supabase
      .from('billing_invoice_appointments')
      .select('appointment_id,invoice_id')
      .eq('tenant_id', tenantId)
      .in('appointment_id', candidateIds);

    const invoiceIds = Array.from(new Set((links ?? []).map((row: any) => row.invoice_id)));
    if (invoiceIds.length > 0) {
      const { data: linkedInvoices } = await supabase
        .from('billing_invoices')
        .select('id,status')
        .eq('tenant_id', tenantId)
        .in('id', invoiceIds);

      const blockingInvoiceIds = new Set(
        (linkedInvoices ?? [])
          .filter((invoice: any) => invoice.status === 'draft' || invoice.status === 'authorized')
          .map((invoice: any) => invoice.id),
      );

      for (const link of links ?? []) {
        if (blockingInvoiceIds.has((link as any).invoice_id)) {
          blockedAppointmentIds.add((link as any).appointment_id);
        }
      }
    }
  }

  const appointments = candidates
    .filter((appointment: any) => !blockedAppointmentIds.has(appointment.id))
    .map((appointment: any) => ({
      id: appointment.id as string,
      startsAt: appointment.starts_at as string,
      serviceName: appointment.services?.name ?? 'Sesión',
      amount: appointment.quoted_amount == null ? null : Number(appointment.quoted_amount),
    }));

  const today = dateInArgentina(new Date());
  const currentMonthStart = monthStart(today);
  const initialSelectedIds = appointments
    .filter((appointment) => {
      const date = dateInArgentina(appointment.startsAt);
      return date >= currentMonthStart && date <= today;
    })
    .map((appointment) => appointment.id);

  const recipientLegalName =
    billingEntity?.legal_name ??
    billingEntity?.display_name ??
    patient.insurance_name ??
    '';

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <p><Link href="/billing">← Volver a Facturación</Link></p>
          <h1>Nueva factura</h1>
          <p className="muted">
            Paciente: <strong>{patient.name}</strong>{patient.dni ? ` · DNI ${patient.dni}` : ''}
          </p>
        </div>
        <Link className="btn secondary" href={`/patients/${patient.id}`}>Ver paciente</Link>
      </div>

      {query.error ? <p className="alert error">{query.error}</p> : null}

      {!billingEntity ? (
        <p className="alert">
          Este paciente todavía no tiene un pagador fiscal vinculado. Podés completar los datos del receptor en esta factura,
          pero conviene guardarlos también desde la ficha del paciente para reutilizarlos.
        </p>
      ) : null}

      <BillingDraftForm
        patient={{
          id: patient.id,
          name: patient.name,
          dni: patient.dni ?? null,
          defaultPrice: patient.default_price == null ? null : Number(patient.default_price),
        }}
        appointments={appointments}
        initialSelectedIds={initialSelectedIds}
        recipient={{
          billingEntityId: billingEntity?.id ?? null,
          legalName: recipientLegalName,
          cuit: billingEntity?.cuit ?? '',
          vatConditionId: billingEntity?.vat_condition_id ?? null,
          address: billingEntity?.commercial_address ?? '',
          email: billingEntity?.billing_email ?? '',
          saleCondition: billingEntity?.default_sale_condition ?? 'cuenta_corriente',
        }}
        arca={{
          pointOfSale: arcaConnection?.puntoVenta ?? 3,
          activityCode: arcaConnection?.activityCode ?? '',
          activityDescription: arcaConnection?.activityDescription ?? '',
        }}
        today={today}
        monthStart={currentMonthStart}
      />
    </section>
  );
}
