# TurnIA · Production backup and disaster recovery

## Purpose

Create an encrypted logical backup of the TurnIA production database outside both
Supabase and Vercel, then store it in TurnIA's Google Workspace Drive.

The scheduled workflow is intentionally inert until `BACKUP_ENABLED=true` is
configured in GitHub Actions secrets.

## Backup contents

Each encrypted package contains:

- `roles.sql`
- `schema.sql`
- `data.sql.gz`
- `history_schema.sql`
- `history_data.sql.gz`
- `auth_identity_data.sql.gz`
- `manifest.json`
- `SHA256SUMS.txt`
- `RESTORE.md`

The auth export keeps durable user/identity/MFA data but intentionally omits
sessions and refresh tokens. A recovered environment should require fresh login.

Supabase Storage object bytes are not part of this database backup and require a
separate backup process.

## Google Workspace Drive layout

The workflow is pinned to the existing TurnIA Workspace backup folders under `Database` (`1mx1xU9pYe76jsqmxkkye1ZfKOj7s4rvs`). Uploads and retention use the Google Drive API directly:

- `Daily/`
- `Weekly/`
- `Monthly/`

Retention:

- Daily: 7
- Weekly: 4
- Monthly: 3

The runner only prunes old files after the new Daily backup is uploaded and the
Google Drive MD5 checksum matches the local encrypted file.

## One-time GitHub Actions secrets

Configure these repository secrets before enabling the schedule:

- `SUPABASE_DB_URL`: production database connection string. Prefer the
  Supabase Session Pooler connection string so GitHub's IPv4 runner can connect.
Backup encryption uses the public age recipient `age1jqzzvehzp7wjrm8reyz2x6nx0rpr38e3yunrn60pxzmysyakk47stn5xcj`, which is safe to store in the workflow. The matching private recovery identity must remain offline and must never be committed to GitHub or stored beside the Drive backups.
Google Drive authentication is keyless: GitHub Actions uses OIDC Workload Identity
Federation to impersonate `turnia-backup@turnia-backups.iam.gserviceaccount.com`.
No service-account JSON key is created or stored.
- `BACKUP_ENABLED`: set exactly to `true` only after a manual backup and
  restore test have succeeded.

## Activation sequence

1. Create a TurnIA-owned Shared Drive or restricted Workspace folder.
2. Grant the backup service account access to that location only.
3. Generate an age identity offline and record only the public recipient in GitHub.
4. Configure the Supabase production database connection secret.
5. Run `TurnIA Production Backup` manually.
6. Confirm the encrypted file exists under `Daily/`.
7. Download that encrypted file to a controlled machine, decrypt it and verify
   `SHA256SUMS.txt`.
8. Restore into a separate Supabase test project and validate data/integrity.
9. Only after the restore test succeeds, set `BACKUP_ENABLED=true`.



## Restore validation — 2026-09-22

A real restore test was completed successfully against the isolated Supabase project
`turnia-restore-test` (`muxuflfdniwenlfteffm`). Production
(`nnbpefxvpmegngqopcvw`) was not used as a restore target.

Validated results:

- encrypted backup downloaded and decrypted successfully;
- every file in `SHA256SUMS.txt` matched;
- `schema.sql` restored without errors;
- `data.sql.gz` restored without errors;
- migration history restored successfully;
- the restore contained the same 48 public tables as production;
- exact row counts matched production across all 48 public tables;
- Auth counts matched production: 5 users, 5 identities, 0 MFA factors;
- migration history matched production: 45 migrations with latest version `20260922010623`;
- structural counts matched production: 58 RLS policies, 162 indexes, 13 triggers,
  18 public functions, and 272 constraints;
- all 108 public foreign keys were validated;
- an automated orphan check across all 108 public foreign keys found no orphaned rows;
- the `patient_documents.supersedes_document_id` self-referencing foreign key was
  identified as the source of the circular-FK dump warning and was restored as a
  valid, enforced constraint.

Restore-specific notes:

- `roles.sql` attempted to grant `SET` on the managed PostgreSQL parameter
  `log_min_messages` to `supabase_realtime_admin`. Managed Supabase rejected that
  statement with `permission denied for parameter log_min_messages`. The preceding
  role settings applied, and this managed-role limitation did not prevent schema or
  data recovery.
- Durable Auth data in the backup was verified against the isolated restore project.
  The five restored/target user UUIDs matched exactly. Active sessions and refresh
  tokens are intentionally not part of the backup and users must authenticate again
  after a disaster recovery event.

Conclusion: the logical database backup and restore path is validated for disaster
recovery. Scheduled backups may now be enabled with `BACKUP_ENABLED=true`.

## Recovery boundaries

This workflow does not back up:

- Supabase Storage object bytes
- Vercel environment variables
- Mercado Pago / ARCA / MisRX / OpenAI / WhatsApp provider secrets
- Google OAuth provider configuration
- active Supabase Auth sessions/refresh tokens

Those require their own recovery inventory or backup procedure.


## Keyless Google authentication

GitHub Actions receives a short-lived Google access token through:

- project number: `225705196055`
- pool: `turnia-github-backups`
- provider: `github-actions`
- service account: `turnia-backup@turnia-backups.iam.gserviceaccount.com`

The provider itself restricts authentication to repository
`manriquedario-eng/turnIA-web` on `refs/heads/main`. The service account has
Drive access only to the TurnIA backup Database folder shared with it.
