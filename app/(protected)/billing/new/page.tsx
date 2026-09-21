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
    .select('id,name,dni,email,default_price,insurance_name,insurance_member_number,insurance_plan,billing_entity_id,fiscal_cuit,fiscal_vat_condition_id,fiscal_address,fiscal_email')
    .eq('id', query.patient)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (patientError || !patient) notFound();

  const [{ data: billingEntities }, { data: rawAppointments }, arcaConnection] = await Promise.all([
    supabase
      .from('billing_entities')
      .select('id,display_name,legal_name,cuit,vat_condition_id,commercial_address,billing_email,default_sale_condition')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('display_name', { ascending: true }),
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
          .filter((invoice: any) => invoice.status === 'draft' || invoice.status === 'authorizing' || invoice.status === 'authorized')
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

  const payers = (billingEntities ?? []).map((entity: any) => ({
    id: entity.id as string,
    displayName: entity.display_name as string,
    legalName: entity.legal_name ?? entity.display_name ?? '',
    cuit: entity.cuit ?? '',
    vatConditionId: entity.vat_condition_id ?? null,
    address: entity.commercial_address ?? '',
    email: entity.billing_email ?? '',
    saleCondition: entity.default_sale_condition ?? 'cuenta_corriente',
  }));

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

      <BillingDraftForm
        patient={{
          id: patient.id,
          name: patient.name,
          dni: patient.dni ?? null,
          defaultPrice: patient.default_price == null ? null : Number(patient.default_price),
          insuranceName: patient.insurance_name ?? null,
          insuranceMemberNumber: patient.insurance_member_number ?? null,
          insurancePlan: patient.insurance_plan ?? null,
          fiscalCuit: patient.fiscal_cuit ?? null,
          fiscalVatConditionId: patient.fiscal_vat_condition_id ?? null,
          fiscalAddress: patient.fiscal_address ?? null,
          fiscalEmail: patient.fiscal_email ?? patient.email ?? null,
        }}
        payers={payers}
        defaultPayerId={patient.billing_entity_id ?? null}
        appointments={appointments}
        initialSelectedIds={initialSelectedIds}
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
