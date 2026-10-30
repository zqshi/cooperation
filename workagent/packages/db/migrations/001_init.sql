CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS org (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'team', 'enterprise')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_org_updated ON org;
CREATE TRIGGER trg_org_updated BEFORE UPDATE ON org FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS app_user (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_app_user_updated ON app_user;
CREATE TRIGGER trg_app_user_updated BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS membership (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'builder', 'operator', 'user', 'auditor')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
DROP TRIGGER IF EXISTS trg_membership_updated ON membership;
CREATE TRIGGER trg_membership_updated BEFORE UPDATE ON membership FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_membership_user ON membership(user_id);

CREATE TABLE IF NOT EXISTS session (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);
CREATE INDEX IF NOT EXISTS idx_session_expires ON session(expires_at);

CREATE TABLE IF NOT EXISTS agent (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  current_revision_id text,
  published_version integer,
  visibility text NOT NULL DEFAULT 'org' CHECK (visibility IN ('private', 'org', 'public')),
  created_by text NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_agent_updated ON agent;
CREATE TRIGGER trg_agent_updated BEFORE UPDATE ON agent FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_agent_org ON agent(org_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_updated ON agent(org_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_revision (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  agent_id text NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  definition jsonb NOT NULL,
  tool_plan jsonb,
  bootstrap jsonb,
  changelog text NOT NULL DEFAULT '',
  created_by text NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (agent_id, version)
);
CREATE INDEX IF NOT EXISTS idx_agent_revision_agent ON agent_revision(agent_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_agent_revision_status ON agent_revision(agent_id, status);

CREATE TABLE IF NOT EXISTS skill (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  instructions text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  visibility text NOT NULL DEFAULT 'org' CHECK (visibility IN ('private', 'org', 'public')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_skill_updated ON skill;
CREATE TRIGGER trg_skill_updated BEFORE UPDATE ON skill FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_skill_org ON skill(org_id, status);

CREATE TABLE IF NOT EXISTS connector (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'http' CHECK (type IN ('http', 'mcp')),
  base_url text,
  mcp_url text,
  auth_type text NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'api_key', 'basic')),
  secret_encrypted text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled')),
  tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_connector_updated ON connector;
CREATE TRIGGER trg_connector_updated BEFORE UPDATE ON connector FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_connector_org ON connector(org_id, status);

CREATE TABLE IF NOT EXISTS knowledge_space (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  embedding_model text NOT NULL DEFAULT 'text-embedding-3-small',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_knowledge_space_updated ON knowledge_space;
CREATE TRIGGER trg_knowledge_space_updated BEFORE UPDATE ON knowledge_space FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_knowledge_space_org ON knowledge_space(org_id);

CREATE TABLE IF NOT EXISTS document (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  space_id text NOT NULL REFERENCES knowledge_space(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL DEFAULT 0,
  storage_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error text,
  chunk_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_document_space ON document(space_id, status);

CREATE TABLE IF NOT EXISTS chunk (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  document_id text NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  space_id text NOT NULL REFERENCES knowledge_space(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chunk_document ON chunk(document_id, seq);
CREATE INDEX IF NOT EXISTS idx_chunk_space ON chunk(space_id);
CREATE INDEX IF NOT EXISTS idx_chunk_embedding ON chunk USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS conversation (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  channel text NOT NULL DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_conversation_updated ON conversation;
CREATE TRIGGER trg_conversation_updated BEFORE UPDATE ON conversation FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_conversation_user ON conversation(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_agent ON conversation(agent_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS message (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  run_id text,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content text NOT NULL DEFAULT '',
  tool_name text,
  tool_call_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_conversation ON message(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS agent_run (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  revision_id text NOT NULL REFERENCES agent_revision(id),
  conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES app_user(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'canceled', 'timeout')),
  input text NOT NULL,
  output text,
  error text,
  channel text NOT NULL DEFAULT 'web',
  turns integer NOT NULL DEFAULT 0,
  tool_calls integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_agent_run_updated ON agent_run;
CREATE TRIGGER trg_agent_run_updated BEFORE UPDATE ON agent_run FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_agent_run_org ON agent_run(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_run_agent ON agent_run(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_run_user ON agent_run(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_run_status ON agent_run(status, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_run_conversation ON agent_run(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS run_step (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id text NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('model', 'tool', 'knowledge', 'approval', 'artifact', 'system')),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'skipped')),
  input jsonb,
  output jsonb,
  error text,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_run_step_run ON run_step(run_id, seq);

CREATE TABLE IF NOT EXISTS run_event (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id text NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_run_event_run ON run_event(run_id, seq);

CREATE TABLE IF NOT EXISTS artifact (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id text NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  size integer NOT NULL DEFAULT 0,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_artifact_run ON artifact(run_id, created_at);

CREATE TABLE IF NOT EXISTS approval (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id text NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  reason text NOT NULL DEFAULT '',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_by text NOT NULL REFERENCES app_user(id),
  decided_by text REFERENCES app_user(id),
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_approval_run ON approval(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_approval_status ON approval(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_pending_run ON approval(run_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  actor_id text REFERENCES app_user(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_record (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  run_id text REFERENCES agent_run(id) ON DELETE SET NULL,
  agent_id text REFERENCES agent(id) ON DELETE SET NULL,
  user_id text REFERENCES app_user(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('model', 'sandbox', 'storage', 'tool')),
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  quantity numeric(12, 3) NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_org ON usage_record(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_run ON usage_record(run_id);

CREATE TABLE IF NOT EXISTS quota (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('org', 'agent', 'user')),
  scope_id text NOT NULL,
  monthly_budget_usd numeric(12, 2) NOT NULL DEFAULT 100,
  monthly_run_limit integer NOT NULL DEFAULT 10000,
  current_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  current_runs integer NOT NULL DEFAULT 0,
  UNIQUE (org_id, scope, scope_id)
);

CREATE TABLE IF NOT EXISTS eval_dataset (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eval_dataset_agent ON eval_dataset(agent_id);

CREATE TABLE IF NOT EXISTS eval_case (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  dataset_id text NOT NULL REFERENCES eval_dataset(id) ON DELETE CASCADE,
  name text NOT NULL,
  input text NOT NULL,
  expected text,
  assertions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eval_case_dataset ON eval_case(dataset_id);

CREATE TABLE IF NOT EXISTS eval_run (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  dataset_id text NOT NULL REFERENCES eval_dataset(id) ON DELETE CASCADE,
  agent_revision_id text NOT NULL REFERENCES agent_revision(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  total integer NOT NULL DEFAULT 0,
  passed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_eval_run_dataset ON eval_run(dataset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_account (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('feishu', 'dingtalk', 'wecom', 'slack', 'mock')),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  app_id text,
  app_secret_encrypted text,
  verification_token text,
  encrypt_key text,
  default_agent_id text REFERENCES agent(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_channel_account_updated ON channel_account;
CREATE TRIGGER trg_channel_account_updated BEFORE UPDATE ON channel_account FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_channel_account_org ON channel_account(org_id, type);

CREATE TABLE IF NOT EXISTS channel_binding (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES channel_account(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  external_user_id text NOT NULL,
  external_conversation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_binding_user ON channel_binding(user_id);

CREATE TABLE IF NOT EXISTS channel_conversation (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES channel_account(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  external_conversation_id text NOT NULL,
  external_user_id text,
  conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_conversation_id)
);

CREATE TABLE IF NOT EXISTS channel_message (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES channel_account(id) ON DELETE CASCADE,
  external_message_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_message_id)
);

CREATE TABLE IF NOT EXISTS channel_event (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES channel_account(id) ON DELETE CASCADE,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_event_id)
);

CREATE TABLE IF NOT EXISTS runtime_instance (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'allocating' CHECK (status IN ('allocating', 'bootstrapping', 'ready', 'paused', 'degraded', 'failed', 'destroyed')),
  image text,
  container_id text,
  endpoint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  destroyed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_runtime_instance_run ON runtime_instance(run_id);

CREATE TABLE IF NOT EXISTS runtime_binding (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id text NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  runtime_instance_id text NOT NULL REFERENCES runtime_instance(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id)
);

CREATE TABLE IF NOT EXISTS idempotency_record (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  scope text NOT NULL,
  key text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, scope, key)
);

CREATE TABLE IF NOT EXISTS outbox_event (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_event(status, run_at);

CREATE TABLE IF NOT EXISTS memory (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  user_id text REFERENCES app_user(id) ON DELETE CASCADE,
  agent_id text REFERENCES agent(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, agent_id, key)
);
DROP TRIGGER IF EXISTS trg_memory_updated ON memory;
CREATE TRIGGER trg_memory_updated BEFORE UPDATE ON memory FOR EACH ROW EXECUTE FUNCTION set_updated_at();
