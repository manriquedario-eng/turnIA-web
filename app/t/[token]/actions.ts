'use server';

import { redirect } from 'next/navigation';
import {
  cancelAppointmentByToken,
  confirmAppointmentByToken,
  requestRescheduleByToken,
} from '@/lib/appointments/public-token';

export async function confirmAppointmentPublic(formData: FormData) {
  const token = String(formData.get('token') || '');
  const result = await confirmAppointmentByToken(token);
  if (!result.ok) redirect(`/t/${token}?error=${encodeURIComponent(result.error)}`);
  redirect(`/t/${token}?done=confirmed`);
}

export async function cancelAppointmentPublic(formData: FormData) {
  const token = String(formData.get('token') || '');
  const result = await cancelAppointmentByToken(token);
  if (!result.ok) redirect(`/t/${token}?error=${encodeURIComponent(result.error)}`);
  redirect(`/t/${token}?done=cancelled`);
}

export async function requestReschedulePublic(formData: FormData) {
  const token = String(formData.get('token') || '');
  const note = String(formData.get('note') || '');
  const result = await requestRescheduleByToken(token, note);
  if (!result.ok) redirect(`/t/${token}?error=${encodeURIComponent(result.error)}`);
  redirect(`/t/${token}?done=reschedule_requested`);
}
