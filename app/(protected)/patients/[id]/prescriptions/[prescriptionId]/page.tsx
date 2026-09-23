import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth/require-user';
import { EmptyState } from '@/components/ui/EmptyState';
import { MisRxDraftProductSearch } from '@/components/patients/MisRxDraftProductSearch';
import { MisRxDraftClinicalData } from '@/components/patients/MisRxDraftClinicalData';
import { MisRxReadinessPanel } from '@/components/patients/MisRxReadinessPanel';
import { removePrescriptionItem } from '../../../prescription-actions';

function patientDataState(value: unknown) {
  return value ? 'Listo' : 'Falta';
}

export default async function PrescriptionDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; prescriptionId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id: patientId, prescriptionId } = await params;
  const query = await searchParams;
  const { supabase, tenantId, user } = await requireTenant();

  const [{ data: patient }, { data: prescription }, { data: misRxStatus }] = await Promise.all([
    supabase
      .from('patients')
      .select('id,name,dni,birth_date,sex,insurance_name,insurance_member_number,insurance_plan')
      .eq('id', patientId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('prescriptions')
      .select('id,patient_id,professional_id,status,convention_id,plan_id,affiliate_id,diagnosis,cie10,observations,long_term_treatment,created_at')
      .eq('id', prescriptionId)
      .eq('patient_id', patientId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('integration_status')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('provider', 'misrx')
      .maybeSingle(),
  ]);

  if (!patient || !prescription) notFound();

  const { data: items } = await supabase
    .from('prescription_items')
    .select('id,provider_product_id,provider_product_code,brand,generic_name,presentation,potency,laboratory,quantity,coverage_percentage,print_brand,substitutable')
    .eq('prescription_id', prescription.id)
    .order('created_at', { ascending: true });

  const editable = prescription.status === 'draft' && prescription.professional_id === user.id;
  const misRxConnected = misRxStatus?.status === 'connected';
  const patientDataComplete = Boolean(patient.dni && patient.birth_date && patient.sex);
  const dataChecks = [
    { label: 'DNI / documento', value: patient.dni },
    { label: 'Fecha de nacimiento', value: patient.birth_date },
    { label: 'Sexo', value: patient.sex },
    { label: 'Nº afiliado / credencial', value: patient.insurance_member_number },
  ];

  return (
    <section className="stack prescription-editor">
      <div className="prescription-editor-breadcrumbs">
        <Link href="/prescriptions">← Recetas</Link>
        <span>·</span>
        <Link href={`/patients/${patient.id}`}>{patient.name}</Link>
      </div>

      {query.error ? <p className="alert error">{query.error}</p> : null}
      {query.success === 'item-added' ? <p className="alert success">Medicamento agregado al borrador.</p> : null}
      {query.success === 'item-removed' ? <p className="alert success">Medicamento quitado del borrador.</p> : null}
      {query.success === 'metadata-updated' ? <p className="alert success">Datos del borrador actualizados.</p> : null}

      <div className="card prescription-editor-hero">
        <div className="page-header">
          <div>
            <p className="page-eyebrow">Receta electrónica · MisRX</p>
            <h1 style={{ margin: 0 }}>{patient.name}</h1>
            <p className="text-helper" style={{ margin: '6px 0 0' }}>
              Prepará el borrador por etapas. La emisión permanece separada y protegida por una verificación final.
            </p>
          </div>
          <span className={`badge ${prescription.status === 'draft' ? 'badge-neutral' : 'badge-confirmado'}`}>
            {prescription.status === 'draft' ? 'Borrador' : prescription.status}
          </span>
        </div>
      </div>

      <div className="card misrx-step-card">
        <div className="misrx-step-heading">
          <span className="misrx-step-number">1</span>
          <div>
            <h2>Paciente y cobertura</h2>
            <p className="text-helper">
              Datos que TurnIA usa para buscar y validar al afiliado en MisRX.
            </p>
          </div>
          <Link className="btn secondary btn-compact" href={`/patients/${patient.id}#datos`}>
            Editar datos
          </Link>
        </div>

        <div className="misrx-data-grid">
          {dataChecks.map((check) => (
            <div key={check.label} className="misrx-data-item">
              <span>{check.label}</span>
              <strong>{check.value || 'Sin cargar'}</strong>
              <small className={check.value ? 'is-ready' : 'is-missing'}>{patientDataState(check.value)}</small>
            </div>
          ))}
        </div>

        {!patientDataComplete ? (
          <p className="alert" style={{ marginBottom: 0 }}>
            Para identificar manualmente al paciente faltan datos básicos. Completá al menos DNI, fecha de nacimiento y sexo.
          </p>
        ) : null}

        {(patient.insurance_name || patient.insurance_plan) ? (
          <p className="field-hint" style={{ marginBottom: 0 }}>
            Cobertura en TurnIA: {[patient.insurance_name, patient.insurance_plan].filter(Boolean).join(' · ')}.
          </p>
        ) : null}
      </div>

      {editable ? (
        <div className="card misrx-step-card">
          <div className="misrx-step-heading">
            <span className="misrx-step-number">2</span>
            <div>
              <h2>Convenio y datos clínicos</h2>
              <p className="text-helper">
                Elegí el convenio, buscá el afiliado y completá diagnóstico e indicaciones.
              </p>
            </div>
          </div>
          <MisRxDraftClinicalData
            patientId={patient.id}
            prescriptionId={prescription.id}
            connected={misRxConnected}
            initialConventionId={prescription.convention_id}
            initialAffiliateId={(prescription as any).affiliate_id}
            initialPlanId={(prescription as any).plan_id}
            initialDiagnosis={prescription.diagnosis}
            initialCie10={prescription.cie10}
            initialObservations={prescription.observations}
            initialLongTermTreatment={prescription.long_term_treatment}
            patientName={patient.name}
            patientDni={patient.dni}
            patientCredential={patient.insurance_member_number}
            patientInsuranceName={patient.insurance_name}
            patientInsurancePlan={patient.insurance_plan}
          />
        </div>
      ) : null}

      <div className="card misrx-step-card">
        <div className="misrx-step-heading">
          <span className="misrx-step-number">3</span>
          <div>
            <h2>Medicamentos</h2>
            <p className="text-helper">
              Revisá lo agregado y buscá nuevos productos directamente en MisRX.
            </p>
          </div>
        </div>

        {!items || items.length === 0 ? (
          <EmptyState title="Todavía no hay medicamentos en este borrador" />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {items.map((item: any) => (
              <div key={item.id} className="prescription-row prescription-item-row">
                <div className="prescription-row-main">
                  <div className="prescription-row-title">
                    <span>{item.brand || item.generic_name || 'Medicamento'}</span>
                    <span className="badge badge-neutral">Cantidad {item.quantity || 1}</span>
                  </div>
                  <div className="prescription-row-desc">
                    {[item.generic_name, item.presentation, item.potency, item.laboratory].filter(Boolean).join(' · ')}
                    {item.coverage_percentage != null ? ` · Cobertura ${item.coverage_percentage}%` : ''}
                  </div>
                </div>
                {editable ? (
                  <div className="prescription-row-actions">
                    <form action={removePrescriptionItem}>
                      <input type="hidden" name="patientId" value={patient.id} />
                      <input type="hidden" name="prescriptionId" value={prescription.id} />
                      <input type="hidden" name="itemId" value={item.id} />
                      <button className="btn-ghost" type="submit">Quitar</button>
                    </form>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {editable ? (
          <div className="misrx-product-search-block">
            <MisRxDraftProductSearch
              patientId={patient.id}
              prescriptionId={prescription.id}
              connected={misRxConnected}
              initialConventionId={prescription.convention_id}
              initialAffiliateId={prescription.affiliate_id}
              initialPlanId={prescription.plan_id}
              currentItemCount={items?.length ?? 0}
            />
          </div>
        ) : null}
      </div>

      <div className="card misrx-step-card misrx-readiness-card">
        <div className="misrx-step-heading">
          <span className="misrx-step-number">4</span>
          <div>
            <h2>Verificación final</h2>
            <p className="text-helper">
              TurnIA controla la receta antes de permitir cualquier envío de homologación.
            </p>
          </div>
        </div>
        <MisRxReadinessPanel prescriptionId={prescription.id} />
        <p className="field-hint" style={{ marginBottom: 0 }}>
          Producción sigue bloqueada. En Preview la emisión de prueba sólo se habilita cuando la configuración de homologación lo permite explícitamente.
        </p>
      </div>
    </section>
  );
}
