import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth/require-user';
import { EmptyState } from '@/components/ui/EmptyState';
import { MisRxDraftProductSearch } from '@/components/patients/MisRxDraftProductSearch';
import { MisRxDraftClinicalData } from '@/components/patients/MisRxDraftClinicalData';
import { removePrescriptionItem } from '../../../prescription-actions';

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
      .select('id,name,dni,birth_date,sex')
      .eq('id', patientId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('prescriptions')
      .select('id,patient_id,professional_id,status,convention_id,affiliate_id,diagnosis,cie10,observations,long_term_treatment,created_at')
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

  return (
    <section className="stack">
      <p><Link href={`/patients/${patient.id}#recetas`}>← Volver a recetas de {patient.name}</Link></p>

      {query.error ? <p className="alert error">{query.error}</p> : null}
      {query.success === 'item-added' ? <p className="alert success">Medicamento agregado al borrador.</p> : null}
      {query.success === 'item-removed' ? <p className="alert success">Medicamento quitado del borrador.</p> : null}
      {query.success === 'metadata-updated' ? <p className="alert success">Datos del borrador actualizados.</p> : null}

      <div className="card">
        <div className="page-header">
          <div>
            <p className="text-helper" style={{ marginBottom: 4 }}>Receta electrónica · borrador</p>
            <h1 style={{ margin: 0 }}>{patient.name}</h1>
          </div>
          <span className="badge badge-neutral">Borrador</span>
        </div>
        <p className="text-helper">
          Este borrador permanece dentro de TurnIA. Ninguna acción de esta pantalla emite una receta en MisRX.
        </p>
        {!patientDataComplete ? (
          <p className="alert">
            Para una futura emisión faltan datos del paciente. Revisá DNI, fecha de nacimiento y sexo en la pestaña Datos.
          </p>
        ) : null}
        {prescription.diagnosis ? <p><strong>Diagnóstico:</strong> {prescription.diagnosis}</p> : null}
        {prescription.cie10 ? <p><strong>CIE-10:</strong> {prescription.cie10}</p> : null}
        {prescription.observations ? <p><strong>Indicaciones:</strong> {prescription.observations}</p> : null}
      </div>

      {editable ? (
        <div className="card">
          <h2>Datos de la receta</h2>
          <MisRxDraftClinicalData
            patientId={patient.id}
            prescriptionId={prescription.id}
            connected={misRxConnected}
            initialConventionId={prescription.convention_id}
            initialAffiliateId={(prescription as any).affiliate_id}
            initialDiagnosis={prescription.diagnosis}
            initialCie10={prescription.cie10}
            initialObservations={prescription.observations}
            initialLongTermTreatment={prescription.long_term_treatment}
          />
        </div>
      ) : null}

      <div className="card">
        <h2>Medicamentos</h2>
        {!items || items.length === 0 ? (
          <EmptyState title="Todavía no hay medicamentos en este borrador" />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {items.map((item: any) => (
              <div key={item.id} className="integration-row">
                <div className="integration-row-name">
                  {item.brand || item.generic_name || 'Medicamento'}
                </div>
                <div className="integration-row-desc">
                  {[item.generic_name, item.presentation, item.potency, item.laboratory].filter(Boolean).join(' · ')}
                  {item.quantity ? ` · Cantidad ${item.quantity}` : ''}
                  {item.coverage_percentage != null ? ` · Cobertura ${item.coverage_percentage}%` : ''}
                </div>
                {editable ? (
                  <form action={removePrescriptionItem} style={{ marginTop: 8 }}>
                    <input type="hidden" name="patientId" value={patient.id} />
                    <input type="hidden" name="prescriptionId" value={prescription.id} />
                    <input type="hidden" name="itemId" value={item.id} />
                    <button className="btn-ghost" type="submit">Quitar</button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {editable ? (
        <div className="card">
          <h2>Agregar medicamento</h2>
          <MisRxDraftProductSearch
            patientId={patient.id}
            prescriptionId={prescription.id}
            connected={misRxConnected}
            initialConventionId={prescription.convention_id}
          />
        </div>
      ) : null}

      <div className="card">
        <h2>Emisión</h2>
        <button className="btn" type="button" disabled>Emitir receta</button>
        <p className="field-hint" style={{ marginBottom: 0 }}>
          La emisión permanecerá bloqueada hasta contar con soft_id oficial, credenciales habilitadas y homologación de MisRX/Preserfar.
        </p>
      </div>
    </section>
  );
}
