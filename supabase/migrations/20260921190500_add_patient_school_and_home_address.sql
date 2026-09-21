alter table public.patients
  add column if not exists institution_name text,
  add column if not exists home_address text;

alter table public.patients
  drop constraint if exists patients_institution_name_length_check,
  drop constraint if exists patients_home_address_length_check;

alter table public.patients
  add constraint patients_institution_name_length_check
    check (institution_name is null or char_length(btrim(institution_name)) between 1 and 240),
  add constraint patients_home_address_length_check
    check (home_address is null or char_length(btrim(home_address)) between 1 and 300);

comment on column public.patients.institution_name is
  'Escuela, colegio, institución educativa u otra institución vinculada al paciente.';

comment on column public.patients.home_address is
  'Domicilio real del paciente para atención y referencia operativa. Es independiente del domicilio fiscal.';
