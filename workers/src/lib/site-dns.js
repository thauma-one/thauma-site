/**
 * site-dns.js — making <name>.thauma.one exist, when a site is switched on
 *
 * Chase, 2026-09-28: the address is created automatically. Two things make a
 * partner site reachable:
 *
 *   1. A Workers route, "*.thauma.one/*", on the live Worker — once, in
 *      wrangler.toml. Every partner site shares it.
 *   2. A DNS record for the name. The wildcard, *.thauma.one, covers most
 *      names and is kept in place by the live Worker's scheduled() (since
 *      2026-09-29, so an unknown name answers with Thauma's closed page
 *      rather than "does not exist"). It does NOT cover a name that has
 *      records under it — every ministry that sends email from
 *      <name>.thauma.one has send.<name> and friends — so each site also
 *      gets its own record, made here through the Cloudflare API: a proxied
 *      AAAA to 100:: (a placeholder address; the Worker answers before any
 *      origin is asked). Records stay when a site is switched off; only an
 *      old name an administrator lets go of is removed.
 *
 * Needs two secrets on the live Worker: SITE_DNS_TOKEN (a Cloudflare API
 * token allowed to edit thauma.one's DNS) and SITE_ZONE_ID (thauma.one's
 * zone id). Without them this says "pending" and changes nothing; the site
 * still works under /site/<name>/.
 */
const API = "https://api.cloudflare.com/client/v4";

export async function ensureSiteDns(env, sub, fetchImpl = fetch) {
  const domain = env.SITE_DOMAIN || "thauma.one";
  if (!env.SITE_DNS_TOKEN || !env.SITE_ZONE_ID) return { state: "pending", reason: "not set up" };
  const name = `${sub}.${domain}`;
  const headers = { Authorization: `Bearer ${env.SITE_DNS_TOKEN}`, "Content-Type": "application/json" };
  try {
    const found = await (await fetchImpl(`${API}/zones/${env.SITE_ZONE_ID}/dns_records?name=${encodeURIComponent(name)}`, { headers })).json();
    if (!found.success) return { state: (found.errors && found.errors[0] && found.errors[0].message) || "Cloudflare refused" };
    /* An address record, or an alias, already answers for the name. */
    if ((found.result || []).some((r) => ["A", "AAAA", "CNAME"].includes(r.type))) return { state: "ready" };
    const made = await (await fetchImpl(`${API}/zones/${env.SITE_ZONE_ID}/dns_records`, {
      method: "POST", headers,
      body: JSON.stringify({ type: "AAAA", name, content: "100::", proxied: true, ttl: 1, comment: "Thauma partner site" }),
    })).json();
    return made.success ? { state: "ready" }
      : { state: (made.errors && made.errors[0] && made.errors[0].message) || "Cloudflare refused" };
  } catch (err) {
    return { state: "Could not reach Cloudflare: " + err.message };
  }
}

/**
 * Taking the address down again (0045): an administrator archived or deleted
 * the site. Only the record made above is removed — found by its comment —
 * so a ministry's mail records, or anything somebody made by hand, stay.
 * With no record the name no longer reaches the Worker at all.
 */
export async function removeSiteDns(env, sub, fetchImpl = fetch) {
  const domain = env.SITE_DOMAIN || "thauma.one";
  if (!env.SITE_DNS_TOKEN || !env.SITE_ZONE_ID) return { state: "pending", reason: "not set up" };
  const name = `${sub}.${domain}`;
  const headers = { Authorization: `Bearer ${env.SITE_DNS_TOKEN}`, "Content-Type": "application/json" };
  try {
    const found = await (await fetchImpl(`${API}/zones/${env.SITE_ZONE_ID}/dns_records?name=${encodeURIComponent(name)}`, { headers })).json();
    if (!found.success) return { state: (found.errors && found.errors[0] && found.errors[0].message) || "Cloudflare refused" };
    for (const r of (found.result || []).filter((x) => x.comment === "Thauma partner site")) {
      const gone = await (await fetchImpl(`${API}/zones/${env.SITE_ZONE_ID}/dns_records/${r.id}`, { method: "DELETE", headers })).json();
      if (!gone.success) return { state: (gone.errors && gone.errors[0] && gone.errors[0].message) || "Cloudflare refused" };
    }
    return { state: "removed" };
  } catch (err) {
    return { state: "Could not reach Cloudflare: " + err.message };
  }
}
