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

The workflow is pinned to the TurnIA Workspace `Database` folder (`1mx1xU9pYe76jsqmxkkye1ZfKOj7s4rvs`). It must contain (or allow rclone to create):

- `Daily/`
- `Weekly/`
- `Monthly/`

Retention:

- Daily: 7
- Weekly: 4
- Monthly: 3

The runner only prunes old files after the new Daily backup is uploaded and its
MD5 checksum matches the local encrypted file.

## One-time GitHub Actions secrets

Configure these repository secrets before enabling the schedule:

- `SUPABASE_DB_URL`: production database connection string. Prefer the
  Supabase Session Pooler connection string so GitHub's IPv4 runner can connect.
- `BACKUP_AGE_RECIPIENT`: age public recipient. The private recovery identity
  must be kept offline and must never be committed to GitHub or stored beside
  the Drive backups.
- `GDRIVE_SERVICE_ACCOUNT_JSON`: Google Cloud service-account JSON with access
  only to the backup folder / Shared Drive.
- `BACKUP_ENABLED`: set exactly to `true` only after a manual backup and
  restore test have succeeded.

## Activation sequence

1. Create a TurnIA-owned Shared Drive or restricted Workspace folder.
2. Grant the backup service account access to that location only.
3. Generate an age identity offline and record only the public recipient in GitHub.
4. Configure the four connection/encryption secrets above.
5. Run `TurnIA Production Backup` manually.
6. Confirm the encrypted file exists under `Daily/`.
7. Download that encrypted file to a controlled machine, decrypt it and verify
   `SHA256SUMS.txt`.
8. Restore into a separate Supabase test project and validate data/integrity.
9. Only after the restore test succeeds, set `BACKUP_ENABLED=true`.

## Recovery boundaries

This workflow does not back up:

- Supabase Storage object bytes
- Vercel environment variables
- Mercado Pago / ARCA / MisRX / OpenAI / WhatsApp provider secrets
- Google OAuth provider configuration
- active Supabase Auth sessions/refresh tokens

Those require their own recovery inventory or backup procedure.
