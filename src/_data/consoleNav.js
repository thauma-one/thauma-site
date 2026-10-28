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
  { slug: "index", url: "/staff/", label: "Home",
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
  /* THE MINISTRY'S OWN WEBSITE (0044): <name>.thauma.one, arranged here —
     "Site Creator", last in the row (Chase, 2026-09-29; it was "Website",
     after Sharing). The address stays /staff/website/, so nothing that links
     to it breaks. Everyone on the team may look; the owner, and whoever the
     owner allows, may change it — the endpoint decides that, not this line. */
  { slug: "website", url: "/staff/website/", label: "Site Creator",
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
  /* What each Publish changed, by page (2026-10-13; workers/src/changes.js).
     Everyone: each sees only the pages they have. */
  { slug: "changes", url: "/staff/changes/", label: "What's New",
    roles: ["staff", "partner", "admin", "board", "communications"], menu: true },
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
  /* THE PUBLIC SITE, ONE LINK (Chase, 2026-10-21: "those headers you added
     live under the Website nav, not get added to the Admin nav bar"). Its
     work is four parts with the staff console's names — Updates, Mail,
     Sharing and Site Creator — in a row of their own under Website's heading
     (`website` below), each with its own tabs (`areas`). */
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

/* EACH AREA'S TABS. An area is ONE page with a panel per tab (Chase,
   2026-09-27: "have all tabs load all the content at once. Then nav through
   the tabs can happen at once"): src/adminarea/areas.njk writes it at every
   tab's address, each opening on its own tab, so a reload or a bookmark
   comes back to where you were. Only the area's own tabs load with it, so a
   page asks for what it shows and no more.

   The four areas are Website's (Chase, 2026-10-21): the admin header shows
   Website, and the areas are the row under its heading (`website`), the
   staff header's names in the staff header's order.

   A tab's markup is src/_includes/website/<tab>.njk. The area's heading
   stays as you move between its tabs, as on the staff pages. A tab is
   never listed before its page exists. `side` lays the tabs out as the
   staff Site Creator does (a list down the left); otherwise they are the
   staff Updates page's row, and an area of one tab shows none. `publish`
   puts the publish bar along its foot (what it changes waits for Publish);
   `scripts` are what its tabs run, the shell last. */
const areas = {
  updates: { label: "Updates", heading: "What the Site <b>Publishes</b>", publish: true,
    scripts: ["admin-library", "admin-publish", "admin-dbsync", "admin-website"], tabs: [
    { tab: "events", url: "/admin/website/updates/", label: "Events" },
    { tab: "resources", url: "/admin/website/updates/resources/", label: "Resources" },
  ] },
  /* Thauma's own mail (Chase, 2026-09-27): Thauma's lists, admin work, so
     off the staff pages. */
  mail: { label: "Mail", heading: "Who Hears from <b>Thauma</b>",
    scripts: ["staff-mailing", "admin-website"], tabs: [
    { tab: "mail", url: "/admin/website/mail/", label: "Mail" },
  ] },
  /* What of Thauma's appears on other websites, as staff Sharing (2026-10-27):
     Events, Resources and the two forms — and what happens to what a visitor
     sends: where it goes, the reasons, the lists on the sign-up form. */
  sharing: { label: "Sharing", heading: "What Appears on <b>Other Websites</b>",
    scripts: ["admin-forms", "admin-website"], tabs: [
    { tab: "forms", url: "/admin/website/sharing/", label: "Forms" },
  ] },
  /* THE SITE CREATOR, as a ministry's own is laid out (Chase, 2026-10-20,
     and 2026-10-21: "make sure the Site Creator of staff and the Site
     Creator of Admin Website look and feel the same"): its tabs down the
     left in the staff one's order — the menu, the pages, the links, the
     footer — and the page as it will look on the right. It keeps Website's
     own address, so every old link to Pages still lands on Pages. */
  creator: { label: "Site Creator", heading: "Site <b>Creator</b>", side: true, publish: true,
    scripts: ["site-sections", "admin-content", "admin-photos", "admin-site", "admin-links", "admin-arcade",
              "admin-publish", "admin-dbsync", "admin-website"], tabs: [
    { tab: "pages", url: "/admin/website/", label: "Pages" },
    /* The header (Chase, 2026-10-21: "should we have the footer and header
       editor"): the menu's pages in their order and what each is called. */
    { tab: "navigation", url: "/admin/website/navigation/", label: "Navigation" },
    /* The footer's social and own links (2026-10-07), as a partner site's
       Links tab has them. Saves at once, like Settings. */
    { tab: "links", url: "/admin/website/links/", label: "Links" },
    /* What the footer says, and what is in it. */
    { tab: "footer", url: "/admin/website/footer/", label: "Footer" },
    { tab: "photos", url: "/admin/website/photos/", label: "Photos" },
    /* The hidden arcade's control room (Chase, 2026-10-06): games open or
       out of order, the high scores, blocked names. Saves at once. */
    { tab: "arcade", url: "/admin/website/arcade/", label: "Arcade" },
    /* How each page shows in a search and when shared (Chase, 2026-10-20:
       "move all meta options to its own advanced tab"). */
    /* Every language, the translator's file and reading the words again
       (Chase, 2026-10-27: they made Pages unlike the staff Site Creator's;
       "repopulating some things in a new side tab"). */
    { tab: "languages", url: "/admin/website/languages/", label: "Languages" },
    { tab: "advanced", url: "/admin/website/advanced/", label: "Advanced" },
    { tab: "settings", url: "/admin/website/settings/", label: "Settings" },
  ] },
};
/* Website's own row: each area, at its first tab's address. */
const website = Object.entries(areas).map(([area, a]) => ({ area, label: a.label, url: a.tabs[0].url }));
/* Every tab of every area, one per address, for the pages to be written. */
const areaTabs = Object.entries(areas).flatMap(([area, a]) =>
  a.tabs.map((t) => ({ ...t, area, heading: a.heading, areaLabel: a.label })));

module.exports = {
  staff,
  admin,
  /* Emitted into the page so the browser filters against the same lists the
     build rendered, rather than a second copy that can disagree. */
  rows: { staff: rowRoles(staff), admin: rowRoles(admin) },
  /* What each row shows, and what goes under the name instead. */
  row: { staff: inRow(staff), admin: inRow(admin) },
  menu: [...staff, ...admin].filter((p) => p.menu),
  areas,
  website,
  areaTabs,
};
