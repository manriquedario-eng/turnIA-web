#!/usr/bin/env bash
set -euo pipefail
umask 077

required_env=(
  SUPABASE_DB_URL
  BACKUP_AGE_RECIPIENT
  GDRIVE_SERVICE_ACCOUNT_JSON
  GDRIVE_ROOT_FOLDER_ID
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 2
  fi
done

for cmd in supabase docker age rclone jq sha256sum gzip tar; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Required command not found: $cmd" >&2
    exit 2
  }
done

export TZ="${BACKUP_TIMEZONE:-America/Argentina/Mendoza}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-nnbpefxvpmegngqopcvw}"
STAMP="$(date '+%Y-%m-%d_%H%M%S')"
BACKUP_ID="turnia-prod-${STAMP}"
WORK_ROOT="${RUNNER_TEMP:-/tmp}/turnia-backup"
WORK_DIR="${WORK_ROOT}/${BACKUP_ID}"
ARCHIVE="${WORK_ROOT}/${BACKUP_ID}.tar.gz"
ENCRYPTED="${ARCHIVE}.age"
SA_FILE="${WORK_ROOT}/google-drive-service-account.json"

rm -rf "$WORK_ROOT"
mkdir -p "$WORK_DIR"
printf '%s' "$GDRIVE_SERVICE_ACCOUNT_JSON" > "$SA_FILE"

cleanup() {
  rm -rf "$WORK_ROOT"
}
trap cleanup EXIT

echo "Creating Supabase logical backup: $BACKUP_ID"

supabase db dump --db-url "$SUPABASE_DB_URL" -f "$WORK_DIR/roles.sql" --role-only
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$WORK_DIR/schema.sql"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$WORK_DIR/data.sql" --data-only --use-copy \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
gzip -9 "$WORK_DIR/data.sql"

# Preserve the migration ledger explicitly. Supabase CLI excludes managed schemas
# from the normal schema dump, so this is stored separately for disaster recovery.
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$WORK_DIR/history_schema.sql" --schema supabase_migrations
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$WORK_DIR/history_data.sql" --data-only --use-copy --schema supabase_migrations
gzip -9 "$WORK_DIR/history_data.sql"

# Preserve durable authentication identity data without restoring active sessions
# or refresh tokens. A recovered environment should issue fresh sessions.
docker run --rm \
  -e DATABASE_URL="$SUPABASE_DB_URL" \
  -v "$WORK_DIR:/backup" \
  postgres:17-alpine \
  sh -ec 'pg_dump "$DATABASE_URL" \
    --data-only --no-owner --no-privileges \
    --table=auth.users \
    --table=auth.identities \
    --table=auth.mfa_factors \
    --table=auth.mfa_recovery_code_sets \
    --table=auth.mfa_recovery_codes \
    -f /backup/auth_identity_data.sql'
gzip -9 "$WORK_DIR/auth_identity_data.sql"

cat > "$WORK_DIR/RESTORE.md" <<'EOF'
# TurnIA production backup

This package is a disaster-recovery logical backup.

Recommended restore order into a separate Supabase project:
1. roles.sql
2. schema.sql
3. data.sql.gz
4. history_schema.sql
5. history_data.sql.gz
6. auth_identity_data.sql.gz only after reviewing the target auth schema

Important:
- Do not test restores against production.
- Supabase Storage object bytes are NOT included in this package.
- Auth sessions and refresh tokens are intentionally not included; users should sign in again.
- Provider/API secrets and Vercel environment variables are not included.
- Validate SHA256SUMS.txt before restoring.
EOF

cat > "$WORK_DIR/manifest.json" <<EOF
{
  "application": "TurnIA",
  "environment": "production",
  "project_ref": "${PROJECT_REF}",
  "created_at": "$(date --iso-8601=seconds)",
  "timezone": "${TZ}",
  "backup_type": "full_logical",
  "postgres_major": 17,
  "encrypted": true,
  "database": {
    "roles": "roles.sql",
    "schema": "schema.sql",
    "data": "data.sql.gz",
    "migration_history_schema": "history_schema.sql",
    "migration_history_data": "history_data.sql.gz",
    "auth_identity_data": "auth_identity_data.sql.gz"
  },
  "auth_active_sessions_included": false,
  "storage_objects_included": false,
  "application_secrets_included": false
}
EOF

(
  cd "$WORK_DIR"
  sha256sum roles.sql schema.sql data.sql.gz history_schema.sql history_data.sql.gz auth_identity_data.sql.gz manifest.json RESTORE.md > SHA256SUMS.txt
  sha256sum -c SHA256SUMS.txt
)

tar -C "$WORK_ROOT" -czf "$ARCHIVE" "$BACKUP_ID"
age -r "$BACKUP_AGE_RECIPIENT" -o "$ENCRYPTED" "$ARCHIVE"

test -s "$ENCRYPTED"

export RCLONE_CONFIG_DRIVE_TYPE=drive
export RCLONE_CONFIG_DRIVE_SCOPE=drive
export RCLONE_CONFIG_DRIVE_SERVICE_ACCOUNT_FILE="$SA_FILE"
export RCLONE_CONFIG_DRIVE_ROOT_FOLDER_ID="$GDRIVE_ROOT_FOLDER_ID"

FILE_NAME="$(basename "$ENCRYPTED")"

upload_and_verify() {
  local folder="$1"
  local target="drive:${folder}/${FILE_NAME}"

  rclone copyto "$ENCRYPTED" "$target" --drive-chunk-size 32M

  local local_md5 remote_md5
  local_md5="$(md5sum "$ENCRYPTED" | awk '{print $1}')"
  remote_md5="$(rclone md5sum "$target" | awk '{print $1}')"

  if [[ -z "$remote_md5" || "$local_md5" != "$remote_md5" ]]; then
    echo "Remote verification failed for $target" >&2
    exit 1
  fi

  echo "Verified upload: $target"
}

prune_folder() {
  local folder="$1"
  local keep="$2"

  mapfile -t stale < <(
    rclone lsjson "drive:${folder}" --files-only |
      jq -r --argjson keep "$keep" 'sort_by(.ModTime) | reverse | .[$keep:] | .[].Path'
  )

  for path in "${stale[@]:-}"; do
    [[ -z "$path" ]] && continue
    rclone deletefile "drive:${folder}/${path}"
    echo "Pruned old backup: ${folder}/${path}"
  done
}

upload_and_verify "Daily"

if [[ "$(date '+%u')" == "7" ]]; then
  upload_and_verify "Weekly"
fi

if [[ "$(date '+%d')" == "01" ]]; then
  upload_and_verify "Monthly"
fi

# Retention runs only after a new Daily backup has been uploaded and verified.
prune_folder "Daily" 7
prune_folder "Weekly" 4
prune_folder "Monthly" 3

echo "TurnIA production backup completed successfully: $FILE_NAME"
