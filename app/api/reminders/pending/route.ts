import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';

export const dynamic = 'force-dynamic';

const TZ = 'America/Argentina/Buenos_Aires';

function todayParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: value.year,
    month: value.month,
    day: value.day,
  };
}

function birthdayReminderId(patientId: string, year: string) {
  // ID estable por paciente/año: ReminderAlerts usa este valor para no
  // repetir sonido/notificación después de que el profesional lo descarta.
  return `birthday:${patientId}:${year}`;
}

export async function GET() {
  const { supabase, user, tenantId } = await requireTenant();

  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const today = todayParts();

  const [remindersResult, patientsResult] = await Promise.all([
    supabase
      .from('professional_reminders')
      .select('id,title,description,remind_at,status')
      .eq('tenant_id', tenantId)
      .eq('professional_id', user.id)
      .eq('status', 'pending')
      .lte('remind_at', horizon.toISOString())
      .order('remind_at', { ascending: true })
      .limit(50),
    supabase
      .from('patients')
      .select('id,name,birth_date')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .not('birth_date', 'is', null),
  ]);

  if (remindersResult.error || patientsResult.error) {
    return NextResponse.json({ reminders: [] }, { status: 500 });
  }

  const birthdayReminders = (patientsResult.data ?? [])
    .filter((patient) => {
      const birthDate = typeof patient.birth_date === 'string' ? patient.birth_date : '';
      return birthDate.length >= 10 &&
        birthDate.slice(5, 7) === today.month &&
        birthDate.slice(8, 10) === today.day;
    })
    .map((patient) => ({
      id: birthdayReminderId(patient.id, today.year),
      title: `🎂 Cumpleaños de ${patient.name}`,
      description: `Hoy cumple años ${patient.name}.`,
      // Medianoche local: al abrir TurnIA en cualquier momento del día el
      // recordatorio ya está vencido/due y entra por la misma alerta global.
      remind_at: new Date(`${today.year}-${today.month}-${today.day}T00:00:00-03:00`).toISOString(),
      status: 'pending',
    }));

  const reminders = [
    ...birthdayReminders,
    ...(remindersResult.data ?? []),
  ].sort((a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime());

  return NextResponse.json(
    { reminders },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
