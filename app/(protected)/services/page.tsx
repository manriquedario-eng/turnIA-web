import { requireTenant } from '@/lib/auth/require-user';
import { createService, updateService } from './actions';

type SearchParams = Promise<{ ok?: string; error?: string }>;

export default async function ServicesPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, tenantId } = await requireTenant();
  const params = await searchParams;

  const { data: services, error } = await supabase
    .from('services')
    .select('id, name, duration_minutes, price, deposit, currency')
    .eq('tenant_id', tenantId)
    .order('name');

  if (error) throw new Error(`No se pudieron cargar los servicios: ${error.message}`);

  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Servicios</h1>
          <p className="muted">Administrá prestaciones, duración y valores.</p>
        </div>
      </div>

      {params.ok ? <div className="alert success">{params.ok}</div> : null}
      {params.error ? <div className="alert danger">{params.error}</div> : null}

      <div className="card">
        <h2>Nuevo servicio</h2>
        <form action={createService} className="form-grid">
          <input type="hidden" name="return_to" value="/services" />
          <label>
            Nombre
            <input name="name" required minLength={2} maxLength={120} />
          </label>
          <label>
            Duración (minutos)
            <input name="duration_minutes" type="number" min="1" max="1440" required />
          </label>
          <label>
            Precio
            <input name="price" type="number" min="0" step="0.01" />
          </label>
          <label>
            Seña
            <input name="deposit" type="number" min="0" step="0.01" />
          </label>
          <label>
            Moneda
            <input name="currency" defaultValue="ARS" minLength={3} maxLength={3} required />
          </label>
          <div className="form-actions">
            <button className="btn" type="submit">Crear servicio</button>
          </div>
        </form>
      </div>

      <div className="stack">
        {(services ?? []).map((service) => (
          <div className="card" key={service.id}>
            <form action={updateService} className="form-grid">
              <input type="hidden" name="id" value={service.id} />
              <input type="hidden" name="return_to" value="/services" />
              <label>
                Nombre
                <input name="name" defaultValue={service.name} required minLength={2} maxLength={120} />
              </label>
              <label>
                Duración (minutos)
                <input name="duration_minutes" type="number" min="1" max="1440" defaultValue={service.duration_minutes} required />
              </label>
              <label>
                Precio
                <input name="price" type="number" min="0" step="0.01" defaultValue={service.price ?? ''} />
              </label>
              <label>
                Seña
                <input name="deposit" type="number" min="0" step="0.01" defaultValue={service.deposit ?? ''} />
              </label>
              <label>
                Moneda
                <input name="currency" defaultValue={service.currency ?? 'ARS'} minLength={3} maxLength={3} required />
              </label>
              <div className="form-actions">
                <button className="btn secondary" type="submit">Guardar cambios</button>
              </div>
            </form>
          </div>
        ))}

        {(services ?? []).length === 0 ? (
          <div className="card muted">Todavía no hay servicios cargados.</div>
        ) : null}
      </div>
    </section>
  );
}
