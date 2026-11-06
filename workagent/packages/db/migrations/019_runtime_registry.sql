CREATE TABLE runtime_image (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, name text NOT NULL UNIQUE,
 image_ref text NOT NULL, kind text NOT NULL CHECK(kind IN ('agent','tool','browser')),
 description text NOT NULL DEFAULT '', enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE runtime_profile (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, name text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN ('spec','network','config','toggle')),
 cpu_millis integer NOT NULL DEFAULT 1000 CHECK(cpu_millis BETWEEN 100 AND 64000),
 memory_mb integer NOT NULL DEFAULT 1024 CHECK(memory_mb BETWEEN 128 AND 131072),
 timeout_seconds integer NOT NULL DEFAULT 300 CHECK(timeout_seconds BETWEEN 1 AND 3600),
 allowed_hosts text[] NOT NULL DEFAULT '{}', environment jsonb NOT NULL DEFAULT '{}',
 enabled boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
