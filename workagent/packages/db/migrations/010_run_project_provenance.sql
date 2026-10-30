-- Immutable project provenance survives deletion of planning records/attempt associations.
ALTER TABLE agent_run ADD COLUMN project_id text;
UPDATE agent_run r SET project_id=a.project_id FROM project_task_attempt a WHERE a.run_id=r.id;
ALTER TABLE agent_run ADD FOREIGN KEY(org_id,project_id) REFERENCES project(org_id,id);
CREATE INDEX run_project_identity ON agent_run(org_id,project_id);
CREATE FUNCTION preserve_run_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN RAISE EXCEPTION 'Run project provenance is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER immutable_run_project BEFORE UPDATE ON agent_run FOR EACH ROW EXECUTE FUNCTION preserve_run_project();
