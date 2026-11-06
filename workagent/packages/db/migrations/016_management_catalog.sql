CREATE TABLE platform_dictionary (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 category text NOT NULL, code text NOT NULL, label text NOT NULL,
 description text NOT NULL DEFAULT '', sort_order integer NOT NULL DEFAULT 0,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(category,code)
);
CREATE TABLE managed_content (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 org_id text NOT NULL REFERENCES org(id), title text NOT NULL, slug text NOT NULL,
 body text NOT NULL DEFAULT '', summary text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 version integer NOT NULL DEFAULT 1, created_by text NOT NULL REFERENCES app_user(id),
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,slug)
);
CREATE INDEX idx_managed_content_org ON managed_content(org_id,status,updated_at DESC);
CREATE TABLE managed_content_revision (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 content_id text NOT NULL REFERENCES managed_content(id), org_id text NOT NULL REFERENCES org(id),
 version integer NOT NULL, title text NOT NULL, body text NOT NULL, summary text NOT NULL,
 status text NOT NULL, actor_id text NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(content_id,version)
);
