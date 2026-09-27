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
 *   admin           runs the organization: accounts, partners, publishing
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
  /* What this ministry publishes (mockup board 7; was "Ministry" — these four
     things are its updates). */
  { slug: "updates", url: "/staff/updates/", label: "Updates",
    roles: ["staff", "partner", "communications"] },
  /* Who hears from you (mockup board 10; was "Mailing"). */
  { slug: "mail", url: "/staff/mail/", label: "Mail",
    roles: ["staff", "partner", "communications"] },
  /* Everything that goes on other websites (mockup board 9): the four
     widgets, the sign-up form, the contact form, their colors and code. */
  { slug: "sharing", url: "/staff/sharing/", label: "Sharing",
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
  /* UNDER YOUR NAME, not in the row (mockup board 1, built 2026-09-27).
     Settings is about you and Activity is a record you look back at — neither
     is a job you come to the console to do, and the row is for jobs. `menu`
     puts a page in the name menu instead; the roles still decide who sees
     it, the same way. */
  { slug: "activity", url: "/staff/activity/", label: "Activity",
    roles: ["staff", "partner"], menu: true },
  { slug: "settings", url: "/staff/settings/", label: "Settings",
    roles: ["staff", "partner"], menu: true },
];

/** The organization's console. */
const admin = [
  { slug: "index", url: "/admin/", label: "Overview",
    roles: ["admin", "board", "communications"] },
  /* Accounts and what they may do. Administrators only — this is the page
     that can hand out the roles every other line here reads. */
  { slug: "users", url: "/admin/users/", label: "People", roles: ["admin"] },
  { slug: "partners", url: "/admin/partners/", label: "Partners",
    roles: ["admin", "board"] },
  /* THE PUBLIC SITE, IN ONE PLACE (mockup board 13, built 2026-09-27).
     Content, Library, Site and Publish were four links doing one job —
     change the public site, then publish it. Now one link, with its own
     side list (`website` below) and a publish bar along the foot of every
     screen in it, so publishing is never a page you have to remember. */
  { slug: "website", url: "/admin/website/", label: "Website",
    roles: ["admin", "communications"] },
  { slug: "activity", url: "/admin/activity/", label: "Activity",
    roles: ["admin", "board"] },
];

/**
 * Which ROW appears at all, derived rather than listed — a row with nothing in
 * it for you is a row you do not get. So the two-row header is not a case to
 * handle, it is what happens when both rows have something.
 */
const inRow = (pages) => pages.filter((p) => !p.menu);
const rowRoles = (pages) => [...new Set(inRow(pages).flatMap((p) => p.roles || []))];

/* The Website area's own side list. The Website is ONE page with a panel per
   tab (Chase, 2026-09-27: "have all tabs load all the content at once. Then
   nav through the tabs can happen at once"): src/adminarea/website.njk writes
   it at every tab's address, each opening on its own tab, so a reload or a
   bookmark comes back to where you were. `page` is the tab's i18n page key
   (adm.page.<page>.heading); `heading` is its English heading. A tab is never
   listed before its page exists. */
const website = [
  { tab: "pages", url: "/admin/website/", label: "Pages",
    page: "content", heading: "The site's <b>words</b>" },
  /* Thauma's own forms and mail (Chase, 2026-09-27): what happens to what a
     visitor sends, and Thauma's lists — admin work, so off the staff pages. */
  { tab: "forms", url: "/admin/website/forms/", label: "Forms",
    page: "forms", heading: "Thauma's <b>forms</b>" },
  { tab: "mail", url: "/admin/website/mail/", label: "Mail",
    page: "orgmail", heading: "Who hears from <b>Thauma</b>" },
  { tab: "resources", url: "/admin/website/resources/", label: "Resources",
    page: "resources", heading: "The site's <b>resources</b>" },
  { tab: "events", url: "/admin/website/events/", label: "Events",
    page: "events", heading: "What is <b>coming up</b>" },
  { tab: "photos", url: "/admin/website/photos/", label: "Photos",
    page: "photos", heading: "Frame what <b>matters</b>" },
  { tab: "settings", url: "/admin/website/settings/", label: "Settings",
    page: "site", heading: "Site <b>settings</b>" },
];

module.exports = {
  staff,
  admin,
  /* Emitted into the page so the browser filters against the same lists the
     build rendered, rather than a second copy that can disagree. */
  rows: { staff: rowRoles(staff), admin: rowRoles(admin) },
  /* What each row shows, and what goes under the name instead. */
  row: { staff: inRow(staff), admin: inRow(admin) },
  menu: [...staff, ...admin].filter((p) => p.menu),
  website,
};
