CREATE TABLE project_task (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 org_id text NOT NULL,
 project_id text NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
 description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','review','done')),
 assignee_id text,
 agent_id text REFERENCES agent(id),
 created_by text NOT NULL REFERENCES app_user(id),
 submitted_by text REFERENCES app_user(id),
 accepted_by text REFERENCES app_user(id),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,project_id,id),
 FOREIGN KEY(org_id,project_id) REFERENCES project(org_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,assignee_id) REFERENCES project_member(project_id,user_id),
 CHECK(accepted_by IS NULL OR (accepted_by IS DISTINCT FROM submitted_by AND accepted_by IS DISTINCT FROM assignee_id))
);
CREATE TABLE project_task_attempt (
 org_id text NOT NULL,
 project_id text NOT NULL,
 task_id text NOT NULL,
 attempt integer NOT NULL,
 run_id text NOT NULL UNIQUE REFERENCES agent_run(id),
 created_by text NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(task_id,attempt),
 FOREIGN KEY(org_id,project_id,task_id) REFERENCES project_task(org_id,project_id,id) ON DELETE CASCADE
);
CREATE TABLE project_task_reference (
 org_id text NOT NULL,
 project_id text NOT NULL,
 task_id text NOT NULL,
 artifact_id text NOT NULL REFERENCES artifact(id),
 created_by text NOT NULL REFERENCES app_user(id),
 PRIMARY KEY(task_id,artifact_id),
 FOREIGN KEY(org_id,project_id,task_id) REFERENCES project_task(org_id,project_id,id) ON DELETE CASCADE
);
CREATE INDEX project_task_board ON project_task(org_id,project_id,status);
