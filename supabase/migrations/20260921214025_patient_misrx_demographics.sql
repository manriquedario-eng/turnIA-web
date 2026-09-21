ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS sex text;

COMMENT ON COLUMN public.patients.birth_date IS
  'Fecha de nacimiento del paciente. Campo opcional general de TurnIA; puede ser requerido por integraciones de receta electrónica como MisRX.';

COMMENT ON COLUMN public.patients.sex IS
  'Sexo informado del paciente. Campo opcional general de TurnIA; la normalización específica para proveedores externos se realiza en la capa de integración.';
