import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { getMisRxAdapterForUser, isMisRxProviderConfigured } from '@/lib/misrx/service';
import { getMisRxConventionRules, getMisRxMaxProducts } from '@/lib/misrx/convention-rules';
import { getMisRxHomologationConfig } from '@/lib/misrx/homologation';

type Check = {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
};

function patientSexCanMap(value: string | null | undefined) {
  return value === 'masculino' || value === 'femenino' || value === 'otro';
}

function digits(value: string | null | undefined) {
  return value?.replace(/\D/g, '') ?? '';
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
      .select('id,dni,birth_date,sex,insurance_member_number')
      .eq('id', prescription.patient_id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('prescription_items')
      .select('id,provider_product_id,quantity')
      .eq('prescription_id', prescription.id),
  ]);

  const rules = getMisRxConventionRules(prescription.convention_id);
  const maxProducts = getMisRxMaxProducts(prescription.convention_id);
  const homologation = getMisRxHomologationConfig();
  const homologationActive = Boolean(
    homologation.enabled &&
    homologation.conventionId &&
    prescription.convention_id === homologation.conventionId
  );

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
        ? `Convenio ${prescription.convention_id} seleccionado.`
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

  if (maxProducts) {
    checks.push({
      key: 'item-limit',
      ok: (items?.length ?? 0) <= maxProducts,
      label: 'Límite de medicamentos',
      detail: (items?.length ?? 0) <= maxProducts
        ? `Este convenio admite hasta ${maxProducts} medicamentos y el borrador cumple el límite.`
        : `Este convenio admite como máximo ${maxProducts} medicamentos por receta.`,
    });
  }

  if (rules?.validityDays) {
    checks.push({
      key: 'validity',
      ok: true,
      label: 'Vigencia informativa',
      detail: `MisRX informó una vigencia de ${rules.validityDays} días para este convenio. TurnIA no envía un campo de vigencia adicional.`,
    });
  }

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

  if (homologationActive) {
    const expectedDni = digits(homologation.patientDni);
    const currentDni = digits(patient?.dni);
    const expectedCredential = homologation.patientCredential?.trim() ?? '';
    const currentCredential = patient?.insurance_member_number?.trim() ?? '';

    checks.push({
      key: 'homologation-doctor',
      ok: Boolean(homologation.doctorId),
      label: 'Médico de homologación',
      detail: homologation.doctorId
        ? `Se usará medico_id ${homologation.doctorId} sólo en modo homologación.`
        : 'Falta configurar el medico_id entregado por MisRX para homologación.',
    });

    checks.push({
      key: 'homologation-patient',
      ok: Boolean(
        expectedDni &&
        expectedCredential &&
        currentDni === expectedDni &&
        currentCredential === expectedCredential
      ),
      label: 'Paciente de homologación',
      detail: !expectedDni || !expectedCredential
        ? 'Faltan configurar los datos del paciente de prueba de MisRX.'
        : currentDni === expectedDni && currentCredential === expectedCredential
          ? 'El paciente del borrador coincide con los datos de prueba configurados para homologación.'
          : 'El paciente del borrador no coincide con el DNI/credencial configurados para homologación.',
    });
  }

  const adapterResult = await getMisRxAdapterForUser({ tenantId, userId: user.id });

  if (!adapterResult.ok) {
    checks.push({
      key: 'connection',
      ok: false,
      label: 'Conexión MisRX',
      detail: adapterResult.errorMessage,
    });
  } else {
    const sessionResult = await adapterResult.data.testSession();
    checks.push({
      key: 'connection',
      ok: sessionResult.ok,
      label: 'Conexión MisRX',
      detail: sessionResult.ok
        ? 'Login y sesión Bearer validados contra el endpoint oficial /test.'
        : 'No se pudo validar la sesión de la cuenta MisRX conectada.',
    });
  }

  const ready = checks.every((check) => check.ok);

  return NextResponse.json({
    ready,
    liveIssuingEnabled: Boolean(homologationActive && homologation.issuingEnabled),
    homologation: {
      enabled: homologation.enabled,
      activeForConvention: homologationActive,
    },
    checks,
  }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
