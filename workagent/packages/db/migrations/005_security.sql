CREATE TABLE channel_replay (
 account_id text NOT NULL REFERENCES channel_account(id) ON DELETE CASCADE,
 signature_hash text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,signature_hash)
);
CREATE INDEX channel_replay_expiry ON channel_replay(received_at);
-- Composite identities reject cross-enterprise references even outside the API.
ALTER TABLE agent ADD UNIQUE(org_id,id);
ALTER TABLE agent_revision ADD UNIQUE(agent_id,id);
ALTER TABLE conversation ADD UNIQUE(org_id,id);
ALTER TABLE agent_run ADD UNIQUE(org_id,id);
ALTER TABLE knowledge_space ADD UNIQUE(org_id,id);
ALTER TABLE channel_account ADD UNIQUE(org_id,id);
ALTER TABLE project_task ADD FOREIGN KEY(org_id,agent_id) REFERENCES agent(org_id,id);
ALTER TABLE agent_run ADD FOREIGN KEY(org_id,agent_id) REFERENCES agent(org_id,id);
ALTER TABLE agent_run ADD FOREIGN KEY(org_id,user_id) REFERENCES membership(org_id,user_id);
ALTER TABLE agent_run ADD FOREIGN KEY(org_id,conversation_id) REFERENCES conversation(org_id,id);
ALTER TABLE agent_run ADD FOREIGN KEY(agent_id,revision_id) REFERENCES agent_revision(agent_id,id);
ALTER TABLE document ADD COLUMN org_id text;
UPDATE document d SET org_id=k.org_id FROM knowledge_space k WHERE k.id=d.space_id;
ALTER TABLE document ALTER COLUMN org_id SET NOT NULL;
CREATE FUNCTION bind_document_org() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.org_id IS NULL THEN SELECT org_id INTO NEW.org_id FROM knowledge_space WHERE id=NEW.space_id; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER document_org BEFORE INSERT ON document FOR EACH ROW EXECUTE FUNCTION bind_document_org();
ALTER TABLE document ADD FOREIGN KEY(org_id,space_id) REFERENCES knowledge_space(org_id,id);
ALTER TABLE channel_account ADD FOREIGN KEY(org_id,default_agent_id) REFERENCES agent(org_id,id);
ALTER TABLE channel_binding ADD FOREIGN KEY(org_id,user_id) REFERENCES membership(org_id,user_id);
ALTER TABLE channel_binding ADD FOREIGN KEY(org_id,account_id) REFERENCES channel_account(org_id,id);
ALTER TABLE project_task_attempt ADD FOREIGN KEY(org_id,run_id) REFERENCES agent_run(org_id,id);
CREATE TABLE platform_session (
 token_hash text PRIMARY KEY,
 user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_audit (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 user_id text NOT NULL REFERENCES app_user(id),
 action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
