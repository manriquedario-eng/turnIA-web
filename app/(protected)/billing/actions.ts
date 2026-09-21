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

function invoiceRedirectError(message: string, patientId?: string) {
  const suffix = patientId ? `?patient=${encodeURIComponent(patientId)}&error=${encodeURIComponent(message)}` : `?error=${encodeURIComponent(message)}`;
  redirect(`/billing/new${suffix}`);
}

export async function createBillingInvoiceDraft(formData: FormData) {
  const appointmentIds = formData
    .getAll('appointment_ids')
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const parsed = draftSchema.safeParse({
    patient_id: formData.get('patient_id'),
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

  if (parsed.data.service_to < parsed.data.service_from) {
    invoiceRedirectError('La fecha hasta no puede ser anterior a la fecha desde.', parsed.data.patient_id);
  }

  if (parsed.data.due_date < parsed.data.issue_date) {
    invoiceRedirectError('El vencimiento no puede ser anterior a la fecha de emisión.', parsed.data.patient_id);
  }

  const { supabase, user, tenantId } = await requireTenant();

  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('id,name,dni,billing_entity_id')
    .eq('id', parsed.data.patient_id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (patientError || !patient) {
    invoiceRedirectError('El paciente seleccionado no está disponible.', parsed.data.patient_id);
  }

  if (parsed.data.billing_entity_id) {
    const { data: entity } = await supabase
      .from('billing_entities')
      .select('id')
      .eq('id', parsed.data.billing_entity_id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!entity) invoiceRedirectError('El pagador seleccionado no está disponible.', parsed.data.patient_id);
  }

  const uniqueAppointmentIds = Array.from(new Set(appointmentIds));
  const validAppointmentIds: string[] = [];

  if (uniqueAppointmentIds.length > 0) {
    const parsedIds = z.array(z.string().uuid()).max(100).safeParse(uniqueAppointmentIds);
    if (!parsedIds.success) {
      invoiceRedirectError('Hay una sesión seleccionada que no es válida.', parsed.data.patient_id);
    }

    const { data: appointments, error: appointmentsError } = await supabase
      .from('appointments')
      .select('id,patient_id,starts_at,status')
      .eq('tenant_id', tenantId)
      .eq('patient_id', parsed.data.patient_id)
      .in('id', parsedIds.data);

    if (appointmentsError || (appointments?.length ?? 0) !== parsedIds.data.length) {
      invoiceRedirectError('No se pudieron validar todas las sesiones seleccionadas.', parsed.data.patient_id);
    }

    const now = Date.now();
    for (const appointment of appointments ?? []) {
      const cancelled = appointment.status === 'cancelled' || appointment.status === 'cancelado';
      if (cancelled || new Date(appointment.starts_at).getTime() > now) {
        invoiceRedirectError('Sólo se pueden incluir sesiones ya realizadas y no canceladas.', parsed.data.patient_id);
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
      invoiceRedirectError('Una de las sesiones seleccionadas ya está incluida en otra factura o borrador.', parsed.data.patient_id);
    }
  }

  const recipientCuit = parsed.data.recipient_cuit;
  const recipientDocType = recipientCuit ? 80 : 99;
  const recipientDocNumber = recipientCuit ?? '0';
  const vatLabel = vatConditionLabel(parsed.data.recipient_vat_condition_id);

  const { data: invoice, error: invoiceError } = await supabase
    .from('billing_invoices')
    .insert({
      tenant_id: tenantId,
      professional_id: user.id,
      patient_id: parsed.data.patient_id,
      billing_entity_id: parsed.data.billing_entity_id,
      environment: 'homologacion',
      status: 'draft',
      voucher_type: 11,
      point_of_sale: parsed.data.point_of_sale,
      concept_id: 2,
      issue_date: parsed.data.issue_date,
      service_from: parsed.data.service_from,
      service_to: parsed.data.service_to,
      due_date: parsed.data.due_date,
      currency: 'PES',
      currency_rate: 1,
      total: parsed.data.total,
      detail: parsed.data.detail,
      sale_condition: parsed.data.sale_condition,
      recipient_doc_type: recipientDocType,
      recipient_doc_number: recipientDocNumber,
      recipient_legal_name: parsed.data.recipient_legal_name,
      recipient_cuit: recipientCuit,
      recipient_vat_condition_id: parsed.data.recipient_vat_condition_id,
      recipient_vat_condition_label: vatLabel,
      recipient_address: parsed.data.recipient_address,
      recipient_email: parsed.data.recipient_email,
      activity_code: parsed.data.activity_code,
      activity_description: parsed.data.activity_description,
    })
    .select('id')
    .single();

  if (invoiceError || !invoice) {
    invoiceRedirectError('No se pudo guardar el borrador de factura.', parsed.data.patient_id);
  }

  const quantity = Math.max(validAppointmentIds.length, 1);
  const unitPrice = Math.round((parsed.data.total / quantity) * 100) / 100;

  const { error: lineError } = await supabase
    .from('billing_invoice_lines')
    .insert({
      tenant_id: tenantId,
      invoice_id: invoice.id,
      description: parsed.data.detail,
      quantity,
      unit_price: unitPrice,
      line_total: parsed.data.total,
    });

  if (lineError) {
    await supabase.from('billing_invoices').delete().eq('id', invoice.id).eq('tenant_id', tenantId);
    invoiceRedirectError('No se pudo guardar el detalle de la factura.', parsed.data.patient_id);
  }

  if (validAppointmentIds.length > 0) {
    const { error: linkError } = await supabase
      .from('billing_invoice_appointments')
      .insert(validAppointmentIds.map((appointmentId) => ({
        tenant_id: tenantId,
        invoice_id: invoice.id,
        appointment_id: appointmentId,
      })));

    if (linkError) {
      await supabase.from('billing_invoices').delete().eq('id', invoice.id).eq('tenant_id', tenantId);
      invoiceRedirectError('No se pudieron asociar las sesiones a la factura.', parsed.data.patient_id);
    }
  }

  revalidatePath('/billing');
  revalidatePath(`/patients/${parsed.data.patient_id}`);
  redirect(`/billing/${invoice.id}?success=draft`);
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

  const { supabase, user, tenantId } = await requireTenant();

  const { data: invoice, error } = await supabase
    .from('billing_invoices')
    .select('*')
    .eq('id', parsed.data.invoice_id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .maybeSingle();

  if (error || !invoice) {
    redirect('/billing?error=Factura%20no%20disponible');
  }

  if (invoice.status === 'authorized') {
    redirect(`/billing/${invoice.id}?error=La%20factura%20ya%20está%20autorizada`);
  }

  if (invoice.status !== 'draft') {
    redirect(`/billing/${invoice.id}?error=Sólo%20se%20pueden%20emitir%20borradores`);
  }

  if (invoice.environment !== 'homologacion') {
    redirect(`/billing/${invoice.id}?error=La%20emisión%20de%20producción%20todavía%20está%20deshabilitada`);
  }

  if (
    !invoice.point_of_sale ||
    !invoice.service_from ||
    !invoice.service_to ||
    !invoice.due_date ||
    !invoice.recipient_doc_type ||
    !invoice.recipient_doc_number ||
    !invoice.recipient_vat_condition_id
  ) {
    redirect(`/billing/${invoice.id}?error=Faltan%20datos%20fiscales%20obligatorios`);
  }

  const result = await authorizeWsfeInvoiceC({
    tenantId,
    userId: user.id,
    pointOfSale: Number(invoice.point_of_sale),
    issueDate: invoice.issue_date,
    serviceFrom: invoice.service_from,
    serviceTo: invoice.service_to,
    dueDate: invoice.due_date,
    total: Number(invoice.total),
    recipientDocType: Number(invoice.recipient_doc_type),
    recipientDocNumber: String(invoice.recipient_doc_number),
    recipientVatConditionId: Number(invoice.recipient_vat_condition_id),
    environment: 'homologacion',
  });

  if (!result.ok) {
    await supabase
      .from('billing_invoices')
      .update({
        arca_error_message: result.errorMessage.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoice.id)
      .eq('tenant_id', tenantId);

    revalidatePath(`/billing/${invoice.id}`);
    redirect(`/billing/${invoice.id}?error=${encodeURIComponent(result.errorMessage)}`);
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
      .eq('id', invoice.id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft');

    if (updateError) {
      console.error('[billing] ARCA authorized but local update failed', {
        invoiceId: invoice.id,
        code: updateError.code,
        message: updateError.message,
      });
      redirect(`/billing/${invoice.id}?error=${encodeURIComponent('ARCA autorizó el comprobante, pero TurnIA no pudo guardar el resultado. No vuelvas a emitir y contactá soporte.')}`);
    }

    revalidatePath('/billing');
    revalidatePath(`/billing/${invoice.id}`);
    if (invoice.patient_id) revalidatePath(`/patients/${invoice.patient_id}`);
    redirect(`/billing/${invoice.id}?success=authorized`);
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
    .eq('id', invoice.id)
    .eq('tenant_id', tenantId);

  revalidatePath('/billing');
  revalidatePath(`/billing/${invoice.id}`);
  redirect(`/billing/${invoice.id}?error=${encodeURIComponent(observations || 'ARCA rechazó el comprobante.')}`);
}
