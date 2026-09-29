-- 0045_partner_site_archive.sql — archiving a partner site, and old addresses
--
-- Chase, 2026-09-29: an administrator can take a site down two ways —
-- ARCHIVE (the address is removed from Cloudflare, everything else is kept,
-- and the owner can switch it on again) or DELETE (the address and the site
-- both go; the owner can start a new one). And an address an administrator
-- changes should not simply break every link to the old one.
--
-- partner_sites.archived_at   set when archived; NULL otherwise. An archived
--                             site is also switched off.
-- partner_site_aliases        names a site used to have. A visitor to an
--                             old name is sent on to the current one (301).
--                             Removed with the site, or when an archive or a
--                             delete takes the addresses down.
--
-- Additive: one column, one table.

ALTER TABLE partner_sites ADD COLUMN archived_at TEXT;

CREATE TABLE partner_site_aliases (
  subdomain  TEXT PRIMARY KEY
             CHECK (length(subdomain) BETWEEN 2 AND 40 AND subdomain NOT GLOB '*[^a-z0-9]*'),
  partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
