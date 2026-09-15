import { requireTenant } from '@/lib/auth/require-user';
import { updateSettings, disconnectGoogleCalendar } from './actions';
import { isGoogleOAuthConfigured } from '@/lib/google/oauth';
import { isWhatsAppConfigured } from '@/lib/whatsapp/provider';
import { isEmailConfigured } from '@/lib/email/provider';
import { SettingsTabs } from '@/components/settings/SettingsTabs';

type PageProps = {
  searchParams?: Promise<{ ok?: string; error?: string }>;
};

export default async function SettingsPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const { supabase, user, tenantId } = await requireTenant();

  const [{ data: profile }, { data: settings }, { data: googleIntegration }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    supabase.from('settings').select('preferences').eq('tenant_id', tenantId).maybeSingle(),
    supabase
      .from('integration_status')
      .select('status, account_label, connected_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('provider', 'google_calendar')
      .maybeSingle(),
  ]);

  const preferences = settings?.preferences && typeof settings.preferences === 'object'
    ? settings.preferences as Record<string, unknown>
    : {};

  const defaultModality = typeof preferences.default_modality === 'string'
    ? preferences.default_modality
    : 'presencial';
  const workdayStart = typeof preferences.workday_start === 'string'
    ? preferences.workday_start
    : '08:00';
  const workdayEnd = typeof preferences.workday_end === 'string'
    ? preferences.workday_end
    : '18:00';

  const googleConnected = googleIntegration?.status === 'connected';
  const googleConfigured = isGoogleOAuthConfigured();
  const whatsappConfigured = isWhatsAppConfigured();
  const emailConfigured = isEmailConfigured();

  return (
    <section className="stack">
      <div className="page-header">
        <div>
          <h1>Configuración</h1>
          <p className="muted">Preferencias operativas del consultorio.</p>
        </div>
      </div>

      {params?.ok ? <p className="alert success">{params.ok}</p> : null}
      {params?.error ? <p className="alert error">{params.error}</p> : null}

      <SettingsTabs
        preferencias={
          <div className="card">
            <form action={updateSettings} className="form-grid">
              <label>
                Nombre visible
                <input
                  name="display_name"
                  defaultValue={profile?.display_name || ''}
                  minLength={2}
                  maxLength={120}
                  required
                />
              </label>

              <label>
                Modalidad predeterminada
                <select name="default_modality" defaultValue={defaultModality}>
                  <option value="presencial">Presencial</option>
                  <option value="domicilio">Domicilio</option>
                  <option value="online">Online</option>
                </select>
              </label>

              <label>
                Inicio de jornada
                <input name="workday_start" type="time" defaultValue={workdayStart} required />
              </label>

              <label>
                Fin de jornada
                <input name="workday_end" type="time" defaultValue={workdayEnd} required />
              </label>

              <div>
                <button className="btn" type="submit">Guardar configuración</button>
              </div>
            </form>
          </div>
        }
        integraciones={
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Integraciones</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Cada profesional conecta sus propias integraciones. Nada de esto se comparte entre consultorios.
            </p>

            <div className="integration-list" style={{ marginTop: 8 }}>
              <div className="integration-row">
                <div className="integration-row-name">
                  Google Calendar / Meet
                  <span className={`badge ${googleConnected ? 'badge-confirmado' : googleConfigured ? 'badge-pendiente' : 'badge-neutral'}`}>
                    {googleConnected ? 'Conectado' : googleConfigured ? 'No conectado' : 'No disponible'}
                  </span>
                </div>
                <div className="integration-row-desc">
                  Genera un enlace de Google Meet automáticamente al crear turnos online.
                  {googleConnected && googleIntegration?.account_label ? ` Cuenta: ${googleIntegration.account_label}.` : ''}
                  {!googleConnected && !googleConfigured ? ' Todavía no está disponible en este consultorio.' : ''}
                </div>
                <div className="integration-row-action">
                  {googleConnected ? (
                    <form action={disconnectGoogleCalendar}>
                      <button className="btn danger" type="submit" style={{ padding: '7px 12px', fontSize: 13 }}>
                        Desconectar
                      </button>
                    </form>
                  ) : googleConfigured ? (
                    <a className="btn secondary" style={{ padding: '7px 12px', fontSize: 13 }} href="/api/google/oauth/connect">
                      Conectar
                    </a>
                  ) : (
                    <span className="btn secondary" aria-disabled="true" style={{ padding: '7px 12px', fontSize: 13, opacity: 0.5, cursor: 'not-allowed' }}>
                      Conectar
                    </span>
                  )}
                </div>
              </div>

              <div className="integration-row">
                <div className="integration-row-name">
                  WhatsApp
                  <span className={`badge ${whatsappConfigured ? 'badge-confirmado' : 'badge-neutral'}`}>
                    {whatsappConfigured ? 'Activo' : 'No disponible'}
                  </span>
                </div>
                <div className="integration-row-desc">
                  {whatsappConfigured
                    ? 'Los mensajes salen según el consentimiento de cada paciente.'
                    : 'El envío de WhatsApp todavía no está disponible en este consultorio.'}
                </div>
              </div>

              <div className="integration-row">
                <div className="integration-row-name">
                  Email
                  <span className={`badge ${emailConfigured ? 'badge-confirmado' : 'badge-neutral'}`}>
                    {emailConfigured ? 'Activo' : 'No disponible'}
                  </span>
                </div>
                <div className="integration-row-desc">
                  {emailConfigured
                    ? 'Enviado por TurnIA — no necesitás conectar tu propia cuenta de correo.'
                    : 'El envío de emails todavía no está disponible en este consultorio.'}
                </div>
              </div>
            </div>
          </div>
        }
      />
    </section>
  );
}
