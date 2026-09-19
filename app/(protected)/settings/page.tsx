import { requireTenant } from '@/lib/auth/require-user';
import { updateSettings, disconnectGoogleCalendar, disconnectMercadoPago } from './actions';
import { isGoogleOAuthConfigured } from '@/lib/google/oauth';
import { isMercadoPagoOAuthConfigured } from '@/lib/mercadopago/oauth';
import { isWhatsAppConfigured } from '@/lib/whatsapp/provider';
import { isEmailConfigured } from '@/lib/email/provider';
import { SettingsTabs } from '@/components/settings/SettingsTabs';

type PageProps = {
  searchParams?: Promise<{ ok?: string; error?: string }>;
};

export default async function SettingsPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const { supabase, user, tenantId } = await requireTenant();

  const [{ data: profile }, { data: settings }, { data: googleIntegration }, { data: mercadoPagoIntegration }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    // `profile` acá es la columna jsonb existente de `settings` (datos del
    // profesional/consultorio) — no confundir con la tabla `profiles`
    // (arriba). Ya existía en el schema, sólo no se usaba para nada.
    supabase.from('settings').select('preferences, profile').eq('tenant_id', tenantId).maybeSingle(),
    supabase
      .from('integration_status')
      .select('status, account_label, connected_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('provider', 'google_calendar')
      .maybeSingle(),
    // Sólo `integration_status` (lectura vía RLS normal, igual que Google) —
    // NUNCA se lee mercadopago_connections desde acá ni desde ningún código
    // que corra con el cliente RLS del usuario: esa tabla es server-only,
    // sólo lib/mercadopago/oauth.ts la toca, y siempre con el service role.
    supabase
      .from('integration_status')
      .select('status, account_label, connected_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('provider', 'mercadopago')
      .maybeSingle(),
  ]);

  const preferences = settings?.preferences && typeof settings.preferences === 'object'
    ? settings.preferences as Record<string, unknown>
    : {};
  const professionalProfile = settings?.profile && typeof settings.profile === 'object'
    ? settings.profile as Record<string, unknown>
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

  const text = (key: string) => (typeof professionalProfile[key] === 'string' ? professionalProfile[key] as string : '');

  const googleConnected = googleIntegration?.status === 'connected';
  const googleConfigured = isGoogleOAuthConfigured();
  const mercadoPagoConnected = mercadoPagoIntegration?.status === 'connected';
  const mercadoPagoConfigured = isMercadoPagoOAuthConfigured();
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
          <div className="stack">
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Datos profesionales</h2>
              <form action={updateSettings} className="form-grid">
                <label>
                  Nombre visible
                  <input
                    name="display_name"
                    defaultValue={profile?.display_name || ''}
                    placeholder="Ej. Darío Manrique"
                    minLength={2}
                    maxLength={120}
                    required
                    aria-describedby="display-name-hint"
                  />
                </label>
                <p id="display-name-hint" className="field-hint" style={{ gridColumn: '1 / -1', margin: '-10px 0 0' }}>
                  Este nombre se mostrará en TurnIA y en las comunicaciones.
                </p>

                <label>Profesión / especialidad<input name="profession" defaultValue={text('profession')} placeholder="Ej. Psicóloga clínica" maxLength={200} /></label>
                <label>Matrícula profesional<input name="license_number" defaultValue={text('license_number')} placeholder="Ej. MP 12345" maxLength={200} /></label>
                <label>Colegio / entidad profesional<input name="professional_college" defaultValue={text('professional_college')} maxLength={200} /></label>
                <label>CUIT<input name="cuit" defaultValue={text('cuit')} placeholder="Ej. 20-12345678-9" maxLength={200} /></label>
                <label>Razón social<input name="business_name" defaultValue={text('business_name')} maxLength={200} /></label>
                <label>Condición fiscal<input name="tax_condition" defaultValue={text('tax_condition')} placeholder="Ej. Monotributista" maxLength={200} /></label>

                <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
                  <h3 style={{ margin: 0 }}>Datos de contacto</h3>
                </div>
                <label>Teléfono profesional<input name="professional_phone" defaultValue={text('professional_phone')} maxLength={200} /></label>
                <label>Email profesional<input name="professional_email" type="email" defaultValue={text('professional_email')} maxLength={200} /></label>
                <label>Dirección del consultorio<input name="office_address" defaultValue={text('office_address')} maxLength={200} /></label>
                <label>Localidad<input name="locality" defaultValue={text('locality')} maxLength={200} /></label>
                <label>Provincia<input name="province" defaultValue={text('province')} maxLength={200} /></label>

                <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
                  <h3 style={{ margin: 0 }}>Preferencias operativas</h3>
                </div>
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

                <div className="form-actions">
                  <button className="btn" type="submit">Guardar configuración</button>
                </div>
              </form>
            </div>
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
                  Mercado Pago
                  <span className={`badge ${mercadoPagoConnected ? 'badge-confirmado' : mercadoPagoConfigured ? 'badge-pendiente' : 'badge-neutral'}`}>
                    {mercadoPagoConnected ? 'Conectado' : mercadoPagoConfigured ? 'No conectado' : 'No disponible'}
                  </span>
                </div>
                <div className="integration-row-desc">
                  Conectá tu cuenta para generar cobros de turnos directamente en tu cuenta de Mercado Pago.
                  {mercadoPagoConnected && mercadoPagoIntegration?.account_label ? ` Cuenta: ${mercadoPagoIntegration.account_label}.` : ''}
                  {!mercadoPagoConnected && !mercadoPagoConfigured ? ' Todavía no está disponible en este consultorio.' : ''}
                </div>
                <div className="integration-row-action">
                  {mercadoPagoConnected ? (
                    <form action={disconnectMercadoPago}>
                      <button className="btn danger" type="submit" style={{ padding: '7px 12px', fontSize: 13 }}>
                        Desconectar
                      </button>
                    </form>
                  ) : mercadoPagoConfigured ? (
                    <a
                      className="btn secondary"
                      style={{ padding: '7px 12px', fontSize: 13 }}
                      href="https://www.turniahealth.com.ar/api/integrations/mercadopago/oauth/connect"
                    >
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
