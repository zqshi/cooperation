-- WorkAgent schema evolution: preserve completed assignee provenance after membership removal.
ALTER TABLE project_task DROP CONSTRAINT project_task_project_id_assignee_id_fkey;
ALTER TABLE project_task ADD CONSTRAINT task_assignee_identity FOREIGN KEY(assignee_id) REFERENCES app_user(id);
ALTER TABLE quota ADD COLUMN period_start timestamptz NOT NULL DEFAULT (date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
ALTER TABLE channel_conversation DROP CONSTRAINT channel_conversation_account_id_external_conversation_id_key;
ALTER TABLE channel_conversation ADD UNIQUE(account_id,external_conversation_id,external_user_id);
ALTER TABLE eval_run ADD COLUMN snapshot jsonb;
ALTER TABLE eval_run ADD COLUMN revision_checksum text;
