-- Additive migration: no changes to business runs or the historical initial migration.
CREATE TABLE project (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
 description text NOT NULL DEFAULT '',
 created_by text NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (org_id,id)
);
CREATE TABLE project_member (
 org_id text NOT NULL,
 project_id text NOT NULL,
 user_id text NOT NULL,
 role text NOT NULL CHECK (role IN ('manager','contributor','viewer')),
 PRIMARY KEY (project_id,user_id),
 FOREIGN KEY (org_id,project_id) REFERENCES project(org_id,id) ON DELETE CASCADE,
 FOREIGN KEY (org_id,user_id) REFERENCES membership(org_id,user_id) ON DELETE CASCADE
);
CREATE INDEX idx_project_org ON project(org_id,created_at DESC);
CREATE INDEX idx_project_member_user ON project_member(org_id,user_id);
