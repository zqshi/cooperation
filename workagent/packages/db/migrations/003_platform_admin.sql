-- Explicit global authorization. No seed, role-derived grants or tenant write API.
CREATE TABLE IF NOT EXISTS platform_admin (
  user_id text PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
