/**
 * origin.js — the address THIS deployment answers on
 *
 * WHY THIS IS NOT `new URL(request.url).origin`
 * ---------------------------------------------------------------------------
 * Because that lies under `wrangler dev`. Measured 2026-08-16 and written down
 * twice — worker.js:147 and embed.js:200 — BOTH url.hostname and the Host
 * header come back as whatever route is in wrangler.toml, whatever address the
 * browser actually asked for. The Pi serves dev.thauma.one through a tunnel
 * and the Worker inside it believes it is staging.
 *
 * Every outbound email was built on that lie. An invite sent from the dev
 * console told the recipient to go and confirm their account on staging: a
 * different database, a different signing salt, so the link could not work
 * even in principle. The band image in the header was requested from staging
 * too, where the file 404s, which is why the header arrived empty. One wrong
 * hostname, two symptoms that look unrelated.
 *
 * SO IT IS CONFIGURED, NOT DETECTED. Each environment states its own address
 * in wrangler.toml. A deployment cannot work out where it lives, but a person
 * writing the config always knows.
 *
 * NOT THE SAME THING AS embed.js's `publicOrigin`, and they must not be
 * merged. That one answers "which API should a partner's code call", and the
 * answer is always the LIVE site no matter where the guide was downloaded
 * from. This one answers "where am I", and the answer differs per deployment.
 * Same shape, opposite intent.
 *
 * THE FALLBACK IS THE REQUEST, not the live site. If SITE_ORIGIN is missing
 * the request origin is right in production and merely wrong-but-local under
 * wrangler dev — whereas defaulting to thauma.one would point dev's test
 * invitations at the real site, which is the worst outcome of the three.
 */
export function siteOrigin(env, request) {
  const configured = String((env && env.SITE_ORIGIN) || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}
