import 'server-only';

import { isPlausibleToken } from '@/lib/appointments/public-token';
import {
  createSupabaseServiceClient,
  isServiceRoleConfigured,
} from '@/lib/supabase/service';
import { isMercadoPagoTokenEncryptionConfigured } from './token-crypto';

const CONFIRMED_STATUSES = new Set(['confirmed', 'confirmado']);

function isReasonablyValidEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export type MercadoPagoPaymentOffer =
  | {
      available: true;
      appointmentId: string;
      tenantId: string;
      professionalId: string;
      remainingAmount: number;
      currency: 'ARS';
    }
  | {
      available: false;
      reason:
        | 'invalid_token'
        | 'not_configured'
        | 'not_available'
        | 'not_confirmed'
        | 'appointment_started'
        | 'not_connected'
        | 'patient_email_required'
        | 'no_amount'
        | 'already_paid'
        | 'internal_error';
    };

export async function getMercadoPagoPaymentOfferByToken(
  token: string,
): Promise<MercadoPagoPaymentOffer> {
  if (!isPlausibleToken(token)) {
    return { available: false, reason: 'invalid_token' };
  }

  if (!isServiceRoleConfigured() || !isMercadoPagoTokenEncryptionConfigured()) {
    return { available: false, reason: 'not_configured' };
  }

  const supabase = createSupabaseServiceClient();

  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .select('id,tenant_id,professional_id,patient_id,service_id,status,starts_at,quoted_amount,public_token_revoked_at')
    .eq('public_token', token)
    .maybeSingle();

  if (appointmentError) {
    console.error('Mercado Pago public offer: appointment lookup failed', {
      code: appointmentError.code,
    });
    return { available: false, reason: 'internal_error' };
  }

  if (
    !appointment?.id ||
    !appointment.tenant_id ||
    !appointment.professional_id ||
    appointment.public_token_revoked_at
  ) {
    return { available: false, reason: 'not_available' };
  }

  if (!CONFIRMED_STATUSES.has(String(appointment.status ?? '').toLowerCase())) {
    return { available: false, reason: 'not_confirmed' };
  }

  const startsAt = new Date(appointment.starts_at).getTime();
  if (!Number.isFinite(startsAt) || startsAt <= Date.now()) {
    return { available: false, reason: 'appointment_started' };
  }

  const [connectionResult, patientResult, serviceResult, paymentsResult] =
    await Promise.all([
      supabase
        .from('mercadopago_connections')
        .select('revoked_at,token_expires_at')
        .eq('tenant_id', appointment.tenant_id)
        .eq('user_id', appointment.professional_id)
        .maybeSingle(),
      appointment.patient_id
        ? supabase
            .from('patients')
            .select('email')
            .eq('id', appointment.patient_id)
            .eq('tenant_id', appointment.tenant_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      appointment.service_id
        ? supabase
            .from('services')
            .select('price')
            .eq('id', appointment.service_id)
            .eq('tenant_id', appointment.tenant_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('payments')
        .select('amount')
        .eq('tenant_id', appointment.tenant_id)
        .eq('appointment_id', appointment.id),
    ]);

  if (
    connectionResult.error ||
    patientResult.error ||
    serviceResult.error ||
    paymentsResult.error
  ) {
    console.error('Mercado Pago public offer: dependency lookup failed');
    return { available: false, reason: 'internal_error' };
  }

  const connection = connectionResult.data;
  if (
    !connection ||
    connection.revoked_at ||
    (connection.token_expires_at &&
      new Date(connection.token_expires_at).getTime() <= Date.now())
  ) {
    return { available: false, reason: 'not_connected' };
  }

  if (!isReasonablyValidEmail(patientResult.data?.email ?? null)) {
    return { available: false, reason: 'patient_email_required' };
  }

  const quotedAmount =
    appointment.quoted_amount != null ? Number(appointment.quoted_amount) : 0;
  const servicePrice =
    serviceResult.data?.price != null ? Number(serviceResult.data.price) : 0;
  const totalAmount = quotedAmount > 0 ? quotedAmount : servicePrice;

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return { available: false, reason: 'no_amount' };
  }

  const paidAmount = (paymentsResult.data ?? []).reduce((sum, row) => {
    const value = Number(row.amount ?? 0);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  const remainingAmount = Math.round((totalAmount - paidAmount) * 100) / 100;
  if (remainingAmount <= 0) {
    return { available: false, reason: 'already_paid' };
  }

  return {
    available: true,
    appointmentId: appointment.id,
    tenantId: appointment.tenant_id,
    professionalId: appointment.professional_id,
    remainingAmount,
    currency: 'ARS',
  };
}
