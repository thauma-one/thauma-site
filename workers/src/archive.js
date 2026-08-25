/**
 * archive.js — past newsletters on the web
 *
 *   /archive/<partner>/<list>            what has been sent
 *   /archive/<partner>/<list>/<slug>     one of them
 *
 * The footer link in every mailing points here, and it earns its place twice:
 * somebody whose client mangled the email can read it properly, and somebody
 * deciding whether to subscribe can see what they would be getting. The second
 * is the reason chaseroush.com has one.
 *
 * ONLY LISTS MARKED PUBLIC, and the flag is on the LIST. Newsletters are meant
 * to be read; prayer updates name people and are not. Making it a per-mailing
 * choice would mean one forgetful moment publishes a prayer request naming
 * somebody — a decision made once, calmly, is safer than the same decision
 * made in a hurry every week.
 *
 * ONLY 'sent'. A draft is not a thing anybody has agreed to publish.
 *
 * THE BODY IS RE-RENDERED, not stored as a page. It comes from the same
 * sanitised HTML the email was built from, through the same renderer, so the
 * archive cannot drift from what landed in the inbox — and a fix to the
 * renderer reaches every past mailing at once.
 */
import { createDb } from "./lib/db.js";
import { render, escapeHtml } from "./lib/newsletter.js";

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // Short, because a newly sent mailing should appear promptly, and these are
  // read by people following a link from an email they just received.
  "Cache-Control": "public, max-age=300",
};

const notFound = () => new Response(
  `<!doctype html><meta charset="utf-8"><title>Not found</title>
   <p style="font:16px system-ui;padding:40px">There is nothing here.</p>`,
  { status: 404, headers: { ...HEADERS, "Cache-Control": "no-store" } });

function when(iso) {
  const d = new Date(iso || "");
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
}

function indexPage(rows, partnerSlug, listSlug) {
  const items = rows.map((m) => (
    `<li><a href="/archive/${encodeURIComponent(partnerSlug)}/${encodeURIComponent(listSlug)}/` +
    `${encodeURIComponent(m.slug)}">${escapeHtml(m.subject)}</a>` +
    `<span>${escapeHtml(when(m.finished_at))}</span>` +
    (m.preheader ? `<p>${escapeHtml(m.preheader)}</p>` : "") + "</li>"
  )).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Past updates</title>
<style>
 :root{color-scheme:light dark;--bg:#f4f5f8;--card:#fff;--ink:#1a1a22;--dim:#5c5c6b;--line:#e6e6ee}
 @media(prefers-color-scheme:dark){
   :root{--bg:#15151c;--card:#1c1c25;--ink:#f2f2f7;--dim:#9a9aad;--line:#2a2a36}}
 body{margin:0;background:var(--bg);color:var(--ink);padding:40px 16px;
   font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
 main{max-width:600px;margin:0 auto}
 h1{font:700 27px/1.25 Georgia,Cambria,'Times New Roman',serif;margin:0 0 24px}
 ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px}
 li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 22px}
 li a{font-weight:600;color:inherit;text-decoration:none;font-size:17px}
 li a:hover{text-decoration:underline}
 li span{display:block;color:var(--dim);font-size:12.5px;margin-top:4px}
 li p{margin:8px 0 0;color:var(--dim);font-size:14.5px}
 .empty{color:var(--dim)}
</style></head>
<body><main><h1>Past updates</h1>
${items ? `<ul>${items}</ul>` : '<p class="empty">Nothing has been sent yet.</p>'}
</main></body></html>`;
}

export default {
  async fetch(request, env, partnerSlug, listSlug, slug) {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
    }
    if (!env.DB) return notFound();
    const db = createDb(env.DB);

    if (!slug) {
      const rows = await db.query("public_archive_for_list",
        { partner_slug: partnerSlug, list_slug: listSlug });
      /* An empty archive and a list that is not public are the SAME page.
         Telling them apart would report whether a ministry runs a list it has
         chosen not to publish. */
      return new Response(indexPage(rows, partnerSlug, listSlug), { headers: HEADERS });
    }

    const m = await db.queryOne("public_archive_one",
      { partner_slug: partnerSlug, list_slug: listSlug, slug });
    if (!m) return notFound();

    /* Rendered through the SAME function the email used, so the page cannot
       drift from the inbox. No unsubscribe link: this is a web page, and the
       reader may never have been subscribed at all. */
    const html = render(m.body_html || "", {
      subject: m.subject,
      preheader: null,
      fromName: m.from_name || m.display_name,
      listName: m.list_name,
      accent: m.embed_accent,
      mode: m.embed_theme === "dark" ? "dark" : "light",
    });
    return new Response(html, { headers: HEADERS });
  },
};
