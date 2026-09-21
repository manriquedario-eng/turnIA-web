-- Allow an authenticated professional to read and update only their own
-- display_name in public.profiles. Keep all other profile rows protected by RLS.

grant select (id, display_name) on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());
