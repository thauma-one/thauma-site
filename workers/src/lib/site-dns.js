/**
 * site-dns.js — making <name>.thauma.one exist, when a site is switched on
 *
 * Chase, 2026-09-28: the address is created automatically. Two things make a
 * partner site reachable:
 *
 *   1. A Workers route, "*.thauma.one/*", on the live Worker — once, in
 *      wrangler.toml. Every partner site shares it.
 *   2. A DNS record for the name. A wildcard record would cover most names,
 *      but NOT one that already has records of its own — and every ministry
 *      that sends email from <name>.thauma.one has mail records there. So each
 *      site gets its own record, made here through the Cloudflare API: a
 *      proxied AAAA to 100:: (a placeholder address; the Worker answers
 *      before any origin is asked).
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
