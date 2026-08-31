/**
 * consoleNav.js — who sees which page in the console, in one place
 *
 * THE HEADER IS THE SAME FOR EVERYONE UNTIL IT IS NOT. Both consoles used to
 * list every page and rely on each endpoint refusing whoever should not be
 * there. That is safe and reads badly: a board member met six links, five of
 * which answered "limited to administrators", which teaches people that
 * refusals are noise rather than information.
 *
 * So the nav is filtered to what the account can actually use. THIS IS
 * PRESENTATION ONLY — every endpoint still checks the role itself, and must,
 * because a hidden link is not a closed door. Nothing here grants anything.
 *
 * WHY A DATA FILE. It is edited far more often than the layouts are, and it is
 * the thing somebody will want to change without reading nunjucks. One list,
 * two consoles, and adding a page means adding a line here.
 *
 * ROLES, as the schema allows them (see the CHECK on user_roles in
 * db/migrations/0015_mailing.sql):
 *
 *   admin           runs the organisation: accounts, partners, publishing
 *   staff           works inside a ministry's own console
 *   partner         the ministry themselves
 *   board           oversight — sees what is happening, changes nothing
 *   communications  writes and sends: the site's words, and its mailings
 *
 * A page with NO roles listed is open to anyone who reached the console at
 * all, which Cloudflare Access has already decided.
 */

/** The ministry's own console. */
const staff = [
  { slug: "index", url: "/staff/", label: "Dashboard",
    roles: ["staff", "partner", "communications"] },
  { slug: "ministry", url: "/staff/ministry/", label: "Ministry",
    roles: ["staff", "partner", "communications"] },
  { slug: "mailing", url: "/staff/mailing/", label: "Mailing",
    roles: ["staff", "partner", "communications"] },
  /* Supporter names, giving history and stewardship notes. The narrowest
     thing in the console and the only one holding other people's private
     details, so communications does not get it by being able to write. */
  { slug: "stewardship", url: "/staff/stewardship/", label: "Stewardship",
    roles: ["staff", "partner"] },
  { slug: "directory", url: "/staff/directory/", label: "Directory",
    roles: ["staff", "partner", "communications"] },
  { slug: "resources", url: "/staff/resources/", label: "Resources",
    roles: ["staff", "partner", "communications"] },
  { slug: "activity", url: "/staff/activity/", label: "Activity",
    roles: ["staff", "partner"] },
  { slug: "settings", url: "/staff/settings/", label: "Settings",
    roles: ["staff", "partner"] },
];

/** The organisation's console. */
const admin = [
  { slug: "index", url: "/admin/", label: "Overview",
    roles: ["admin", "board", "communications"] },
  /* Accounts and what they may do. Administrators only — this is the page
     that can hand out the roles every other line here reads. */
  { slug: "users", url: "/admin/users/", label: "People", roles: ["admin"] },
  { slug: "partners", url: "/admin/partners/", label: "Partners",
    roles: ["admin", "board"] },
  /* THE SITE EDITOR'S PAGES. Content is the words, Site is the settings around
     them, Publish moves both. Somebody who writes for the site needs all three
     and none of the account management above. */
  { slug: "content", url: "/admin/content/", label: "Content",
    roles: ["admin", "communications"] },
  { slug: "site", url: "/admin/site/", label: "Site",
    roles: ["admin", "communications"] },
  { slug: "publish", url: "/admin/publish/", label: "Publish",
    roles: ["admin", "communications"] },
  { slug: "activity", url: "/admin/activity/", label: "Activity",
    roles: ["admin", "board"] },
];

/**
 * Which ROW appears at all, derived rather than listed — a row with nothing in
 * it for you is a row you do not get. So the two-row header is not a case to
 * handle, it is what happens when both rows have something.
 */
const rowRoles = (pages) => [...new Set(pages.flatMap((p) => p.roles || []))];

module.exports = {
  staff,
  admin,
  /* Emitted into the page so the browser filters against the same lists the
     build rendered, rather than a second copy that can disagree. */
  rows: { staff: rowRoles(staff), admin: rowRoles(admin) },
};
