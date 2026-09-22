#!/usr/bin/env bash
set -euo pipefail
umask 077

required_env=(
  SUPABASE_DB_URL
  BACKUP_AGE_RECIPIENT
  GDRIVE_ACCESS_TOKEN
  GDRIVE_DAILY_FOLDER_ID
  GDRIVE_WEEKLY_FOLDER_ID
  GDRIVE_MONTHLY_FOLDER_ID
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 2
  fi
done

for cmd in supabase docker age curl jq sha256sum md5sum gzip tar; do
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
rm -rf "$WORK_ROOT"
mkdir -p "$WORK_DIR"

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
# or refresh tokens. Parse the connection string ourselves and pass libpq fields
# separately so special characters in the DB password cannot be misread as URI syntax.
python3 - "$SUPABASE_DB_URL" "$WORK_DIR" <<'PY'
import os
import subprocess
import sys

url = sys.argv[1]
work_dir = sys.argv[2]

if "://" not in url:
    raise SystemExit("SUPABASE_DB_URL is not a PostgreSQL connection URL")

scheme, rest = url.split("://", 1)
if scheme not in {"postgres", "postgresql"}:
    raise SystemExit("SUPABASE_DB_URL must use postgres:// or postgresql://")

authority, database = rest.rsplit("/", 1)
userinfo, hostport = authority.rsplit("@", 1)
user, password = userinfo.split(":", 1)
host, port = hostport.rsplit(":", 1)
database = database.split("?", 1)[0]

cmd = [
    "docker", "run", "--rm",
    "-e", f"PGHOST={host}",
    "-e", f"PGPORT={port}",
    "-e", f"PGUSER={user}",
    "-e", f"PGPASSWORD={password}",
    "-e", f"PGDATABASE={database}",
    "-v", f"{work_dir}:/backup",
    "postgres:17-alpine",
    "pg_dump",
    "--data-only", "--no-owner", "--no-privileges",
    "--table=auth.users",
    "--table=auth.identities",
    "--table=auth.mfa_factors",
    "--table=auth.mfa_recovery_code_sets",
    "--table=auth.mfa_recovery_codes",
    "-f", "/backup/auth_identity_data.sql",
]

subprocess.run(cmd, check=True)
PY
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

FILE_NAME="$(basename "$ENCRYPTED")"

drive_api() {
  curl --fail-with-body --silent --show-error \
    -H "Authorization: Bearer $GDRIVE_ACCESS_TOKEN" \
    "$@"
}

upload_and_verify() {
  local folder_id="$1"
  local label="$2"
  local metadata response file_id remote_md5 local_md5

  metadata="$(jq -nc --arg name "$FILE_NAME" --arg parent "$folder_id" '{name:$name,parents:[$parent]}')"

  response="$(drive_api \
    -X POST \
    -F "metadata=$metadata;type=application/json;charset=UTF-8" \
    -F "file=@$ENCRYPTED;type=application/octet-stream" \
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,md5Checksum,parents")"

  file_id="$(jq -r '.id // empty' <<<"$response")"
  remote_md5="$(jq -r '.md5Checksum // empty' <<<"$response")"
  local_md5="$(md5sum "$ENCRYPTED" | awk '{print $1}')"

  if [[ -z "$file_id" || -z "$remote_md5" || "$local_md5" != "$remote_md5" ]]; then
    echo "Remote verification failed for $label" >&2
    exit 1
  fi

  echo "Verified upload to $label: $FILE_NAME ($file_id)"
}

prune_folder() {
  local folder_id="$1"
  local keep="$2"
  local label="$3"
  local query response

  query="'$folder_id' in parents and trashed = false and name contains 'turnia-prod-'"

  response="$(drive_api --get \
    --data-urlencode "q=$query" \
    --data-urlencode "orderBy=createdTime desc" \
    --data-urlencode "pageSize=100" \
    --data-urlencode "fields=files(id,name,createdTime)" \
    --data-urlencode "supportsAllDrives=true" \
    --data-urlencode "includeItemsFromAllDrives=true" \
    "https://www.googleapis.com/drive/v3/files")"

  mapfile -t stale_ids < <(jq -r --argjson keep "$keep" '.files[$keep:][]?.id' <<<"$response")
  mapfile -t stale_names < <(jq -r --argjson keep "$keep" '.files[$keep:][]?.name' <<<"$response")

  for i in "${!stale_ids[@]}"; do
    [[ -z "${stale_ids[$i]:-}" ]] && continue
    drive_api -X DELETE "https://www.googleapis.com/drive/v3/files/${stale_ids[$i]}?supportsAllDrives=true" >/dev/null
    echo "Pruned old backup from $label: ${stale_names[$i]}"
  done
}

upload_and_verify "$GDRIVE_DAILY_FOLDER_ID" "Daily"

if [[ "$(date '+%u')" == "7" ]]; then
  upload_and_verify "$GDRIVE_WEEKLY_FOLDER_ID" "Weekly"
fi

if [[ "$(date '+%d')" == "01" ]]; then
  upload_and_verify "$GDRIVE_MONTHLY_FOLDER_ID" "Monthly"
fi

# Retention runs only after a new Daily backup has been uploaded and verified.
prune_folder "$GDRIVE_DAILY_FOLDER_ID" 7 "Daily"
prune_folder "$GDRIVE_WEEKLY_FOLDER_ID" 4 "Weekly"
prune_folder "$GDRIVE_MONTHLY_FOLDER_ID" 3 "Monthly"

echo "TurnIA production backup completed successfully: $FILE_NAME"
