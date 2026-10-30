#!/bin/sh
set -eu
: "${RESTORE_DATABASE_URL:?set NEW empty restore database URL}"
: "${BACKUP_FILE:?set backup file}"
[ "${CONFIRM_EMPTY_RESTORE:-}" = "yes" ] || { echo 'Set CONFIRM_EMPTY_RESTORE=yes for an isolated empty target'; exit 1; }
if [ "${RESTORE_DATABASE_ONLY:-}" != "yes" ] && [ "${RESTORE_S3_CONFIRMED:-}" != "yes" ]; then
  : "${RESTORE_ARTIFACTS_FILE:?set matching artifact backup, or explicitly choose database-only/S3 recovery}"
  : "${RESTORE_ARTIFACT_DIR:?set empty artifact restore directory}"
fi
if [ "${RESTORE_ARTIFACTS_FILE:-}" ]; then
  : "${RESTORE_ARTIFACT_DIR:?set empty artifact restore directory}"
  python3 - <<'PY'
import os, pathlib, tarfile
root=pathlib.Path(os.environ['RESTORE_ARTIFACT_DIR'])
root.mkdir(parents=True,exist_ok=True,mode=0o700)
if root.is_symlink() or any(root.iterdir()): raise SystemExit('Refusing nonempty/unsafe artifact target')
with tarfile.open(os.environ['RESTORE_ARTIFACTS_FILE'],'r:gz') as archive:
    for member in archive.getmembers():
        if member.issym() or member.islnk() or not (member.isfile() or member.isdir()): raise SystemExit('Unsafe artifact archive entry')
        tarfile.data_filter(member,root)
PY
fi
count=$(psql "$RESTORE_DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
[ "$count" = 0 ] || { echo 'Refusing nonempty target'; exit 1; }
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
if [ "${RESTORE_ARTIFACTS_FILE:-}" ]; then
  python3 - <<'PY'
import os, pathlib, tarfile
root=pathlib.Path(os.environ['RESTORE_ARTIFACT_DIR'])
with tarfile.open(os.environ['RESTORE_ARTIFACTS_FILE'],'r:gz') as archive:
    archive.extractall(root,filter='data')
PY
fi
