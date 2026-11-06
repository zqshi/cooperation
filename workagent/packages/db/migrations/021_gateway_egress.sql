CREATE TABLE gateway_upstream (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,hostname text NOT NULL UNIQUE,
 purpose text NOT NULL CHECK(purpose IN ('tool','model','both')),
 reason text NOT NULL,enabled boolean NOT NULL DEFAULT true,
 created_by text REFERENCES app_user(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
