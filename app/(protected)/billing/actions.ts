'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { authorizeWsfeInvoiceC } from '@/lib/arca/wsfe';
import { vatConditionLabel } from '@/lib/billing/constants';

const saleConditionSchema = z.enum([
  'contado',
  'cuenta_corriente',
  'transferencia',
  'tarjeta_debito',
  'tarjeta_credito',
  'cheque',
  'otra',
  'otros_medios_electronicos',
]);

const draftSchema = z.object({
  patient_id: z.string().uuid(),
  session_count: z.coerce.number().int().min(1).max(100),
  recipient_mode: z.enum(['patient_reimbursement', 'direct_payer']),
  billing_entity_id: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().uuid().nullable(),
  ),
  point_of_sale: z.coerce.number().int().positive(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  service_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  service_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total: z.coerce.number().positive().max(999999999),
  detail: z.string().trim().min(2).max(2000),
  recipient_legal_name: z.string().trim().min(2).max(240),
  recipient_cuit: z.preprocess(
    (value) => {
      if (typeof value !== 'string' || value.trim() === '') return null;
      return value.replace(/\D/g, '');
    },
    z.string().regex(/^\d{11}$/, 'El CUIT del receptor debe tener 11 dígitos').nullable(),
  ),
  recipient_vat_condition_id: z.coerce.number().int().positive(),
  recipient_address: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(240).nullable(),
  ),
  recipient_email: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().email('Email de facturación inválido').max(200).nullable(),
  ),
  sale_condition: saleConditionSchema,
  activity_code: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(40).nullable(),
  ),
  activity_description: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(240).nullable(),
  ),
});

function invoiceRedirectError(message: string, patientId?: string): never {
  const suffix = patientId ? `?patient=${encodeURIComponent(patientId)}&error=${encodeURIComponent(message)}` : `?error=${encodeURIComponent(message)}`;
  redirect(`/billing/new${suffix}`);
}

export async function createBillingInvoiceDraft(formData: FormData) {
  const appointmentIds = formData
    .getAll('appointment_ids')
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const parsed = draftSchema.safeParse({
    patient_id: formData.get('patient_id'),
    session_count: formData.get('session_count'),
    recipient_mode: formData.get('recipient_mode'),
    billing_entity_id: formData.get('billing_entity_id'),
    point_of_sale: formData.get('point_of_sale'),
    issue_date: formData.get('issue_date'),
    service_from: formData.get('service_from'),
    service_to: formData.get('service_to'),
    due_date: formData.get('due_date'),
    total: formData.get('total'),
    detail: formData.get('detail'),
    recipient_legal_name: formData.get('recipient_legal_name'),
    recipient_cuit: formData.get('recipient_cuit'),
    recipient_vat_condition_id: formData.get('recipient_vat_condition_id'),
    recipient_address: formData.get('recipient_address'),
    recipient_email: formData.get('recipient_email'),
    sale_condition: formData.get('sale_condition'),
    activity_code: formData.get('activity_code'),
    activity_description: formData.get('activity_description'),
  });

  const patientId = typeof formData.get('patient_id') === 'string' ? String(formData.get('patient_id')) : undefined;

  if (!parsed.success) {
    invoiceRedirectError(parsed.error.issues[0]?.message ?? 'Datos de factura inválidos', patientId);
  }

  const draft = parsed.data;

  if (draft.service_to < draft.service_from) {
    invoiceRedirectError('La fecha hasta no puede ser anterior a la fecha desde.', draft.patient_id);
  }

  if (draft.due_date < draft.issue_date) {
    invoiceRedirectError('El vencimiento no puede ser anterior a la fecha de emisión.', draft.patient_id);
  }

  const { supabase, user, tenantId } = await requireTenant();

  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('id,name,dni,insurance_name,insurance_member_number,insurance_plan,billing_entity_id')
    .eq('id', draft.patient_id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (patientError || !patient) {
    invoiceRedirectError('El paciente seleccionado no está disponible.', draft.patient_id);
  }

  if (draft.recipient_mode === 'direct_payer' && draft.billing_entity_id) {
    const { data: entity } = await supabase
      .from('billing_entities')
      .select('id')
      .eq('id', draft.billing_entity_id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!entity) invoiceRedirectError('La obra social o empresa seleccionada no está disponible.', draft.patient_id);
  }

  if (draft.recipient_mode === 'direct_payer' && !draft.recipient_cuit) {
    invoiceRedirectError('Para facturación directa a una obra social o empresa, ingresá su CUIT.', draft.patient_id);
  }

  const uniqueAppointmentIds = Array.from(new Set(appointmentIds));
  const validAppointmentIds: string[] = [];

  if (uniqueAppointmentIds.length > 0) {
    const parsedIds = z.array(z.string().uuid()).max(100).safeParse(uniqueAppointmentIds);
    if (!parsedIds.success) {
      invoiceRedirectError('Hay una sesión seleccionada que no es válida.', draft.patient_id);
    }
    const validIds: string[] = parsedIds.data;

    const { data: appointments, error: appointmentsError } = await supabase
      .from('appointments')
      .select('id,patient_id,starts_at,status')
      .eq('tenant_id', tenantId)
      .eq('patient_id', draft.patient_id)
      .in('id', validIds);

    if (appointmentsError || (appointments?.length ?? 0) !== validIds.length) {
      invoiceRedirectError('No se pudieron validar todas las sesiones seleccionadas.', draft.patient_id);
    }

    const now = Date.now();
    for (const appointment of appointments ?? []) {
      const cancelled = appointment.status === 'cancelled' || appointment.status === 'cancelado';
      if (cancelled || new Date(appointment.starts_at).getTime() > now) {
        invoiceRedirectError('Sólo se pueden incluir sesiones ya realizadas y no canceladas.', draft.patient_id);
      }
      validAppointmentIds.push(appointment.id);
    }

    // Evita facturar la misma sesión dos veces mientras exista un borrador o
    // comprobante ya autorizado. Los rechazados no bloquean un nuevo intento.
    const { data: alreadyLinked } = await supabase
      .from('billing_invoice_appointments')
      .select('appointment_id, invoice_id, billing_invoices!inner(status)')
      .eq('tenant_id', tenantId)
      .in('appointment_id', validAppointmentIds);

    const conflict = (alreadyLinked ?? []).find((row: any) => {
      const status = Array.isArray(row.billing_invoices)
        ? row.billing_invoices[0]?.status
        : row.billing_invoices?.status;
      return status === 'draft' || status === 'authorized';
    });

    if (conflict) {
      invoiceRedirectError('Una de las sesiones seleccionadas ya está incluida en otra factura o borrador.', draft.patient_id);
    }
  }

  const recipientLegalName =
    draft.recipient_mode === 'patient_reimbursement'
      ? patient.name
      : draft.recipient_legal_name;
  const recipientCuit = draft.recipient_cuit;
  const patientDni = String(patient.dni ?? '').replace(/\D/g, '');
  const recipientDocType = recipientCuit
    ? 80
    : draft.recipient_mode === 'patient_reimbursement' && patientDni
      ? 96
      : 99;
  const recipientDocNumber = recipientCuit ?? (recipientDocType === 96 ? patientDni : '0');
  const vatLabel = vatConditionLabel(draft.recipient_vat_condition_id);

  const { data: invoice, error: invoiceError } = await supabase
    .from('billing_invoices')
    .insert({
      tenant_id: tenantId,
      professional_id: user.id,
      patient_id: draft.patient_id,
      billing_entity_id: draft.recipient_mode === 'direct_payer' ? draft.billing_entity_id : null,
      recipient_mode: draft.recipient_mode,
      environment: 'homologacion',
      status: 'draft',
      voucher_type: 11,
      point_of_sale: draft.point_of_sale,
      concept_id: 2,
      issue_date: draft.issue_date,
      service_from: draft.service_from,
      service_to: draft.service_to,
      due_date: draft.due_date,
      currency: 'PES',
      currency_rate: 1,
      total: draft.total,
      detail: draft.detail,
      sale_condition: draft.sale_condition,
      recipient_doc_type: recipientDocType,
      recipient_doc_number: recipientDocNumber,
      recipient_legal_name: recipientLegalName,
      recipient_cuit: recipientCuit,
      recipient_vat_condition_id: draft.recipient_vat_condition_id,
      recipient_vat_condition_label: vatLabel,
      recipient_address: draft.recipient_address,
      recipient_email: draft.recipient_email,
      activity_code: draft.activity_code,
      activity_description: draft.activity_description,
    })
    .select('id')
    .single();

  if (invoiceError || !invoice) {
    invoiceRedirectError('No se pudo guardar el borrador de factura.', draft.patient_id);
  }
  const invoiceId: string = invoice.id;

  const quantity = draft.session_count;
  const unitPrice = Math.round((draft.total / quantity) * 100) / 100;

  const { error: lineError } = await supabase
    .from('billing_invoice_lines')
    .insert({
      tenant_id: tenantId,
      invoice_id: invoiceId,
      description: draft.detail,
      quantity,
      unit_price: unitPrice,
      line_total: draft.total,
    });

  if (lineError) {
    await supabase.from('billing_invoices').delete().eq('id', invoiceId).eq('tenant_id', tenantId);
    invoiceRedirectError('No se pudo guardar el detalle de la factura.', draft.patient_id);
  }

  if (validAppointmentIds.length > 0) {
    const { error: linkError } = await supabase
      .from('billing_invoice_appointments')
      .insert(validAppointmentIds.map((appointmentId) => ({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        appointment_id: appointmentId,
      })));

    if (linkError) {
      await supabase.from('billing_invoices').delete().eq('id', invoiceId).eq('tenant_id', tenantId);
      invoiceRedirectError('No se pudieron asociar las sesiones a la factura.', draft.patient_id);
    }
  }

  revalidatePath('/billing');
  revalidatePath(`/patients/${draft.patient_id}`);
  redirect(`/billing/${invoiceId}?success=draft`);
}

const authorizeSchema = z.object({
  invoice_id: z.string().uuid(),
  confirm: z.literal('true'),
});

export async function authorizeBillingInvoice(formData: FormData) {
  const parsed = authorizeSchema.safeParse({
    invoice_id: formData.get('invoice_id'),
    confirm: formData.get('confirm'),
  });

  if (!parsed.success) {
    redirect('/billing?error=Confirmación%20inválida');
  }
  const input = parsed.data;

  const { supabase, user, tenantId } = await requireTenant();

  const { data: existingInvoice, error: existingError } = await supabase
    .from('billing_invoices')
    .select('*')
    .eq('id', input.invoice_id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .maybeSingle();

  if (existingError || !existingInvoice) {
    redirect('/billing?error=Factura%20no%20disponible');
  }

  if (existingInvoice.status === 'authorized') {
    redirect(`/billing/${existingInvoice.id}?error=La%20factura%20ya%20está%20autorizada`);
  }

  if (existingInvoice.status === 'authorizing') {
    redirect(`/billing/${existingInvoice.id}?error=La%20factura%20ya%20se%20está%20procesando%20en%20ARCA`);
  }

  if (existingInvoice.status !== 'draft') {
    redirect(`/billing/${existingInvoice.id}?error=Sólo%20se%20pueden%20emitir%20borradores`);
  }

  if (existingInvoice.environment !== 'homologacion') {
    redirect(`/billing/${existingInvoice.id}?error=La%20emisión%20de%20producción%20todavía%20está%20deshabilitada`);
  }

  if (
    !existingInvoice.point_of_sale ||
    !existingInvoice.service_from ||
    !existingInvoice.service_to ||
    !existingInvoice.due_date ||
    !existingInvoice.recipient_doc_type ||
    !existingInvoice.recipient_doc_number ||
    !existingInvoice.recipient_vat_condition_id
  ) {
    redirect(`/billing/${existingInvoice.id}?error=Faltan%20datos%20fiscales%20obligatorios`);
  }

  // Claim atómico del borrador: sólo una solicitud puede cambiar draft ->
  // authorizing. Evita doble CAE por doble click o dos pestañas concurrentes.
  const { data: claimedInvoice, error: claimError } = await supabase
    .from('billing_invoices')
    .update({
      status: 'authorizing',
      arca_error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingInvoice.id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle();

  if (claimError || !claimedInvoice) {
    redirect(`/billing/${existingInvoice.id}?error=La%20factura%20ya%20está%20siendo%20procesada%20o%20cambió%20de%20estado`);
  }

  const currentInvoice = claimedInvoice;

  const result = await authorizeWsfeInvoiceC({
    tenantId,
    userId: user.id,
    pointOfSale: Number(currentInvoice.point_of_sale),
    issueDate: currentInvoice.issue_date,
    serviceFrom: currentInvoice.service_from,
    serviceTo: currentInvoice.service_to,
    dueDate: currentInvoice.due_date,
    total: Number(currentInvoice.total),
    recipientDocType: Number(currentInvoice.recipient_doc_type),
    recipientDocNumber: String(currentInvoice.recipient_doc_number),
    recipientVatConditionId: Number(currentInvoice.recipient_vat_condition_id),
    activityCode: currentInvoice.activity_code ?? null,
    environment: 'homologacion',
  });

  if (!result.ok) {
    await supabase
      .from('billing_invoices')
      .update({
        status: 'draft',
        arca_error_message: result.errorMessage.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', currentInvoice.id)
      .eq('tenant_id', tenantId)
      .eq('professional_id', user.id)
      .eq('status', 'authorizing');

    revalidatePath(`/billing/${currentInvoice.id}`);
    redirect(`/billing/${currentInvoice.id}?error=${encodeURIComponent(result.errorMessage)}`);
  }

  const approved = result.data.result === 'A' && Boolean(result.data.cae);
  const observations = result.data.observations.join(' | ');
  const now = new Date().toISOString();

  if (approved) {
    const expiresRaw = result.data.caeExpiresAt;
    const expiresDate =
      expiresRaw && /^\d{8}$/.test(expiresRaw)
        ? `${expiresRaw.slice(0, 4)}-${expiresRaw.slice(4, 6)}-${expiresRaw.slice(6, 8)}`
        : null;

    const { error: updateError } = await supabase
      .from('billing_invoices')
      .update({
        status: 'authorized',
        arca_result: result.data.result,
        arca_cae: result.data.cae,
        arca_cae_expires_at: expiresDate,
        arca_voucher_number: result.data.voucherNumber,
        arca_processed_at: now,
        arca_error_message: observations || null,
        authorized_at: now,
        updated_at: now,
      })
      .eq('id', currentInvoice.id)
      .eq('tenant_id', tenantId)
      .eq('professional_id', user.id)
      .eq('status', 'authorizing');

    if (updateError) {
      console.error('[billing] ARCA authorized but local update failed', {
        invoiceId: currentInvoice.id,
        code: updateError.code,
        message: updateError.message,
      });
      redirect(`/billing/${currentInvoice.id}?error=${encodeURIComponent('ARCA autorizó el comprobante, pero TurnIA no pudo guardar el resultado. No vuelvas a emitir y contactá soporte.')}`);
    }

    revalidatePath('/billing');
    revalidatePath(`/billing/${currentInvoice.id}`);
    if (currentInvoice.patient_id) revalidatePath(`/patients/${currentInvoice.patient_id}`);
    redirect(`/billing/${currentInvoice.id}?success=authorized`);
  }

  await supabase
    .from('billing_invoices')
    .update({
      status: 'rejected',
      arca_result: result.data.result || 'R',
      arca_error_message: observations || 'ARCA rechazó el comprobante.',
      arca_processed_at: now,
      updated_at: now,
    })
    .eq('id', currentInvoice.id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .eq('status', 'authorizing');

  revalidatePath('/billing');
  revalidatePath(`/billing/${currentInvoice.id}`);
  redirect(`/billing/${currentInvoice.id}?error=${encodeURIComponent(observations || 'ARCA rechazó el comprobante.')}`);
}
