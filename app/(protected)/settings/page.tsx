import { requireTenant } from '@/lib/auth/require-user';
import { updateSettings } from './actions';

type PageProps = {
  searchParams?: Promise<{ ok?: string; error?: string }>;
};

export default async function SettingsPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const { supabase, user, tenantId } = await requireTenant();

  const [{ data: profile }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    supabase.from('settings').select('preferences').eq('tenant_id', tenantId).maybeSingle(),
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
    </section>
  );
}
