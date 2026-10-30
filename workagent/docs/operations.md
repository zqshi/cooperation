# Production operations

WorkAgent uses one API/control process, worker execution processes, channel ingress, two static products and a TLS reverse proxy. PostgreSQL and local artifacts are persistent; API/worker/channel have no public ports in production Compose. The current process-local limiter assumes one API replica. Use a shared limiter before scaling the API horizontally.

## Configure and provision

Create a private root `.env.production` using a secret manager. Never copy the development `.env` into production. Generate two distinct 32-byte random secrets encoded as hex or base64url for JWT_SECRET and ENCRYPTION_KEY (for example `openssl rand -hex 32`). Opaque DB sessions require no SESSION_SECRET; there is no shared INTERNAL_TOKEN authentication boundary. Set NODE_ENV=production, DATABASE_URL, HTTPS API_URL/CONSOLE_ORIGIN/USER_PORTAL_ORIGIN, HTTPS MODEL_BASE_URL, MODEL_API_KEY and MODEL_NAME. Remove USE_MOCK_MODEL and all SEED_* variables. Secret rotation requires planning: changing ENCRYPTION_KEY without re-encrypting connector secrets makes them unreadable; signing/encryption keys must be distinct.

Set INTERNAL_API_URL=http://api:4100 for the private channel-to-control hop. TRUSTED_PROXY defaults empty (untrusted); configure only actual proxy IPs/CIDRs, never an all-network range. TOOL_ALLOWED_HOSTS is a comma-separated exact HTTPS hostname allowlist; no private addresses, credentials in URLs or redirects are allowed. Connector endpoint changes require republishing affected Agents before current secrets are sent.

Set STORAGE_DRIVER=local and ARTIFACT_DIR=/app/data/artifacts, or STORAGE_DRIVER=s3 with S3_BUCKET/S3_REGION and optional HTTPS S3_ENDPOINT. AWS SDK uses the standard credential/role provider chain. Use a narrowly scoped workload role, private bucket, encryption and versioned offsite backups. Never put credentials in frontend VITE_* variables. S3 protocol tests are fixtures; validate real IAM, retention and encryption policies separately.

Production seed always refuses execution. After migrations, use the audited command; passwords arrive via stdin or WORKAGENT_PROVISION_PASSWORD, never command arguments. Use a unique password with at least 16 characters, at most 72 UTF-8 bytes and at least eight distinct characters. Do not print or persist passwords in shell history.

```sh
# Read password from your secret-manager pipe into stdin:
ENV_FILE=.env.production pnpm production:provision tenant owner@example.com my-company 'My Company'
ENV_FILE=.env.production pnpm production:provision platform platform-operator@example.com
ENV_FILE=.env.production pnpm production:provision revoke-platform platform-operator@example.com
ENV_FILE=.env.production pnpm production:provision rotate owner@example.com
```

Tenant provisioning creates a new org, owner and quota. Platform provisioning creates a separate new platform-only principal. Duplicate existing identities fail rather than silently granting privileges. Rotate replaces password and revokes both session types. Revoke removes platform grant/session immediately. Public channel users must be explicitly bound by enterprise administrators; unbound/disabled members cannot execute.

Production publication requires a passed nonempty evaluation bound to the exact draft snapshot/checksum. Run draft evaluations before first publish. Owner/admin emergency override needs a reason of at least 20 characters and writes audit; a builder cannot override. Private Agents remain tenant creator/build-role only; public visibility never crosses org boundaries.

## Prepare and start on the target host

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
NODE_ENV=production ENV_FILE=.env.production pnpm db:migrate
NODE_ENV=production ENV_FILE=.env.production pnpm production:preflight
# Supply POSTGRES_PASSWORD, CONSOLE_HOST and PORTAL_HOST to Compose interpolation.
# .env.production supplies application environment, not Compose interpolation.
docker compose --env-file .env.production -f infra/compose/production.yml config --quiet
docker compose --env-file .env.production -f infra/compose/production.yml build
docker compose --env-file .env.production -f infra/compose/production.yml up -d
```

The migration service must succeed before API/worker start. Migrations serialize with a PostgreSQL advisory lock. The runner preserves historical migrations and records new versions transactionally. This is a greenfield project; SQL migrations evolve its own schema. Future upgrades should first test constraints on a restored WorkAgent database. Pin verified image digests in the deployment manifest after image scanning; public tags are provided as build baselines.

Target-host deployment, public TLS/DNS and real supplier behavior must be verified before release; local fixtures are not production credential templates.

## Observe and recover execution

Check /healthz for liveness and /readyz for database readiness. Monitor worker /tmp heartbeat freshness, queue pending age, processing lease age, failed count, run error/timeout rate, login throttles, approval age and spend. `/tenant/queue` exposes scoped job metadata; managers can retry failed jobs, auditors can inspect. Retry is audited and refuses uncertain tool outcomes.

A worker claims jobs using SKIP LOCKED, heartbeats every 20 seconds and recovers leases older than two minutes. Completion and failure are fenced by worker identity/attempt number. Repeated failures enter failed-job DLQ. Run execution additionally holds a PostgreSQL advisory lock. External tools receive stable per-call idempotency keys. A crash after sending a request but before persisting its result cannot be universally resolved: the durable invocation remains started/uncertain and is not automatically repeated. Reconcile against the vendor using the idempotency key before an explicitly reviewed rerun. Never promise exactly-once external effects.

Approval decisions, queue resume and audit commit together; rejected approval is interpreted before resuming tools. Expired pending approval ends its waiting run as timeout. Cancel cannot be overwritten by engine terminal updates. Task/run acceptance is independent from execution, and the executor cannot self-accept. SSE reconnects with Last-Event-ID; the server rechecks session validity during streaming.

## Backup and restore

Stop writes/workers or take coordinated storage/database snapshots for a consistent recovery point. The scripts do not freeze a live system automatically. Keep encryption keys available in a separate protected recovery system; do not place keys in the archive.

```sh
WORKAGENT_WRITERS_QUIESCED=yes DATABASE_URL=... BACKUP_DIR=/private/offsite-staging ARTIFACT_DIR=/persistent/artifacts sh scripts/backup.sh
RESTORE_DATABASE_URL=... BACKUP_FILE=/private/offsite-staging/workagent-TIMESTAMP.dump RESTORE_ARTIFACTS_FILE=... RESTORE_ARTIFACT_DIR=... CONFIRM_EMPTY_RESTORE=yes sh scripts/restore.sh
# Database-only diagnostics require RESTORE_DATABASE_ONLY=yes; S3 recovery requires RESTORE_S3_CONFIRMED=yes after native bucket restoration.
```

Prerequisites: matching PostgreSQL16 client tools (use the server container tools; PG17 dump can include unsupported PG16 settings), tar; Python3.12+ for safe artifact extraction. Restore into a new empty database and empty artifact directory; existing tables/files are refused. Verify business rows, migration count, artifact bytes, vector queries and authenticated reads before switching traffic. S3 requires provider-native versioned backup/replication and a separate restore drill. Encrypt offsite archives and establish retention/RPO/RTO with the operator.

## Release gates

Release only after the responsible operator can verify all of the following on the intended environment:

- Frozen dependency install, engineering/browser checks, dependency and image review, and a successful hosted CI run for the release revision.
- Real model success/error/timeout behavior; signed inbound channel callbacks and explicit identity binding for any enabled channels. Saved credentials alone are insufficient.
- Target Compose build/start/migration/health lifecycle, public DNS/TLS, firewall rules, isolated secrets and restricted proxy trust.
- Real storage authorization, IAM/encryption/retention if using S3, authenticated artifact download and knowledge isolation.
- Monitoring and alert destinations, worker recovery, approval expiry, spend/quota handling and uncertain-tool reconciliation ownership.
- Consistent offsite backup and timed restore into empty targets, with business rows, artifacts and authenticated access checked against agreed RPO/RTO.

These are actionable gates, not claims that production deployment, live vendors or hosted CI have already passed.

## Bounded maintenance and storage trust

Use a dedicated process-owned local artifact root mode 0700 with no writable untrusted parent/ancestor symlinks, or a dedicated WorkAgent S3 bucket. No hostile co-writer may own local storage directories. Worker hourly cleanup deletes at most 500 rows per expiry table and scans 500 objects per pass; RETENTION_DAYS defaults 90 (7–3650). Referenced business files, run idempotency keys, ledgers and audits are retained. Unknown object prefixes require operator reconciliation. Quota is a UTC calendar month and resets under transaction before new run allocation.

SSE supports at most 3 concurrent connections per identity and 100 per API process. It rechecks live sessions/project membership every 500ms, returns 200 events per poll, and closes stalled writers after 5s. Operate one API replica; move limiting/poll notifications to shared infrastructure before horizontal scaling.

For unknown tool outcomes, stop automatic retries and do not invent a new call ID to evade the ledger. Compare stable idempotency key/request hash with vendor records, record investigation in audit/incident records, and only after confirmed reconciliation create an explicit new task attempt or reviewed safe retry. No API clears uncertain ledgers automatically. A failed safe DLQ run resets to queued with checkpoint/results preserved; succeeded/canceled/timeout runs require a new attempt.

Before consistent backup, block ingress then stop API/channel/worker writers; verify no provisioning/import jobs run. Set WORKAGENT_WRITERS_QUIESCED=yes only after this check. Keep them stopped through DB and artifact capture; resume only after the entire backup set is durable. S3 backup requires a version manifest from a coordinated provider snapshot and matching restoration. Recovery scripts fail on nonempty targets and unsafe archives; DB restore is transactional. Verify referenced artifact bytes and authenticated access before traffic switches.
