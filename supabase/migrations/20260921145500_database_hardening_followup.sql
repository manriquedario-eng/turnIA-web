-- Follow-up database hardening after the independent-professional security pass.

-- Keep extensions out of the exposed public schema.
create schema if not exists extensions;
alter extension btree_gist set schema extensions;

-- Avoid per-row auth.uid() re-evaluation in RLS policies.
alter policy tenant_member_rows on public.tenant_members
  using ((user_id = (select auth.uid())) or public.is_tenant_member(tenant_id));

alter policy profiles_select_own on public.profiles
  using (id = (select auth.uid()));

alter policy profiles_update_own on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

alter policy professional_reminders_owner_all on public.professional_reminders
  using (public.is_tenant_member(tenant_id) and professional_id = (select auth.uid()))
  with check (public.is_tenant_member(tenant_id) and professional_id = (select auth.uid()));

alter policy followups_tenant_patient_all on public.patient_follow_ups
  using (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1 from public.patients p
      where p.id = patient_follow_ups.patient_id
        and p.tenant_id = patient_follow_ups.tenant_id
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and professional_id = (select auth.uid())
    and exists (
      select 1 from public.patients p
      where p.id = patient_follow_ups.patient_id
        and p.tenant_id = patient_follow_ups.tenant_id
    )
    and (
      voice_note_id is null
      or exists (
        select 1 from public.patient_voice_notes n
        where n.id = patient_follow_ups.voice_note_id
          and n.tenant_id = patient_follow_ups.tenant_id
          and n.patient_id = patient_follow_ups.patient_id
      )
    )
  );

alter policy voice_notes_tenant_patient_insert on public.patient_voice_notes
  with check (
    public.is_tenant_member(tenant_id)
    and professional_id = (select auth.uid())
    and exists (
      select 1 from public.patients p
      where p.id = patient_voice_notes.patient_id
        and p.tenant_id = patient_voice_notes.tenant_id
    )
    and (
      appointment_id is null
      or exists (
        select 1 from public.appointments a
        where a.id = patient_voice_notes.appointment_id
          and a.tenant_id = patient_voice_notes.tenant_id
          and (a.patient_id is null or a.patient_id = patient_voice_notes.patient_id)
      )
    )
    and (
      follow_up_id is null
      or exists (
        select 1 from public.patient_follow_ups f
        where f.id = patient_voice_notes.follow_up_id
          and f.tenant_id = patient_voice_notes.tenant_id
          and f.patient_id = patient_voice_notes.patient_id
          and f.professional_id = patient_voice_notes.professional_id
      )
    )
  );

alter policy voice_notes_tenant_patient_delete on public.patient_voice_notes
  using (
    public.is_tenant_member(tenant_id)
    and professional_id = (select auth.uid())
    and exists (
      select 1 from public.patients p
      where p.id = patient_voice_notes.patient_id
        and p.tenant_id = patient_voice_notes.tenant_id
    )
  );

alter policy patient_voice_notes_update on public.patient_voice_notes
  using (
    public.is_tenant_member(tenant_id)
    and professional_id = (select auth.uid())
    and exists (
      select 1 from public.patients p
      where p.id = patient_voice_notes.patient_id
        and p.tenant_id = patient_voice_notes.tenant_id
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and professional_id = (select auth.uid())
    and exists (
      select 1 from public.patients p
      where p.id = patient_voice_notes.patient_id
        and p.tenant_id = patient_voice_notes.tenant_id
    )
    and (
      appointment_id is null
      or exists (
        select 1 from public.appointments a
        where a.id = patient_voice_notes.appointment_id
          and a.tenant_id = patient_voice_notes.tenant_id
          and (a.patient_id is null or a.patient_id = patient_voice_notes.patient_id)
      )
    )
    and (
      follow_up_id is null
      or exists (
        select 1 from public.patient_follow_ups f
        where f.id = patient_voice_notes.follow_up_id
          and f.tenant_id = patient_voice_notes.tenant_id
          and f.patient_id = patient_voice_notes.patient_id
          and f.professional_id = patient_voice_notes.professional_id
      )
    )
  );

-- High-value FK/query indexes for the current independent-professional flows.
create index if not exists appointments_patient_id_idx on public.appointments(patient_id);
create index if not exists appointments_professional_id_idx on public.appointments(professional_id);
create index if not exists appointments_service_id_idx on public.appointments(service_id);
create index if not exists patient_follow_ups_patient_id_idx on public.patient_follow_ups(patient_id);
create index if not exists patient_follow_ups_professional_id_idx on public.patient_follow_ups(professional_id);
create index if not exists patient_follow_ups_appointment_id_idx on public.patient_follow_ups(appointment_id);
create index if not exists patient_documents_patient_id_idx on public.patient_documents(patient_id);
create index if not exists patient_documents_professional_user_id_idx on public.patient_documents(professional_user_id);
create index if not exists patient_voice_notes_patient_id_idx on public.patient_voice_notes(patient_id);
create index if not exists patient_voice_notes_professional_id_idx on public.patient_voice_notes(professional_id);
create index if not exists patient_voice_notes_appointment_id_idx on public.patient_voice_notes(appointment_id);
create index if not exists payments_appointment_id_idx on public.payments(appointment_id);
create index if not exists payments_patient_id_idx on public.payments(patient_id);
create index if not exists professional_reminders_professional_id_idx on public.professional_reminders(professional_id);
create index if not exists waitlist_entries_patient_id_idx on public.waitlist_entries(patient_id);
create index if not exists waitlist_entries_service_id_idx on public.waitlist_entries(service_id);
create index if not exists ai_transcription_reservations_patient_id_idx on public.ai_transcription_reservations(patient_id);
create index if not exists ai_transcription_reservations_professional_id_idx on public.ai_transcription_reservations(professional_id);
