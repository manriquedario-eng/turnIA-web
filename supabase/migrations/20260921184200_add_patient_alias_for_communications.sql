alter table public.patients
  add column if not exists alias text,
  add column if not exists use_alias_for_communications boolean not null default false;

alter table public.patients
  drop constraint if exists patients_alias_length_check;

alter table public.patients
  add constraint patients_alias_length_check
  check (alias is null or char_length(btrim(alias)) between 1 and 160);

comment on column public.patients.alias is
  'Nombre corto o preferido del paciente para comunicaciones no fiscales. No reemplaza patients.name.';

comment on column public.patients.use_alias_for_communications is
  'Si true y alias no está vacío, TurnIA usa alias en WhatsApp, email y recordatorios. Facturación e identificación formal siguen usando patients.name.';
