CREATE TABLE tool_invocation (
 org_id text NOT NULL,
 run_id text NOT NULL,
 call_id text NOT NULL,
 request_hash text NOT NULL,
 status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','succeeded','uncertain')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,call_id),
 FOREIGN KEY(org_id,run_id) REFERENCES agent_run(org_id,id)
);
