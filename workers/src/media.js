/**
 * media — uploaded files, in R2 rather than in git
 *
 *   PUT  /api/admin/media   body: the image bytes, ?for=<user_id>&kind=photo
 *   GET  /media/<key>       serves it back, cached
 *
 * WHY NOT GIT
 * ---------------------------------------------------------------------------
 * A photo committed to a repository is in every clone forever, and getting one
 * back out means rewriting history — which is not a thing to ask of somebody
 * who is not a full-time engineer. Text that references a file belongs in git;
 * the file does not.
 *
 * THE BROWSER DOES THE CONVERTING
 * ---------------------------------------------------------------------------
 * Resizing and WebP encoding happen client-side before anything is sent (see
 * adminMediaUpload in src/js/admin.js). A Worker cannot decode a JPEG without
 * a library, and Workers have a CPU budget measured in milliseconds — a 12MP
 * upload would spend all of it. The browser already holds the file decoded,
 * has a canvas, and is idle. So this endpoint validates and stores; it does
 * not transform.
 *
 * That means the limit here is a BACKSTOP, not the primary control. A caller
 * that skips the page and posts 30MB straight at this URL is refused.
 */
import { requireAccess } from "./lib/access.js";
import { createDb } from "./lib/db.js";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/* Generous for a converted photo and small enough that nothing pathological
   lands in the bucket. A 1600px WebP is typically 100–300KB. */
const MAX_BYTES = 4 * 1024 * 1024;

/* WHAT MAY BE STORED, and it is a list rather than a check on the extension.
   The content type is verified against the actual leading bytes below — a
   caller controls the header, and "image/webp" on an HTML file is how a bucket
   serving user uploads becomes a way to run script on your own domain. */
const TYPES = {
  "image/webp": { ext: "webp", magic: (b) =>
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", magic: (b) =>
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
};

/* `newsletter` is not a staff photo and does not behave like one: it belongs
   to a PARTNER rather than to a person, and the people who write newsletters
   are staff rather than administrators. Both differences are handled below
   rather than by pretending it is a third kind of portrait. */
const KINDS = new Set(["photo", "bio_photo", "newsletter"]);

export async function serve(request, env, key) {
  if (!env.MEDIA) return new Response("No media store on this deploy", { status: 500 });
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(key) || key.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  /* The key carries a content hash, so a given URL's bytes never change and
     this can be cached hard. Replacing a photo produces a NEW key, which is
     what makes replacement instant rather than a cache-busting argument. */
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", obj.httpEtag);
  /* Belt and braces with the magic-byte check on the way in: even if something
     unexpected is in the bucket, the browser will not run it. */
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");

  if (request.headers.get("If-None-Match") === obj.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(obj.body, { headers });
}

export default {
  async fetch(request, env) {
    if (request.method !== "PUT" && request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, { Allow: "PUT" });
    }
    if (!env.MEDIA) return json({ error: "No media store bound to this deploy" }, 500);

    const gate = await requireAccess(request, env);
    if (gate.denied) return gate.denied;
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500);

    const db = createDb(env.DB);
    const me = await db.queryOne("user_by_email", { email: gate.user.email });
    if (!me) return json({ error: "No account for that address" }, 403);
    const roles = String(me.roles || "").split(",");

    const url = new URL(request.url);
    const kind = String(url.searchParams.get("kind") || "photo").trim();
    if (!KINDS.has(kind)) {
      return json({ error: `kind must be one of ${[...KINDS].join(", ")}` }, 400);
    }

    /* WHO MAY UPLOAD, AND WHERE IT LANDS, both depend on the kind.

       A staff photo is published on the public team page under somebody's
       name, so it stays an administrative act. A newsletter image is a
       partner illustrating their own message, and requiring an administrator
       for it would mean nobody could write a newsletter unaided — so it is
       allowed to staff and SCOPED TO THEIR OWN PARTNER, which is what stops
       one ministry writing into another's folder. */
    let owner, prefix;
    if (kind === "newsletter") {
      const partners = await db.query("partners_for_user", { email: gate.user.email });
      if (!partners.length && !roles.includes("admin")) {
        return json({ error: "This account is not attached to a partner." }, 403);
      }
      /* The slug comes from the DATABASE, never from the request. A caller
         naming their own folder is a caller who can name somebody else's. */
      owner = partners.length ? partners[0].slug : "thauma";
      prefix = `newsletter/${owner}`;
    } else {
      if (!roles.includes("admin")) {
        return json({ error: "Administrator access is required" }, 403);
      }
      owner = String(url.searchParams.get("for") || "").trim();
      if (!owner) return json({ error: "for=<user_id> is required" }, 400);
      const person = await db.queryOne("user_by_id", { id: owner });
      if (!person) return json({ error: "No such person" }, 404);
      prefix = "team";
    }

    const declared = (request.headers.get("Content-Type") || "").split(";")[0].trim();
    const spec = TYPES[declared];
    if (!spec) {
      return json({
        error: `${declared || "That"} is not an image this accepts. Send WebP, JPEG or PNG.`,
      }, 415);
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) return json({ error: "The upload was empty." }, 400);
    if (bytes.length > MAX_BYTES) {
      return json({
        error: `That file is ${(bytes.length / 1048576).toFixed(1)}MB. The limit is ` +
               `${MAX_BYTES / 1048576}MB — the page normally shrinks photos before sending them.`,
      }, 413);
    }
    /* THE HEADER IS NOT EVIDENCE. Checked against the real leading bytes, so a
       file claiming to be a WebP cannot be stored and later served as one. */
    if (!spec.magic(bytes)) {
      return json({ error: `That file is not really a ${declared}.` }, 415);
    }

    /* CONTENT-ADDRESSED. The same photo uploaded twice is one object, a
       replacement is a different key rather than an overwrite, and every URL
       can therefore be cached forever. It also means an upload that half
       fails leaves nothing to clean up: nothing references the key yet. */
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = [...new Uint8Array(digest)].slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const key = kind === "newsletter"
      ? `${prefix}/${hash}.${spec.ext}`
      : `${prefix}/${owner}-${kind}-${hash}.${spec.ext}`;

    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: declared, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { uploadedBy: gate.user.email, uploadedAt: new Date().toISOString() },
    });

    await db.query("audit_write", {
      id: crypto.randomUUID(),
      now: new Date().toISOString(),
      user_id: me.user_id,
      partner_id: null,
      action: "media.upload",
      entity: kind === "newsletter" ? "mailing" : "staff_profile",
      entity_id: owner,
      detail: JSON.stringify({ key, kind, bytes: bytes.length, type: declared }),
    });

    /* The URL, not the key. The caller stores this in the profile and the team
       page prints it; where the bucket is mounted is this file's business. */
    return json({ ok: true, key, url: `/media/${key}`, bytes: bytes.length });
  },
};
