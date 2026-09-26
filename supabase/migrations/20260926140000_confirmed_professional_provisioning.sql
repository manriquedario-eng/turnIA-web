-- TurnIA — provisionado de profesional después de confirmar email.
-- El usuario NO obtiene tenant al registrarse. Recién cuando Supabase Auth
-- pasa email_confirmed_at de NULL a un timestamp se crea su estructura base.
-- Esto evita tenants huérfanos por registros nunca verificados.

create or replace function public.provision_confirmed_professional()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_display_name text;
begin
  if old.email_confirmed_at is not null or new.email_confirmed_at is null then
    return new;
  end if;

  -- Serializa el provisioning del mismo usuario ante reintentos concurrentes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.id::text, 0)
  );

  v_display_name := nullif(
    pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')),
    ''
  );

  if v_display_name is null then
    v_display_name := nullif(
      pg_catalog.split_part(coalesce(new.email, ''), '@', 1),
      ''
    );
  end if;

  v_display_name := pg_catalog.left(
    coalesce(v_display_name, 'Profesional'),
    120
  );

  insert into public.profiles (id, display_name)
  values (new.id, v_display_name)
  on conflict (id) do update
  set display_name = case
    when pg_catalog.btrim(public.profiles.display_name) = ''
      then excluded.display_name
    else public.profiles.display_name
  end;

  select tm.tenant_id
    into v_tenant_id
  from public.tenant_members tm
  where tm.user_id = new.id
  limit 1;

  if v_tenant_id is null then
    insert into public.tenants (name)
    values (v_display_name)
    returning id into v_tenant_id;

    insert into public.tenant_members (
      tenant_id,
      user_id,
      role,
      permissions
    ) values (
      v_tenant_id,
      new.id,
      'owner',
      '[]'::jsonb
    );
  end if;

  return new;
end;
$$;

revoke all on function public.provision_confirmed_professional()
  from public, anon, authenticated;

drop trigger if exists turnia_provision_confirmed_professional
  on auth.users;

create trigger turnia_provision_confirmed_professional
after update of email_confirmed_at on auth.users
for each row
when (
  old.email_confirmed_at is null
  and new.email_confirmed_at is not null
)
execute function public.provision_confirmed_professional();
