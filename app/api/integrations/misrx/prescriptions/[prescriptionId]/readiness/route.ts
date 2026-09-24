import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { getMisRxAdapterForUser, isMisRxProviderConfigured } from '@/lib/misrx/service';
import { getMisRxConventionRules, getMisRxMaxProducts } from '@/lib/misrx/convention-rules';
import {
  getMisRxHomologationConfig,
  isMisRxProductionIssuingEnabled,
} from '@/lib/misrx/homologation';
import type { MisRxConvention, MisRxPlan } from '@/lib/misrx/types';

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

function positiveRule(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMemberNumber(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    : value == null
      ? ''
      : String(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ prescriptionId: string }> },
) {
  const { prescriptionId } = await params;
  const { supabase, tenantId, user } = await requireTenant();

  const { data: prescription } = await supabase
    .from('prescriptions')
    .select('id,patient_id,professional_id,status,convention_id,plan_id,affiliate_id,diagnosis,cie10,observations')
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
      .select('id,provider_product_id,quantity,substitutable,diagnosis,cie10')
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
      label: 'Configuración MisRX',
      detail: isMisRxProviderConfigured()
        ? 'El soft_id oficial de TurnIA está configurado en el servidor.'
        : 'Falta completar la configuración oficial de MisRX en el servidor.',
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
        item.provider_product_id &&
        /^\d+$/.test(String(item.provider_product_id)) &&
        Number(item.quantity) > 0
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
      detail: `MisRX informó una vigencia de ${rules.validityDays} días para este convenio. TurnIA no inventa ni envía un campo de vigencia adicional.`,
    });
  }

  const affiliateReady = Boolean(prescription.affiliate_id);
  const manualPatientDataAvailable = Boolean(
    patient?.dni &&
    patient?.birth_date &&
    patientSexCanMap(patient?.sex)
  );

  checks.push({
    key: 'patient',
    ok: Boolean(patient) && affiliateReady,
    label: 'Afiliado MisRX',
    detail: affiliateReady
      ? 'El borrador tiene un afiliado MisRX seleccionado.'
      : manualPatientDataAvailable
        ? 'Los datos básicos del paciente están completos, pero este flujo exige seleccionar la coincidencia devuelta por MisRX.'
        : 'Buscá y seleccioná el afiliado en MisRX. Si no aparece, revisá DNI, fecha de nacimiento, sexo y credencial.',
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
        ? `Se usará medico_id ${homologation.doctorId} sólo en homologación.`
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
          ? 'El paciente coincide con el DNI y la credencial de prueba de MisRX.'
          : 'El paciente no coincide con el DNI/credencial configurados para homologación.',
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
    const adapter = adapterResult.data;
    const sessionResult = await adapter.testSession();

    checks.push({
      key: 'connection',
      ok: sessionResult.ok,
      label: 'Conexión MisRX',
      detail: sessionResult.ok
        ? 'Login y sesión Bearer validados contra /test.'
        : 'No se pudo validar la sesión de la cuenta MisRX conectada.',
    });

    const prescriberResult = sessionResult.ok
      ? homologationActive
        ? await adapter.verifyExternalProvider()
        : await adapter.verifyPrescriber()
      : null;

    checks.push({
      key: 'prescriber',
      ok: Boolean(prescriberResult?.ok) && (!homologationActive || Boolean(homologation.doctorId)),
      label: homologationActive ? 'Profesional de homologación MisRX' : 'Profesional validado por MisRX',
      detail: prescriberResult?.ok
        ? homologationActive
          ? `Cuenta de prestador externo validada; la prueba usa medico_id ${homologation.doctorId ?? 'sin configurar'}.`
          : 'La identidad profesional fue validada por MisRX.'
        : homologationActive
          ? prescriberResult && !prescriberResult.ok
            ? prescriberResult.errorMessage
            : 'La cuenta conectada no pudo validarse como prestador externo de MisRX.'
          : prescriberResult && !prescriberResult.ok
            ? prescriberResult.errorMessage
            : 'La cuenta conectada no pudo validarse con identidad profesional completa.',
    });

    if (
      sessionResult.ok &&
      prescriberResult?.ok &&
      prescription.convention_id &&
      prescription.affiliate_id
    ) {
      const affiliateResult = await adapter.findAffiliate({
        convenioId: prescription.convention_id,
        affiliateId: prescription.affiliate_id,
        dni: digits(patient?.dni) || undefined,
        affiliateNumber: patient?.insurance_member_number?.trim() || undefined,
      });

      const affiliate = affiliateResult.ok
        ? affiliateResult.data.data.find(
            (item) => Number(item.afiliado_id) === Number(prescription.affiliate_id)
          )
        : undefined;

      const localDni = digits(patient?.dni);
      const providerDni = affiliate?.nrodoc == null ? '' : digits(String(affiliate.nrodoc));
      const localCredential = normalizeMemberNumber(patient?.insurance_member_number);
      const providerCredential = normalizeMemberNumber(affiliate?.nroafiliado);

      const dniMatches = !localDni || !providerDni || localDni === providerDni;
      const credentialMatches =
        !localCredential || !providerCredential || localCredential === providerCredential;

      // En homologación MisRX provee identificadores de prueba (DNI/credencial)
      // que sirven para resolver el afiliado del convenio 800. Una vez que
      // /busca_afiliado devuelve el afiliado_id seleccionado, no exigimos que
      // los identificadores canónicos internos de ese registro sean idénticos
      // a los valores de búsqueda. Producción conserva la validación estricta.
      const identityMatches = Boolean(
        affiliate &&
        (homologationActive || (dniMatches && credentialMatches))
      );

      const mismatchDetail = !affiliate
        ? 'MisRX respondió correctamente, pero el afiliado seleccionado ya no aparece en la respuesta.'
        : !dniMatches && !credentialMatches
          ? 'MisRX devuelve un DNI y una credencial distintos de los datos actuales del paciente.'
          : !dniMatches
            ? 'MisRX devuelve un DNI distinto del dato actual del paciente.'
            : !credentialMatches
              ? 'MisRX devuelve una credencial distinta del dato actual del paciente.'
              : 'El afiliado seleccionado ya no coincide con los datos actuales del paciente.';

      checks.push({
        key: 'affiliate-live',
        ok: Boolean(affiliateResult.ok && identityMatches),
        label: 'Afiliado validado en MisRX',
        detail: affiliateResult.ok
          ? identityMatches
            ? 'El afiliado seleccionado sigue vigente y coincide con los identificadores del paciente.'
            : mismatchDetail
          : 'No se pudo revalidar el afiliado seleccionado con MisRX.',
      });
    }

    let convention: MisRxConvention | undefined;
    if (sessionResult.ok && prescriberResult?.ok && prescription.convention_id) {
      const conventionsResult = await adapter.getEnabledConventions('');

      if (conventionsResult.ok) {
        convention = conventionsResult.data.data.find(
          (item) =>
            Number(item.convenio_id) === Number(prescription.convention_id) &&
            (item.autorizado == null || Number(item.autorizado) !== 0)
        );
      }

      if (!convention && homologationActive) {
        convention = {
          convenio_id: prescription.convention_id,
          nombre: 'Homologación MisRX',
          autorizado: 1,
        };
      }

      checks.push({
        key: 'convention-enabled',
        ok: Boolean(convention),
        label: 'Convenio habilitado',
        detail: convention
          ? 'El convenio está habilitado para este flujo.'
          : conventionsResult.ok
            ? 'El convenio seleccionado no figura habilitado para el profesional en MisRX.'
            : 'No se pudo comprobar en MisRX que el convenio siga habilitado.',
      });
    }

    if (convention) {
      if (Number(convention.digital_indica_prestador ?? 0) !== 0) {
        checks.push({
          key: 'provider-required',
          ok: false,
          label: 'Prestador requerido por convenio',
          detail: 'Este convenio exige seleccionar una institución prestadora. TurnIA bloquea la emisión hasta incorporar ese selector específico.',
        });
      }

      const hasDiagnosis = Boolean(prescription.diagnosis?.trim() || prescription.cie10?.trim());
      const hasCie10 = Boolean(prescription.cie10?.trim());

      if (convention.diagnostico_requerido) {
        checks.push({
          key: 'diagnosis-required',
          ok: convention.solo_cie10 ? hasCie10 : hasDiagnosis,
          label: convention.solo_cie10 ? 'CIE-10 requerido' : 'Diagnóstico requerido por convenio',
          detail: convention.solo_cie10
            ? hasCie10
              ? 'La receta tiene código CIE-10.'
              : 'Este convenio exige código CIE-10.'
            : hasDiagnosis
              ? 'El borrador tiene diagnóstico o código CIE-10.'
              : 'Este convenio exige diagnóstico o CIE-10.',
        });
      } else if (convention.solo_cie10 && prescription.diagnosis?.trim()) {
        checks.push({
          key: 'cie10-only',
          ok: hasCie10,
          label: 'CIE-10',
          detail: hasCie10
            ? 'El diagnóstico está acompañado por CIE-10.'
            : 'Este convenio trabaja con CIE-10; seleccioná el código correspondiente.',
        });
      }

      if (convention.diagnostico_por_producto) {
        checks.push({
          key: 'diagnosis-per-product',
          ok: hasDiagnosis,
          label: 'Diagnóstico por medicamento',
          detail: hasDiagnosis
            ? 'TurnIA aplicará el diagnóstico/CIE-10 de la receta a cada medicamento.'
            : 'Este convenio exige diagnóstico por producto; cargá diagnóstico o CIE-10.',
        });
      }

      if (convention.posologia_requierida) {
        const hasDirections = Boolean(prescription.observations?.trim());
        checks.push({
          key: 'posology-required',
          ok: hasDirections,
          label: 'Posología / Notas',
          detail: hasDirections
            ? 'La receta tiene posología/notas.'
            : 'Este convenio requiere posología.',
        });
      }

      if (convention.permite_sustitucion === false) {
        const substitutionsDisabled = Boolean(items?.every((item) => item.substitutable !== true));
        checks.push({
          key: 'substitution-rule',
          ok: substitutionsDisabled,
          label: 'Sustitución de medicamentos',
          detail: substitutionsDisabled
            ? 'Los medicamentos respetan la regla de no sustitución.'
            : 'Este convenio no permite sustitución.',
        });
      }

      let selectedPlan: MisRxPlan | undefined;
      const mustChoosePlan = Boolean(convention.digital_elige_plan);

      if (mustChoosePlan && !prescription.plan_id) {
        checks.push({
          key: 'plan-required',
          ok: false,
          label: 'Plan del afiliado',
          detail: 'Este convenio exige seleccionar un plan.',
        });
      }

      if (prescription.plan_id) {
        if (!prescription.affiliate_id) {
          checks.push({
            key: 'plan-valid',
            ok: false,
            label: 'Plan del afiliado',
            detail: 'No se puede validar el plan sin un afiliado MisRX.',
          });
        } else {
          const plansResult = await adapter.getPlans({
            convenioId: prescription.convention_id,
            affiliateId: prescription.affiliate_id,
          });

          if (plansResult.ok) {
            selectedPlan = plansResult.data.data.find(
              (plan) => Number(plan.plan_id) === Number(prescription.plan_id)
            );
          }

          checks.push({
            key: 'plan-valid',
            ok: Boolean(selectedPlan),
            label: 'Plan del afiliado',
            detail: selectedPlan
              ? 'El plan seleccionado sigue disponible en MisRX.'
              : plansResult.ok
                ? 'El plan guardado ya no está disponible para este afiliado y convenio.'
                : 'No se pudo validar el plan seleccionado con MisRX.',
          });
        }
      }

      if ((items?.length ?? 0) > 0) {
        const patientDni = digits(patient?.dni);
        const productChecks = await Promise.all(
          (items ?? []).map(async (item) => {
            const result = await adapter.searchProducts({
              query: '',
              convenioId: prescription.convention_id!,
              credential: patient?.insurance_member_number?.trim() || undefined,
              dni: patientDni ? Number(patientDni) : undefined,
              planId: prescription.plan_id ?? undefined,
              noIncluyeBajas: 1,
              productoId: Number(item.provider_product_id),
            });

            return Boolean(
              result.ok &&
              result.data.data.some(
                (product) =>
                  Number(product.producto_id) === Number(item.provider_product_id) &&
                  !product.baja
              )
            );
          }),
        );

        checks.push({
          key: 'products-live',
          ok: productChecks.every(Boolean),
          label: 'Medicamentos vigentes en MisRX',
          detail: productChecks.every(Boolean)
            ? 'Todos los medicamentos siguen disponibles para el convenio/plan seleccionado.'
            : 'Hay medicamentos que ya no están disponibles para el convenio/plan actual. Volvé a seleccionarlos.',
        });
      }

      if (selectedPlan) {
        const itemRule = positiveRule(selectedPlan.regla_items_por_receta);
        const unitRule = positiveRule(selectedPlan.regla_unidades_por_receta);
        const totalUnits = (items ?? []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);

        if (itemRule) {
          checks.push({
            key: 'plan-item-limit',
            ok: (items?.length ?? 0) <= itemRule,
            label: 'Límite de medicamentos del plan',
            detail: (items?.length ?? 0) <= itemRule
              ? `El plan admite hasta ${itemRule} medicamento(s) por receta.`
              : `El plan admite como máximo ${itemRule} medicamento(s) por receta.`,
          });
        }

        if (unitRule) {
          checks.push({
            key: 'plan-unit-limit',
            ok: totalUnits <= unitRule,
            label: 'Límite de unidades del plan',
            detail: totalUnits <= unitRule
              ? `La receta cumple el máximo de ${unitRule} unidad(es) del plan.`
              : `El plan admite como máximo ${unitRule} unidad(es) por receta.`,
          });
        }
      }
    }
  }

  const ready = checks.every((check) => check.ok);
  const controlledPreviewIssuing =
    process.env.VERCEL_ENV === 'preview' &&
    prescription.id === '24e0131d-2ca6-4270-b23b-05dfd9dfcf4a';

  const liveIssuingEnabled = homologationActive
    ? Boolean(homologation.issuingEnabled || controlledPreviewIssuing)
    : isMisRxProductionIssuingEnabled();

  return NextResponse.json({
    ready,
    liveIssuingEnabled,
    homologation: {
      enabled: homologation.enabled,
      activeForConvention: homologationActive,
    },
    checks,
  }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
