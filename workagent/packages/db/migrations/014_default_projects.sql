-- Real private defaults; historical run provenance is deliberately untouched.
ALTER TABLE project ADD COLUMN is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX project_default_owner ON project(org_id,created_by) WHERE is_default;
CREATE FUNCTION protect_default_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.is_default THEN RAISE EXCEPTION 'Default project is immutable'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.is_default OR NEW.is_default THEN
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
   RAISE EXCEPTION 'Default project is immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER default_project_immutable BEFORE UPDATE OR DELETE ON project
 FOR EACH ROW EXECUTE FUNCTION protect_default_project();
CREATE FUNCTION protect_default_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p project; old_default boolean;
BEGIN
 IF TG_OP!='INSERT' THEN
  SELECT is_default INTO old_default FROM project WHERE org_id=OLD.org_id AND id=OLD.project_id FOR UPDATE;
  IF old_default THEN RAISE EXCEPTION 'Default owner membership is immutable'; END IF;
 END IF;
 IF TG_OP!='DELETE' THEN
  SELECT * INTO p FROM project WHERE org_id=NEW.org_id AND id=NEW.project_id FOR UPDATE;
  IF p.is_default AND (NEW.user_id<>p.created_by OR NEW.role<>'manager') THEN
   RAISE EXCEPTION 'Default project cannot be shared';
  END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER default_project_members BEFORE INSERT OR UPDATE OR DELETE ON project_member
 FOR EACH ROW EXECUTE FUNCTION protect_default_membership();
