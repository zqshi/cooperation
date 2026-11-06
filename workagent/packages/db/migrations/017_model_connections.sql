CREATE TABLE model_connection (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 org_id text NOT NULL REFERENCES org(id), name text NOT NULL, model text NOT NULL,
 base_url text NOT NULL, api_key_encrypted text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, is_default boolean NOT NULL DEFAULT false,
 last_checked_at timestamptz, last_check_ok boolean,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,name), UNIQUE(org_id,model)
);
CREATE UNIQUE INDEX idx_model_default ON model_connection(org_id) WHERE is_default AND enabled;
