'use client';

import { useState } from 'react';

type Activity = {
  id: string;
  description: string;
};

export function FiscalProfileFields({
  defaultEnabled,
  cuit,
  businessName,
  taxCondition,
  savedActivityCode,
  activities,
  arcaConnected,
  arcaError,
}: {
  defaultEnabled: boolean;
  cuit: string;
  businessName: string;
  taxCondition: string;
  savedActivityCode: string;
  activities: Activity[];
  arcaConnected: boolean;
  arcaError: string | null;
}) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const savedActivityIsValid = savedActivityCode
    ? activities.some((activity) => activity.id === savedActivityCode)
    : false;

  return (
    <>
      <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
        <div className="nav" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>Datos fiscales</h3>
            <p className="text-helper" style={{ margin: '4px 0 0' }}>
              Opcional. Activá esta sección sólo si vas a emitir comprobantes desde TurnIA.
            </p>
          </div>
          <label className="checkbox-field" style={{ fontWeight: 600 }}>
            <input
              type="checkbox"
              name="fiscal_enabled"
              value="true"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Activar datos fiscales
          </label>
        </div>
      </div>

      {enabled ? (
        <>
          <label>
            CUIT
            <input name="cuit" defaultValue={cuit} placeholder="Ej. 20-12345678-9" maxLength={200} />
          </label>
          <label>
            Razón social
            <input name="business_name" defaultValue={businessName} maxLength={200} />
          </label>
          <label>
            Condición fiscal
            <input name="tax_condition" defaultValue={taxCondition} placeholder="Ej. Monotributista" maxLength={200} />
          </label>

          <div className="form-section-divider" style={{ gridColumn: '1 / -1' }}>
            <h3 style={{ margin: 0 }}>Actividad fiscal</h3>
            <p className="text-helper" style={{ marginTop: 4 }}>
              TurnIA usa como fuente de verdad las actividades que ARCA habilita para el emisor.
            </p>
          </div>

          {arcaConnected && !arcaError ? (
            <>
              <input type="hidden" name="activity_management" value="arca_select" />
              <label style={{ gridColumn: '1 / -1' }}>
                Actividad habilitada en ARCA
                <select name="activity_code" defaultValue={savedActivityIsValid ? savedActivityCode : ''} required>
                  <option value="" disabled>Seleccioná una actividad habilitada</option>
                  {activities.map((activity) => (
                    <option key={activity.id} value={activity.id}>
                      {activity.id} — {activity.description || 'Sin descripción'}
                    </option>
                  ))}
                </select>
              </label>

              {!savedActivityIsValid && savedActivityCode ? (
                <p className="alert error" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  La actividad guardada {savedActivityCode} ya no figura entre las actividades habilitadas por ARCA.
                  Seleccioná una opción válida antes de guardar.
                </p>
              ) : null}

              {activities.length === 0 ? (
                <p className="alert" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  ARCA no devolvió actividades habilitadas para este emisor en homologación.
                </p>
              ) : (
                <p className="field-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  El código y la descripción se guardan automáticamente desde FEParamGetActividades.
                </p>
              )}
            </>
          ) : (
            <div style={{ gridColumn: '1 / -1' }}>
              <p className="alert" style={{ margin: 0 }}>
                {arcaConnected
                  ? `No se pudieron consultar las actividades de ARCA: ${arcaError ?? 'respuesta no disponible'}.`
                  : 'Conectá y probá ARCA en la pestaña Facturación para poder seleccionar una actividad fiscal válida.'}
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="field-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
          Podés usar agenda, pacientes, pagos y el resto de TurnIA sin cargar información fiscal.
        </p>
      )}
    </>
  );
}
