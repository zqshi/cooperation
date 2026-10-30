-- Schedules are private owned resources, independent of projects and planning tasks.
CREATE TABLE personal_automation (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 org_id text NOT NULL REFERENCES org(id),
 owner_id text NOT NULL REFERENCES app_user(id),
 agent_id text NOT NULL,
 title text NOT NULL,
 prompt text NOT NULL,
 timezone text NOT NULL,
 schedule jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('active','paused','completed','terminated','deleted')),
 version integer NOT NULL DEFAULT 1,
 next_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,id),
 FOREIGN KEY(org_id,owner_id) REFERENCES membership(org_id,user_id),
 FOREIGN KEY(org_id,agent_id) REFERENCES agent(org_id,id)
);
CREATE INDEX personal_automation_due ON personal_automation(next_at) WHERE status='active';
CREATE TABLE automation_occurrence (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 org_id text NOT NULL,
 automation_id text NOT NULL,
 occurrence_key text NOT NULL,
 scheduled_at timestamptz NOT NULL,
 trigger text NOT NULL CHECK(trigger IN ('scheduled','manual')),
 status text NOT NULL CHECK(status IN ('dispatched','failed','skipped')),
 run_id text,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(automation_id,occurrence_key),
 UNIQUE(run_id),
 FOREIGN KEY(org_id,automation_id) REFERENCES personal_automation(org_id,id),
 FOREIGN KEY(org_id,run_id) REFERENCES agent_run(org_id,id)
);
-- Attachments cannot turn an automation into shared/cross-user execution, even via SQL.
CREATE FUNCTION enforce_automation_identity() RETURNS trigger AS $$
BEGIN
 IF TG_TABLE_NAME='personal_automation' THEN
  IF TG_OP='UPDATE' AND (OLD.org_id,OLD.owner_id,OLD.agent_id) IS DISTINCT FROM (NEW.org_id,NEW.owner_id,NEW.agent_id) THEN RAISE EXCEPTION 'Immutable automation ownership'; END IF;
  IF NOT EXISTS(SELECT 1 FROM agent WHERE id=NEW.agent_id AND org_id=NEW.org_id AND personal_owner_id=NEW.owner_id) THEN RAISE EXCEPTION 'Owned personal Agent required'; END IF;
 ELSE
  IF NEW.run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agent_run r JOIN personal_automation a ON a.id=NEW.automation_id AND a.org_id=NEW.org_id WHERE r.id=NEW.run_id AND r.org_id=a.org_id AND r.user_id=a.owner_id AND r.agent_id=a.agent_id AND r.project_id IS NULL) THEN RAISE EXCEPTION 'Automation run identity mismatch'; END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER automation_identity BEFORE INSERT OR UPDATE ON personal_automation FOR EACH ROW EXECUTE FUNCTION enforce_automation_identity();
CREATE TRIGGER occurrence_identity BEFORE INSERT OR UPDATE ON automation_occurrence FOR EACH ROW EXECUTE FUNCTION enforce_automation_identity();
