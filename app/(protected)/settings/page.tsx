import { requireTenant } from '@/lib/auth/require-user';
import { updateSettings, disconnectGoogleCalendar } from './actions';
import { isGoogleOAuthConfigured } from '@/lib/google/oauth';
import { isWhatsAppConfigured } from '@/lib/whatsapp/provider';
import { isEmailConfigured } from '@/lib/email/provider';

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
    <section>
      <div className="page-header">
        <div>
          <h1>Configuración</h1>
          <p className="muted">Preferencias operativas del consultorio.</p>
        </div>
      </div>

      {params?.ok ? <p className="alert success">{params.ok}</p> : null}
      {params?.error ? <p className="alert error">{params.error}</p> : null}

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

      <div className="card" id="integraciones">
        <h2 style={{ marginTop: 0 }}>Integraciones</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Cada profesional conecta sus propias integraciones. Nada de esto se comparte entre consultorios.
        </p>

        <div className="stack" style={{ gap: 16, marginTop: 12 }}>
          <div className="integration-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>Google Calendar / Meet</strong>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                {googleConnected
                  ? `Conectado${googleIntegration?.account_label ? ` como ${googleIntegration.account_label}` : ''}.`
                  : googleConfigured
                    ? 'No conectado. Conectá tu cuenta para generar Google Meet automáticamente en turnos online.'
                    : 'La conexión con Google todavía no está configurada del lado del servidor (falta GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI o SUPABASE_SERVICE_ROLE_KEY).'}
              </p>
            </div>
            {googleConnected ? (
              <form action={disconnectGoogleCalendar}>
                <button className="btn danger" type="submit" style={{ padding: '7px 12px', fontSize: 13 }}>
                  Desconectar
                </button>
              </form>
            ) : googleConfigured ? (
              <a className="btn secondary" style={{ padding: '7px 12px', fontSize: 13 }} href="/api/google/oauth/connect">
                Conectar Google
              </a>
            ) : (
              <span className="btn secondary" aria-disabled="true" style={{ padding: '7px 12px', fontSize: 13, opacity: 0.5, cursor: 'not-allowed' }}>
                Conectar Google
              </span>
            )}
          </div>

          <div className="integration-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>WhatsApp</strong>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                {whatsappConfigured
                  ? 'Configurado a nivel plataforma. Los mensajes salen según el consentimiento de cada paciente.'
                  : 'Todavía no configurado (faltan credenciales de Meta Cloud API en el servidor).'}
              </p>
            </div>
            <span className={`badge ${whatsappConfigured ? 'badge-confirmado' : ''}`}>
              {whatsappConfigured ? 'Activo' : 'No configurado'}
            </span>
          </div>

          <div className="integration-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>Email</strong>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                {emailConfigured
                  ? 'Enviado por TurnIA — no necesitás conectar tu propia cuenta de correo.'
                  : 'Enviado por TurnIA. Todavía no hay un proveedor de email transaccional configurado en el servidor.'}
              </p>
            </div>
            <span className={`badge ${emailConfigured ? 'badge-confirmado' : ''}`}>
              {emailConfigured ? 'Activo' : 'No configurado'}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
