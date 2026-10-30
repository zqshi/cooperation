ALTER TABLE artifact ADD CONSTRAINT artifact_run_name UNIQUE(run_id,name);
CREATE TABLE run_acceptance (
 run_id text PRIMARY KEY REFERENCES agent_run(id),
 org_id text NOT NULL REFERENCES org(id),
 reviewer_id text NOT NULL REFERENCES app_user(id),
 decision text NOT NULL CHECK(decision IN ('accepted','rejected')),
 note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,run_id) REFERENCES agent_run(org_id,id)
);
