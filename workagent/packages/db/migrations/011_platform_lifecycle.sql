-- Operational metadata only. No private project content or credentials.
ALTER TABLE platform_audit ADD COLUMN org_id text REFERENCES org(id);
ALTER TABLE platform_audit ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
CREATE INDEX platform_audit_recent ON platform_audit(created_at DESC,id);
