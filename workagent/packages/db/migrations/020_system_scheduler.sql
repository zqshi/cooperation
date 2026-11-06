CREATE TABLE system_schedule (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,name text NOT NULL,
 handler text NOT NULL CHECK(handler IN ('cleanup','approval-expiry','lease-recovery')),
 interval_minutes integer NOT NULL CHECK(interval_minutes BETWEEN 1 AND 525600),
 enabled boolean NOT NULL DEFAULT true,next_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE system_schedule_run (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,schedule_id text NOT NULL REFERENCES system_schedule(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','skipped')),
 trigger text NOT NULL CHECK(trigger IN ('scheduled','manual')),
 result jsonb,error text,created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz
);
CREATE UNIQUE INDEX idx_system_schedule_active ON system_schedule_run(schedule_id) WHERE status IN ('queued','running');
CREATE INDEX idx_system_schedule_runs ON system_schedule_run(schedule_id,created_at DESC);
