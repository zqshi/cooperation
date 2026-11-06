ALTER TABLE session ADD COLUMN user_agent text;
ALTER TABLE session ADD COLUMN ip_address inet;

CREATE INDEX idx_agent_revision_personal_growth
  ON agent_revision(agent_id, created_at DESC);
