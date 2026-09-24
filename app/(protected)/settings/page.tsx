import { requireTenant } from '@/lib/auth/require-user';
import { updateSettings, disconnectGoogleCalendar, disconnectMercadoPago, updateAiTranscriptionSetting, saveArcaConnection, testArcaConnection, selectArcaActivity, updateArcaBillingPreferences, saveMisRxConnection, testMisRxConnection, disconnectMisRxIntegration, connectDigilogixIntegration, testDigilogixConnection, disconnectDigilogixIntegration } from './actions';
import { isGoogleOAuthConfigured } from '@/lib/google/oauth';
import { isMercadoPagoOAuthConfigured } from '@/lib/mercadopago/oauth';
import { isWhatsAppConfigured } from '@/lib/whatsapp/provider';
import { isEmailConfigured } from '@/lib/email/provider';
import { isArcaWsaaConfigured, getArcaConnectionSummary } from '@/lib/arca/wsaa';
import { getWsfeActivities } from '@/lib/arca/wsfe';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import { FiscalProfileFields } from '@/components/settings/FiscalProfileFields';
import { isFiscalProfileEnabled } from '@/lib/billing/fiscal-profile';
import { getMisRxConnectionSummary, isMisRxConnectionConfigured } from '@/lib/misrx/connection';
import { shouldShowMisRxForDeclaredProfession } from '@/lib/misrx/profession-eligibility';
import { isMisRxUiEnabled } from '@/lib/misrx/homologation';
import { isDigilogixFeatureVisible, areDigilogixLiveCallsEnabled, getDigilogixConfig } from '@/lib/digilogix/config';

type PageProps = {
  searchParams?: Promise<{ ok?: string; error?: string }>;
};

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes === 0) return `${remainder} s`;
  if (remainder === 0) return `${minutes} min`;
  return `${minutes} min ${remainder} s`;
}

export default async function SettingsPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const { supabase, user, tenantId } = await requireTenant();

  const [{ data: profile }, { data: settings }, { data: googleIntegration }, { data: mercadoPagoIntegration }, { data: misRxIntegration }, { data: digilogixConnection }, { data: transcriptionAccount, error: transcriptionAccountError }] = await Promise.all([
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
    supabase
      .from('integration_status')
      .select('status, account_label, connected_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('provider', 'misrx')
      .maybeSingle(),
    supabase
      .from('digilogix_connections')
      .select('cuil,email,status,connected_at,last_certificate_check_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('ai_transcription_accounts')
      .select('enabled,balance_seconds,lifetime_used_seconds')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  const preferences = settings?.preferences && typeof settings.preferences === 'object'
    ? settings.preferences as Record<string, unknown>
    : {};
  const professionalProfile = settings?.profile && typeof settings.profile === 'object'
    ? settings.profile as Record<string, unknown>
    : {};

  const fiscalEnabled = isFiscalProfileEnabled(professionalProfile);

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
  const misRxConnected = misRxIntegration?.status === 'connected';
  const misRxError = misRxIntegration?.status === 'error';
  const misRxConfigured = isMisRxConnectionConfigured();
  const misRxConnection = misRxConfigured
    ? await getMisRxConnectionSummary({ tenantId, userId: user.id })
    : null;
  const digilogixConfigured = Boolean(getDigilogixConfig()) && areDigilogixLiveCallsEnabled();
  const digilogixVisible = isDigilogixFeatureVisible();
  const digilogixConnected = digilogixConnection?.status === 'connected';
  const digilogixOnboardingRequired = digilogixConnection?.status === 'onboarding_required';
  const digilogixError = digilogixConnection?.status === 'error';
  const digilogixHomologationCuilConfigured = process.env.VERCEL_ENV === 'preview' && Boolean(process.env.DIGILOGIX_TEST_CUIL?.trim());
  const digilogixMatchesHomologationCuil = digilogixHomologationCuilConfigured && Boolean(digilogixConnection?.cuil) && digilogixConnection?.cuil === process.env.DIGILOGIX_TEST_CUIL?.trim();
  const whatsappConfigured = isWhatsAppConfigured();
  const emailConfigured = isEmailConfigured();
  const declaredProfessionAllowsMisRx = shouldShowMisRxForDeclaredProfession(professionalProfile.profession);
  const showMisRxIntegration = isMisRxUiEnabled() && Boolean(
    misRxConnection ||
    misRxConnected ||
    misRxError ||
    declaredProfessionAllowsMisRx
  );

  // ARCA: lectura server-only; nunca expone certificado, clave, token ni sign.
  const arcaConfigured = isArcaWsaaConfigured();
  const arcaConnection = arcaConfigured ? await getArcaConnectionSummary({ tenantId, userId: user.id }) : null;
  const arcaConnected = Boolean(arcaConnection?.connectedAt);
  // ARCA es la fuente de verdad para la actividad fiscal. Si la conexión está
  // activa, cargamos las actividades habilitadas para usarlas tanto en el
  // selector de Datos profesionales como en el panel de diagnóstico.
  const arcaActivitiesResult =
    arcaConnected
      ? await getWsfeActivities({ tenantId, userId: user.id, environment: 'homologacion' })
      : null;
  const arcaActivities = arcaActivitiesResult?.ok ? arcaActivitiesResult.data : [];
  const arcaActivitiesError = arcaActivitiesResult && !arcaActivitiesResult.ok
    ? arcaActivitiesResult.errorMessage
    : null;
  const transcriptionAvailable = !transcriptionAccountError && Boolean(transcriptionAccount);
  const transcriptionEnabled = Boolean(transcriptionAccount?.enabled);
  const transcriptionBalanceSeconds = Number(transcriptionAccount?.balance_seconds ?? 0);
  const transcriptionUsedSeconds = Number(transcriptionAccount?.lifetime_used_seconds ?? 0);

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
              <h2>Datos profesionales</h2>
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
                <FiscalProfileFields
                  defaultEnabled={fiscalEnabled}
                  cuit={text('cuit')}
                  businessName={text('business_name')}
                  taxCondition={text('tax_condition')}
                  savedActivityCode={text('activity_code')}
                  activities={arcaActivities}
                  arcaConnected={arcaConnected}
                  arcaError={arcaActivitiesError}
                />

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

            {/* Mismo acento "módulo premium" que en Deudas y métricas
                (.module-active) cuando está activa — y el resumen de
                minutos pasa a usar .stat-strip-item de verdad (antes tenía
                la clase contenedora .stat-strip pero divs sueltos adentro,
                sin los divisores/tipografía del resto de la app). */}
            <div className={`card ${transcriptionEnabled ? 'module-active' : ''}`}>
              <div className="page-header" style={{ marginBottom: 12 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Transcripción con IA</h2>
                  <p className="text-helper" style={{ margin: '6px 0 0' }}>
                    Módulo opcional para dictados breves del profesional, de hasta 5 minutos. No está pensado para grabar sesiones ni conversaciones. TurnIA usa el audio sólo para convertirlo a texto y no conserva el archivo de audio.
                  </p>
                </div>
                <span className={`badge ${transcriptionEnabled ? 'badge-confirmado' : 'badge-neutral'}`}>
                  {transcriptionEnabled ? 'Activa' : 'Desactivada'}
                </span>
              </div>

              {transcriptionAvailable ? (
                <>
                  <div className="stat-strip" style={{ marginBottom: 14 }}>
                    <div className="stat-strip-item">
                      <span className="stat-strip-label">Minutos disponibles</span>
                      <span className="stat-strip-value">{formatDuration(transcriptionBalanceSeconds)}</span>
                    </div>
                    <div className="stat-strip-item">
                      <span className="stat-strip-label">Minutos utilizados</span>
                      <span className="stat-strip-value">{formatDuration(transcriptionUsedSeconds)}</span>
                    </div>
                  </div>

                  <p className="text-helper">
                    El dictado sólo funciona mientras el módulo esté activo y haya minutos disponibles.
                    La compra de paquetes se habilitará más adelante desde TurnIA.
                  </p>

                  <form action={updateAiTranscriptionSetting}>
                    <input type="hidden" name="enabled" value={transcriptionEnabled ? 'false' : 'true'} />
                    <button className={`btn ${transcriptionEnabled ? 'secondary' : ''}`} type="submit">
                      {transcriptionEnabled ? 'Desactivar transcripción' : 'Activar transcripción'}
                    </button>
                  </form>
                </>
              ) : (
                <p className="alert error" style={{ marginBottom: 0 }}>
                  El control de Transcripción IA todavía no está habilitado en esta base de datos.
                </p>
              )}
            </div>
          </div>
        }
        integraciones={
          <div className="card">
            <h2>Integraciones</h2>
            <p className="text-helper">
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
                      <button className="btn danger btn-compact" type="submit">
                        Desconectar
                      </button>
                    </form>
                  ) : googleConfigured ? (
                    <a className="btn secondary btn-compact" href="/api/google/oauth/connect">
                      Conectar
                    </a>
                  ) : (
                    <span className="btn secondary btn-compact" aria-disabled="true" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
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
                      <button className="btn danger btn-compact" type="submit">
                        Desconectar
                      </button>
                    </form>
                  ) : mercadoPagoConfigured ? (
                    <a className="btn secondary btn-compact" href="https://www.turniahealth.com.ar/api/integrations/mercadopago/oauth/connect">
                      Conectar
                    </a>
                  ) : (
                    <span className="btn secondary btn-compact" aria-disabled="true" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                      Conectar
                    </span>
                  )}
                </div>
              </div>

              {digilogixVisible ? (
                <div className="integration-row">
                  <div className="integration-row-name">
                    Digilogix · Firma digital
                    <span className={`badge ${digilogixConnected ? 'badge-confirmado' : digilogixError ? 'badge-cancelado' : digilogixConfigured ? 'badge-pendiente' : 'badge-neutral'}`}>
                      {digilogixConnected
                        ? 'Conectado'
                        : digilogixOnboardingRequired
                          ? 'Alta pendiente'
                          : digilogixError
                            ? 'Revisar conexión'
                            : digilogixConfigured
                              ? 'No conectado'
                              : 'No disponible'}
                    </span>
                  </div>
                  <div className="integration-row-desc">
                    Firma documentos clínicos desde TurnIA mediante Digilogix. La firma se autoriza en el entorno seguro del proveedor y TurnIA conserva el PDF firmado y su trazabilidad.
                    {digilogixConnected ? ' Certificado vigente detectado.' : ''}
                    {digilogixOnboardingRequired ? ' El alta o renovación del certificado todavía debe completarse en Digilogix.' : ''}
                    {digilogixOnboardingRequired && digilogixHomologationCuilConfigured
                      ? digilogixMatchesHomologationCuil
                        ? ' El CUIL cargado coincide con el CUIL de homologación previamente validado.'
                        : ' El CUIL cargado NO coincide con el CUIL de homologación previamente validado.'
                      : ''}
                  </div>
                  <div className="integration-row-action" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {digilogixConnected ? (
                      <>
                        <form action={testDigilogixConnection}>
                          <button className="btn secondary btn-compact" type="submit">Verificar conexión</button>
                        </form>
                        <form action={disconnectDigilogixIntegration}>
                          <button className="btn danger btn-compact" type="submit">Desconectar</button>
                        </form>
                      </>
                    ) : digilogixOnboardingRequired ? (
                      <div className="stack" style={{ width: '100%', marginTop: 8 }}>
                        <div className="alert" style={{ margin: 0 }}>
                          <strong>Alta de certificado pendiente.</strong> Digilogix continúa el registro fuera de TurnIA.
                          Revisá el correo enviado al email del firmante y seguí el enlace de Digilogix para completar
                          validación de identidad, autenticador, PIN y emisión del certificado.
                        </div>
                        <div className="form-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <a
                            className="btn secondary btn-compact"
                            href="https://suscriptor.digilogix.com.ar/Login"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Continuar alta en Digilogix
                          </a>
                          <form action={testDigilogixConnection}>
                            <button className="btn btn-compact" type="submit">Verificar conexión</button>
                          </form>
                          <form action={disconnectDigilogixIntegration}>
                            <button className="btn danger btn-compact" type="submit">Cancelar conexión</button>
                          </form>
                        </div>
                        <p className="field-hint" style={{ margin: 0 }}>
                          Si no recibiste el correo, en el portal de Digilogix podés usar “No tengo usuario” con el mismo email cargado en TurnIA.
                        </p>
                      </div>
                    ) : digilogixConfigured ? (
                      <form action={connectDigilogixIntegration} className="form-grid" style={{ width: '100%', marginTop: 8 }}>
                        <label>
                          CUIL del firmante
                          <input
                            name="cuil"
                            inputMode="numeric"
                            defaultValue={digilogixConnection?.cuil ?? ''}
                            placeholder="11 dígitos"
                            maxLength={14}
                            required
                          />
                        </label>
                        <label>
                          Email del firmante
                          <input
                            name="email"
                            type="email"
                            defaultValue={digilogixConnection?.email ?? text('professional_email')}
                            placeholder="tu@email.com"
                            maxLength={200}
                            required
                          />
                        </label>
                        <p className="field-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
                          TurnIA consulta si ya tenés un certificado vigente. Si no existe o venció, inicia el alta con Digilogix. El registro y los datos sensibles del firmante se completan únicamente en Digilogix.
                        </p>
                        <div className="form-actions">
                          <button className="btn secondary btn-compact" type="submit">Conectar firma digital</button>
                        </div>
                      </form>
                    ) : (
                      <span className="btn secondary btn-compact" aria-disabled="true" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                        Conectar
                      </span>
                    )}
                  </div>
                </div>
              ) : null}

              {showMisRxIntegration ? (
                <div className="integration-row">
                  <div className="integration-row-name">
                    MisRX · Receta electrónica
                    <span className={`badge ${misRxConnected ? 'badge-confirmado' : misRxError ? 'badge-cancelado' : misRxConfigured ? 'badge-pendiente' : 'badge-neutral'}`}>
                      {misRxConnected ? 'Conectado' : misRxError ? 'Error' : misRxConfigured ? 'No conectado' : 'No disponible'}
                    </span>
                  </div>
                  <div className="integration-row-desc">
                    Conecta TurnIA con MisRX para preparar la emisión, consulta y anulación de recetas electrónicas.
                    {misRxConnected && misRxIntegration?.account_label ? ` Cuenta: ${misRxIntegration.account_label}.` : ''}
                    {' '}La emisión productiva seguirá deshabilitada hasta completar la homologación de TurnIA y validar las credenciales externas con el soft_id oficial.
                  </div>
                  <div className="integration-row-action" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {misRxConnected ? (
                      <>
                        <form action={testMisRxConnection}>
                          <button className="btn secondary btn-compact" type="submit">Probar conexión</button>
                        </form>
                        <form action={disconnectMisRxIntegration}>
                          <button className="btn danger btn-compact" type="submit">Desconectar</button>
                        </form>
                      </>
                    ) : misRxConfigured ? (
                      <form action={saveMisRxConnection} className="form-grid" style={{ width: '100%', marginTop: 8 }}>
                        <label>
                          Usuario MisRX
                          <input name="username" autoComplete="username" maxLength={200} required />
                        </label>
                        <label>
                          Contraseña MisRX
                          <input name="password" type="password" autoComplete="current-password" maxLength={500} required />
                        </label>
                        <p className="field-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
                          TurnIA prueba primero el acceso contra MisRX y sólo guarda la contraseña si el login es válido. Se almacena cifrada y nunca se expone al navegador nuevamente.
                        </p>
                        <div className="form-actions">
                          <button className="btn secondary btn-compact" type="submit">Conectar MisRX</button>
                        </div>
                      </form>
                    ) : (
                      <span className="btn secondary btn-compact" aria-disabled="true" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                        Conectar
                      </span>
                    )}
                  </div>
                </div>

              ) : null}

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
        facturacion={
          <div className="stack">
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Integración ARCA</h2>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Acá se configura únicamente la conexión fiscal con ARCA: credenciales, punto de venta y actividad.
                La operatoria diaria de borradores, sesiones y comprobantes vive en el menú <strong>Facturación</strong>.
                Por ahora la emisión continúa limitada al <strong>ambiente de homologación</strong>.
              </p>

              {!fiscalEnabled ? (
                <p className="alert" style={{ marginTop: 8 }}>
                  Para configurar ARCA y emitir comprobantes, activá <strong>Datos fiscales</strong> en la pestaña Preferencias.
                </p>
              ) : !arcaConfigured ? (
                <p className="alert" style={{ marginTop: 8 }}>Todavía no está disponible en este consultorio.</p>
              ) : (
                <>
                  <div className="integration-row" style={{ marginTop: 8 }}>
                    <div className="integration-row-name">
                      Conexión ARCA
                      <span className={`badge ${arcaConnected ? 'badge-confirmado' : 'badge-pendiente'}`}>
                        {arcaConnected ? 'Conectado (homologación)' : arcaConnection ? 'Credenciales guardadas, sin probar' : 'No conectado'}
                      </span>
                    </div>
                    <div className="integration-row-desc">
                      {arcaConnection
                        ? `CUIT ${arcaConnection.cuit}${arcaConnection.puntoVenta ? ` · Punto de venta ${arcaConnection.puntoVenta}` : ''}${arcaConnection.connectedAt ? ` · Conectado el ${new Date(arcaConnection.connectedAt).toLocaleString('es-AR')}` : ' · Todavía no se probó la conexión con WSAA.'}`
                        : 'Cargá tu certificado y clave privada de homologación para empezar.'}
                    </div>
                    {arcaConnection ? (
                      <div className="integration-row-action" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <form action={testArcaConnection}>
                          <button className="btn secondary" type="submit" style={{ padding: '7px 12px', fontSize: 13 }}>
                            Probar conexión con ARCA
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>

                  {arcaConnected ? (
                    <div className="card" style={{ marginTop: 16 }}>
                      <h3 style={{ marginTop: 0 }}>Actividad fiscal informada por ARCA</h3>
                      {arcaActivitiesResult?.ok ? (
                        arcaActivitiesResult.data.length > 0 ? (
                          <form action={selectArcaActivity} className="form-grid">
                            <label style={{ gridColumn: '1 / -1' }}>
                              Actividad habilitada
                              <select
                                name="activity_code"
                                defaultValue={
                                  arcaActivitiesResult.data.some((item) => String(item.id) === text('activity_code'))
                                    ? text('activity_code')
                                    : arcaActivitiesResult.data.length === 1
                                      ? String(arcaActivitiesResult.data[0].id)
                                      : ''
                                }
                                required
                              >
                                <option value="" disabled>Seleccioná una actividad habilitada</option>
                                {arcaActivitiesResult.data.map((activity) => (
                                  <option key={activity.id} value={String(activity.id)}>
                                    {activity.id} — {activity.description || 'Sin descripción'}
                                    {activity.order != null ? ` · Orden ${activity.order}` : ''}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <p className="field-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
                              Las opciones vienen directamente de ARCA mediante FEParamGetActividades. No se pueden ingresar códigos manualmente.
                            </p>
                            <div className="form-actions">
                              <button className="btn secondary" type="submit">Guardar actividad</button>
                            </div>
                          </form>
                        ) : (
                          <p className="alert" style={{ marginBottom: 0 }}>
                            ARCA no devolvió actividades habilitadas para este CUIT.
                          </p>
                        )
                      ) : (
                        <p className="alert error" style={{ marginBottom: 0 }}>
                          {arcaActivitiesResult?.errorMessage ?? 'No se pudieron consultar las actividades de ARCA.'}
                        </p>
                      )}
                    </div>
                  ) : null}

                  <form action={saveArcaConnection} className="form-grid" style={{ marginTop: 16 }}>
                    <label>
                      CUIT
                      <input name="cuit" defaultValue={arcaConnection?.cuit ?? ''} placeholder="Ej. 20123456789" maxLength={13} required />
                    </label>
                    <label>
                      Punto de venta <span className="muted" style={{ fontWeight: 400 }}>(opcional en esta fase)</span>
                      <input name="punto_venta" type="number" min="1" defaultValue={arcaConnection?.puntoVenta ?? ''} />
                    </label>
                    <label>
                      Certificado (.crt / .pem)
                      <input name="certificate_file" type="file" accept=".crt,.pem" required />
                    </label>
                    <label>
                      Clave privada (.key / .pem)
                      <input name="private_key_file" type="file" accept=".key,.pem" required />
                    </label>
                    <p className="field-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
                      Certificado y clave de <strong>homologación</strong> emitidos por ARCA. Se guardan cifrados — nunca en texto plano, nunca visibles desde el navegador.
                    </p>
                    <div className="form-actions">
                      <button className="btn" type="submit">Guardar, validar y traer actividades</button>
                    </div>
                  </form>

                  {arcaConnection ? (
                    <div className="card" style={{ marginTop: 16 }}>
                      <h3 style={{ marginTop: 0 }}>Preferencias de facturación</h3>
                      <p className="text-helper" style={{ marginTop: 0 }}>
                        El punto de venta pertenece a la integración ARCA. El código y nombre de actividad se cargan una sola vez en <strong>Datos profesionales</strong>.
                      </p>
                      <form action={updateArcaBillingPreferences} className="form-grid">
                        <label>
                          Punto de venta
                          <input name="punto_venta" type="number" min="1" defaultValue={arcaConnection.puntoVenta ?? 3} />
                        </label>
                        <div className="form-actions">
                          <button className="btn secondary" type="submit">Guardar preferencias</button>
                        </div>
                      </form>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        }
      />
    </section>
  );
}
