-- baseline_schema_migrations.sql — adopt a database that was migrated by hand
--
-- Run ONCE, against a database whose schema is already at 0010 but which has
-- no record of how it got there. It creates the tracking table the migration
-- runner uses and marks every migration up to 0010 as applied WITHOUT running
-- them — because they have already run.
--
-- This is the one-time bootstrap. After it, the Publish page's database panel
-- is the way to apply migrations, and this file should not be needed again.
--
-- INSERT OR IGNORE, not INSERT: running this twice must not fail, and must
-- not overwrite a real applied_at with this file's placeholder date.
--
--   npx wrangler d1 execute thauma-ops --remote --env production \
--     --file=db/baseline_schema_migrations.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  applied_by TEXT,
  statements INTEGER,
  baselined  INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO schema_migrations
  (name, applied_at, applied_by, statements, baselined)
VALUES
  ('0001_init.sql',                          '2026-08-18T00:00:00Z', 'baselined by hand', NULL, 1),
  ('0002_milestones.sql',                    '2026-08-18T00:00:00Z', 'baselined by hand', NULL, 1),
  ('0003_languages.sql',                     '2026-08-18T00:00:00Z', 'baselined by hand', NULL, 1),
  ('0004_settings.sql',                      '2026-08-18T00:00:00Z', 'baselined by hand', NULL, 1),
  ('0005_directory_resources.sql',           '2026-08-18T00:00:00Z', 'baselined by hand', NULL, 1),
  ('0006_roles.sql',                         '2026-08-18T00:00:00Z', 'baselined by hand', NULL, 1),
  ('0007_partner_role.sql',                  '2026-08-18T00:00:00Z', 'baselined by hand', NULL, 1),
  ('0008_audit_survives_deletion.sql',       '2026-08-18T00:00:00Z', 'baselined by hand', NULL, 1),
  ('0009_audit_actor_is_an_address.sql',     '2026-08-18T00:00:00Z', 'baselined by hand', NULL, 1),
  ('0010_attribution_survives_a_leaver.sql', '2026-08-18T00:00:00Z', 'baselined by hand', NULL, 1);
