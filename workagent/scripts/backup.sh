#!/bin/sh
set -eu
umask 077
: "${DATABASE_URL:?set target database URL}"
: "${BACKUP_DIR:?set private backup directory}"
[ "${WORKAGENT_WRITERS_QUIESCED:-}" = "yes" ] || { echo 'Quiesce API, channel and worker writers; set WORKAGENT_WRITERS_QUIESCED=yes'; exit 1; }
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
case "${STORAGE_DRIVER:-local}" in
 local) : "${ARTIFACT_DIR:?set artifact root for a complete local backup}"; [ -d "$ARTIFACT_DIR" ] ;;
 s3) : "${S3_BACKUP_MANIFEST:?set consistent versioned bucket snapshot manifest}"; cp "$S3_BACKUP_MANIFEST" "$BACKUP_DIR/s3-$stamp.manifest" ;;
 *) echo 'Unknown STORAGE_DRIVER'; exit 1 ;;
esac
pg_dump --dbname="$DATABASE_URL" --format=custom --file="$BACKUP_DIR/workagent-$stamp.dump"
if [ "${STORAGE_DRIVER:-local}" = "local" ]; then tar -C "$ARTIFACT_DIR" -czf "$BACKUP_DIR/artifacts-$stamp.tgz" .; fi
printf '%s\n' "Backup set $stamp complete; keep writers quiesced until both database and storage snapshots are captured"
