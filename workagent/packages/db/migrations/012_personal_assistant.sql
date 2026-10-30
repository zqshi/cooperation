-- Personal assistants are new resources, never converted enterprise agents.
ALTER TABLE agent ADD COLUMN personal_owner_id text REFERENCES app_user(id);
ALTER TABLE agent ADD COLUMN personal_profile jsonb;
CREATE UNIQUE INDEX agent_one_personal_primary ON agent(org_id,personal_owner_id) WHERE personal_owner_id IS NOT NULL;
ALTER TABLE agent ADD CONSTRAINT personal_agent_private CHECK (personal_owner_id IS NULL OR (visibility='private' AND created_by=personal_owner_id AND personal_profile IS NOT NULL));
CREATE FUNCTION preserve_personal_owner() RETURNS trigger AS $$
BEGIN
 IF OLD.personal_owner_id IS DISTINCT FROM NEW.personal_owner_id THEN
  RAISE EXCEPTION 'Personal ownership is immutable';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER agent_personal_owner BEFORE UPDATE ON agent FOR EACH ROW EXECUTE FUNCTION preserve_personal_owner();
-- Defense in depth: no alternate builder path may attach enterprise assets to a personal revision.
CREATE FUNCTION enforce_personal_revision() RETURNS trigger AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM agent WHERE id=NEW.agent_id AND personal_owner_id IS NOT NULL) THEN
  IF NEW.definition->>'visibility' IS DISTINCT FROM 'private'
   OR NEW.definition#>>'{approval,mode}' IS DISTINCT FROM 'always'
   OR NEW.definition#>'{tools,skillIds}' IS DISTINCT FROM '[]'::jsonb
   OR NEW.definition#>'{tools,connectorIds}' IS DISTINCT FROM '[]'::jsonb
   OR NEW.definition->'knowledge' IS DISTINCT FROM '[]'::jsonb
   OR NEW.definition#>>'{memory,enabled}' IS DISTINCT FROM 'false'
   OR (NEW.bootstrap IS NOT NULL AND (NEW.bootstrap->'definition' IS DISTINCT FROM NEW.definition OR NEW.bootstrap#>'{toolPlan,tools}' IS DISTINCT FROM '[]'::jsonb))
   OR (NEW.tool_plan IS NOT NULL AND NEW.tool_plan->'tools' IS DISTINCT FROM '[]'::jsonb)
  THEN RAISE EXCEPTION 'Personal text-only release policy violation'; END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER personal_revision_policy BEFORE INSERT OR UPDATE ON agent_revision FOR EACH ROW EXECUTE FUNCTION enforce_personal_revision();
