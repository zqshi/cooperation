ALTER TABLE org ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived'));
ALTER TABLE org ADD COLUMN status_reason text NOT NULL DEFAULT '';
ALTER TABLE org ADD COLUMN status_changed_at timestamptz;
CREATE INDEX idx_org_status ON org(status);
