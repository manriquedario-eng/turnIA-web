import Link from 'next/link';
import { requireTenant } from '@/lib/auth/require-user';
import { createPatient } from './actions';
import { EmptyState } from '@/components/ui/EmptyState';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { PatientsTable } from '@/components/patients/PatientsTable';
import { IconPlus } from '@/components/ui/icons';
import { SimpleExportMenu } from '@/components/export/ExportMenu';
import { SALE_CONDITIONS, VAT_CONDITIONS } from '@/lib/billing/constants';

const TZ = 'America/Argentina/Buenos_Aires';

function isCancelled(status: string | null) {
  return status === 'cancelled' || status === 'cancelado';
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, dateStyle: 'short' }).format(new Date(iso));
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, tenantId } = await requireTenant();

  const [patientsResult, billingEntitiesResult] = await Promise.all([
    supabase
      .from('patients')
      .select('id,name,phone,email,insurance_name,care_location,created_at')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('billing_entities')
      .select('id,display_name,legal_name,cuit,vat_condition_id,commercial_address,billing_email,default_sale_condition')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('display_name', { ascending: true }),
  ]);

  const patients = patientsResult.data;
  const error = patientsResult.error;
  const billingEntities = billingEntitiesResult.data ?? [];

  if (error) {
    throw new Error(`No se pudieron cargar los pacientes: ${error.message}`);
  }

  const patientIds = (patients ?? []).map((p) => p.id);
  const appointmentsResult = patientIds.length
    ? await supabase
        .from('appointments')
        .select('id, patient_id, starts_at, status')
        .eq('tenant_id', tenantId)
        .in('patient_id', patientIds)
        .order('starts_at', { ascending: true })
    : { data: [] as { id: string; patient_id: string; starts_at: string; status: string | null }[] };

  const now = Date.now();
  const nextByPatient = new Map<string, { starts_at: string; status: string | null }>();
  const lastByPatient = new Map<string, { starts_at: string; status: string | null }>();
  for (const appt of appointmentsResult.data ?? []) {
    if (isCancelled(appt.status)) continue;
    if (!appt.patient_id) continue;
    if (new Date(appt.starts_at).getTime() >= now) {
      if (!nextByPatient.has(appt.patient_id)) nextByPatient.set(appt.patient_id, appt);
    } else {
      lastByPatient.set(appt.patient_id, appt);
    }
  }

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Pacientes</h1>
          <p className="muted">{patients?.length ?? 0} pacientes activos en el consultorio.</p>
        </div>
        <div className="nav" style={{ flexWrap: 'wrap' }}>
          <SimpleExportMenu
            links={[
              { format: 'pdf', href: '/api/export/patients?format=pdf' },
              { format: 'docx', href: '/api/export/patients?format=docx' },
              { format: 'xlsx', href: '/api/export/patients?format=xlsx' },
            ]}
          />
          <Link className="btn" href="#nuevo-paciente"><IconPlus /> Nuevo paciente</Link>
        </div>
      </div>

      {params.error ? <p className="alert error">{params.error}</p> : null}
      {params.success === 'created' ? <p className="alert success">Paciente creado correctamente.</p> : null}
      {params.success === 'archived' ? <p className="alert success">Paciente archivado correctamente.</p> : null}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {(patients ?? []).length === 0 ? (
          <div style={{ padding: 20 }}>
            <EmptyState title="Todavía no cargaste pacientes" description="Creá el primero con el formulario de abajo." />
          </div>
        ) : (
          <PatientsTable
            patients={(patients ?? []).map((patient) => {
              const next = nextByPatient.get(patient.id);
              const last = lastByPatient.get(patient.id);
              return {
                id: patient.id,
                name: patient.name,
                phone: patient.phone,
                email: patient.email,
                nextLabel: next ? formatDate(next.starts_at) : null,
                nextStatus: next ? next.status : null,
                lastLabel: last ? formatDate(last.starts_at) : null,
              };
            })}
          />
        )}
      </div>

      {/* Formulario dividido en grupos con nombre (Fase 4 del pedido: "no
          quiero campos flotando en una enorme card blanca") — antes eran 9
          campos sueltos en un mismo form-grid + un h3 aislado sólo para
          comunicación. Ahora 3 grupos con .form-section-divider (mismo
          patrón ya usado en Configuración): Datos personales / Obra social
          / Comunicación. Mismos names de campo, mismo server action. */}
      <div className="card" id="nuevo-paciente">
        <h2>Nuevo paciente</h2>
        <form action={createPatient} className="form-grid">
          <label>
            Nombre completo (nombres y apellidos)
            <input name="name" required minLength={2} maxLength={160} />
          </label>
          <label>
            Alias
            <input name="alias" maxLength={160} placeholder="Ej.: Euge" />
            <span className="text-helper">
              Nombre corto o preferido que TurnIA puede usar en WhatsApp, emails y recordatorios.
            </span>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" name="use_alias_for_communications" />
            Usar alias en comunicaciones
          </label>
          <PhoneInput />
          <label>Email<input name="email" type="email" maxLength={200} /></label>
          <label>DNI<input name="dni" maxLength={160} /></label>
          <label>Fecha de nacimiento<input name="birth_date" type="date" /></label>
          <label>
            Sexo
            <select name="sex" defaultValue="">
              <option value="">Sin informar</option>
              <option value="femenino">Femenino</option>
              <option value="masculino">Masculino</option>
              <option value="otro">Otro</option>
              <option value="no_informa">Prefiere no informar</option>
            </select>
          </label>
          <label>
            Escuela, colegio o institución
            <input name="institution_name" maxLength={240} placeholder="Opcional" />
            <span className="text-helper">
              Útil cuando el paciente fue derivado o acompañado por una institución educativa.
            </span>
          </label>
          <label>
            Domicilio real
            <input name="home_address" maxLength={240} placeholder="Calle, número, localidad" />
            <span className="text-helper">
              Domicilio habitual del paciente. Es distinto del domicilio fiscal.
            </span>
          </label>
          <label>Lugar de atención<input name="care_location" maxLength={160} /></label>
          <label>Precio habitual<input name="default_price" type="number" min="0" step="0.01" /></label>

          <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
            <h3>Obra social</h3>
          </div>
          <label>Obra social<input name="insurance_name" maxLength={160} /></label>
          <label>Nº afiliado<input name="insurance_member_number" maxLength={160} /></label>
          <label>Plan<input name="insurance_plan" maxLength={160} /></label>

          <details className="patient-data-disclosure" style={{ gridColumn: '1 / -1' }}>
            <summary>
              <span>
                <strong>Datos fiscales y facturación institucional</strong>
                <small>Opcional · completalos sólo si los necesitás</small>
              </span>
              <span className="patient-data-disclosure-action">Ver datos</span>
            </summary>
            <div className="form-grid patient-data-disclosure-grid">
          <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
            <h3>Datos fiscales del paciente</h3>
            <p className="text-helper" style={{ marginTop: 4 }}>
              Se usan cuando la factura se emite a nombre del paciente para que luego la presente a su obra social por reintegro.
            </p>
          </div>
          <label>CUIT del paciente<input name="fiscal_cuit" inputMode="numeric" placeholder="Opcional · 11 dígitos" maxLength={14} /></label>
          <label>
            Condición frente al IVA
            <select name="fiscal_vat_condition_id" defaultValue="5">
              {VAT_CONDITIONS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>Domicilio fiscal<input name="fiscal_address" maxLength={240} /></label>
          <label>Email fiscal<input name="fiscal_email" type="email" maxLength={200} /></label>

          <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
            <h3>Facturación directa a obra social / empresa</h3>
            <p className="text-helper" style={{ marginTop: 4 }}>
              Opcional. Usalo sólo si el profesional factura directamente a una obra social o empresa.
              Estos datos son del receptor institucional, no del paciente.
            </p>
          </div>

          <label>
            Obra social / empresa guardada
            <select name="billing_entity_id" defaultValue="">
              <option value="">Crear / completar uno nuevo</option>
              {billingEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.display_name}{entity.cuit ? ` · CUIT ${entity.cuit}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>Nombre comercial<input name="billing_display_name" maxLength={240} /></label>
          <label>Razón social<input name="billing_legal_name" maxLength={240} /></label>
          <label>CUIT<input name="billing_cuit" inputMode="numeric" placeholder="11 dígitos" maxLength={14} /></label>
          <label>
            Condición frente al IVA
            <select name="billing_vat_condition_id" defaultValue="">
              <option value="">Seleccionar...</option>
              {VAT_CONDITIONS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>Domicilio comercial / fiscal<input name="billing_address" maxLength={240} /></label>
          <label>Email de facturación<input name="billing_email" type="email" maxLength={200} /></label>
          <label>
            Condición de venta habitual
            <select name="billing_sale_condition" defaultValue="cuenta_corriente">
              {SALE_CONDITIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

            </div>
          </details>

          <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
            <h3>Comunicación y recordatorios</h3>
            <p className="text-helper" style={{ marginTop: 4 }}>
              Sin autorización explícita, no se enviará ningún mensaje automático en el futuro.
            </p>
            <label className="checkbox-field">
              <input type="checkbox" name="whatsapp_consent" />
              Autoriza recibir por WhatsApp confirmaciones y avisos operativos de sus turnos
            </label>
            <label className="checkbox-field" style={{ marginTop: 6 }}>
              <input type="checkbox" name="appointment_reminders_opt_in" />
              Recibir recordatorios automáticos 24 h antes (email y, si autorizó WhatsApp, también por WhatsApp)
            </label>
          </div>

          <div className="form-actions">
            <button className="btn" type="submit">Crear paciente</button>
          </div>
        </form>
      </div>
    </section>
  );
}
