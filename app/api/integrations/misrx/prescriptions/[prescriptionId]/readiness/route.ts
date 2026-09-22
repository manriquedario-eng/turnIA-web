import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { getMisRxAdapterForUser, isMisRxProviderConfigured } from '@/lib/misrx/service';

type Check = {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
};

function hasProfessionalProfile(profile: {
  nrodoc?: number;
  sexo?: string;
  apellido?: string;
  nombres?: string;
  tipo_matricula?: string;
  matricula?: number;
  especialidad_id?: number;
}) {
  return Boolean(
    profile.nrodoc &&
    profile.sexo &&
    profile.apellido?.trim() &&
    profile.nombres?.trim() &&
    profile.tipo_matricula?.trim() &&
    profile.matricula &&
    profile.especialidad_id
  );
}

function patientSexCanMap(value: string | null | undefined) {
  return value === 'masculino' || value === 'femenino' || value === 'otro';
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ prescriptionId: string }> },
) {
  const { prescriptionId } = await params;
  const { supabase, tenantId, user } = await requireTenant();

  const { data: prescription } = await supabase
    .from('prescriptions')
    .select('id,patient_id,professional_id,status,convention_id,affiliate_id')
    .eq('id', prescriptionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!prescription) {
    return NextResponse.json({ error: 'Borrador no encontrado.' }, { status: 404 });
  }

  if (prescription.professional_id !== user.id) {
    return NextResponse.json({ error: 'No tenés permiso para preparar esta receta.' }, { status: 403 });
  }

  const [{ data: patient }, { data: items }] = await Promise.all([
    supabase
      .from('patients')
      .select('id,dni,birth_date,sex')
      .eq('id', prescription.patient_id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('prescription_items')
      .select('id,provider_product_id,quantity')
      .eq('prescription_id', prescription.id),
  ]);

  const checks: Check[] = [
    {
      key: 'draft',
      ok: prescription.status === 'draft',
      label: 'Borrador editable',
      detail: prescription.status === 'draft'
        ? 'La receta todavía no fue enviada al proveedor.'
        : 'La receta ya no está en estado borrador.',
    },
    {
      key: 'soft-id',
      ok: isMisRxProviderConfigured(),
      label: 'soft_id oficial de TurnIA',
      detail: isMisRxProviderConfigured()
        ? 'El identificador del software integrador está configurado en el servidor.'
        : 'Falta configurar el soft_id oficial entregado por MisRX/Preserfar.',
    },
    {
      key: 'convention',
      ok: Boolean(prescription.convention_id),
      label: 'Convenio',
      detail: prescription.convention_id
        ? 'El borrador tiene un convenio seleccionado.'
        : 'Falta seleccionar el convenio de la receta.',
    },
    {
      key: 'items',
      ok: Boolean(items?.length) && Boolean(items?.every((item) =>
        item.provider_product_id && /^\d+$/.test(String(item.provider_product_id)) && Number(item.quantity) > 0
      )),
      label: 'Medicamentos',
      detail: items?.length
        ? 'Los medicamentos cargados tienen identificador MisRX y cantidad.'
        : 'Falta agregar al menos un medicamento.',
    },
  ];

  const affiliateReady = Boolean(prescription.affiliate_id);
  const manualPatientReady = Boolean(
    patient?.dni &&
    patient?.birth_date &&
    patientSexCanMap(patient?.sex)
  );

  checks.push({
    key: 'patient',
    ok: Boolean(patient) && (affiliateReady || manualPatientReady),
    label: 'Identificación del paciente',
    detail: affiliateReady
      ? 'El borrador tiene un afiliado MisRX seleccionado.'
      : manualPatientReady
        ? 'El paciente tiene DNI, fecha de nacimiento y sexo mapeable para identificación manual.'
        : 'Falta seleccionar afiliado MisRX o completar DNI, fecha de nacimiento y sexo del paciente.',
  });

  const adapterResult = await getMisRxAdapterForUser({ tenantId, userId: user.id });

  if (!adapterResult.ok) {
    checks.push({
      key: 'connection',
      ok: false,
      label: 'Conexión del profesional',
      detail: adapterResult.errorMessage,
    });
    checks.push({
      key: 'professional-profile',
      ok: false,
      label: 'Perfil profesional MisRX',
      detail: 'No se puede validar el perfil hasta conectar la cuenta MisRX del profesional.',
    });
  } else {
    const profileResult = await adapterResult.data.testConnection();
    checks.push({
      key: 'connection',
      ok: profileResult.ok,
      label: 'Conexión del profesional',
      detail: profileResult.ok
        ? 'La cuenta MisRX responde correctamente.'
        : 'No se pudo validar la cuenta MisRX conectada.',
    });
    checks.push({
      key: 'professional-profile',
      ok: profileResult.ok && hasProfessionalProfile(profileResult.data),
      label: 'Perfil profesional MisRX',
      detail: profileResult.ok && hasProfessionalProfile(profileResult.data)
        ? 'MisRX devuelve DNI, sexo, nombre, matrícula y especialidad suficientes para identificar al profesional.'
        : 'El perfil conectado no devuelve todos los datos profesionales necesarios.',
    });
  }

  const ready = checks.every((check) => check.ok);

  return NextResponse.json({
    ready,
    liveIssuingEnabled: false,
    checks,
  }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
