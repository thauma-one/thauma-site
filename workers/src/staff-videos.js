/**
 * staff-videos.js — point a partner at a YouTube channel
 *
 *   GET    /api/staff-videos[?scope=organisation]   config + what is cached
 *   POST   /api/staff-videos                        save a channel, then sync
 *   POST   … { "action": "check" }                  sync now
 *   DELETE /api/staff-videos                        forget the channel
 *
 * THE WHOLE SCREEN IS ONE FIELD. Paste a channel address, decide whether it is
 * public, choose how many to show. Everything else — the id behind a handle,
 * the feed, the poster images, the URLs — is derived, because every one of
 * those is a thing somebody would otherwise have to look up and could get
 * wrong in a way that shows on a live website.
 *
 * SAVING SYNCS IMMEDIATELY, and that is a deliberate cost. The scheduled run
 * is every quarter hour, so without this, saving a channel means staring at an
 * empty list wondering whether it worked. One fetch at save time turns "wait
 * and see" into "here are your videos" — and if the channel is wrong, it says
 * so while the person is still looking at the field they typed it into.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { resolveActor, auditActingWrite, withActing } from "./lib/actas.js";
import { json, readJson } from "./lib/store.js";
import { resolveChannelId, watchUrl, thumbUrl } from "./lib/youtube.js";
import { syncChannel } from "./lib/video-sync.js";

/** Same rule as the mailing console: the organisation is a scope you ask for
    and a role you must hold, never the default. */
async function scopeFor(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);
  const actor = await resolveActor(request, env, db, user);
  const me = actor.me;
  if (!me) return { denied: json({ error: "This address is not an active account." }, 403) };

  const roles = String(me.roles || "").split(",").filter(Boolean);
  const mayOrg = roles.includes("admin") || roles.includes("communications");

  if (new URL(request.url).searchParams.get("scope") === "organisation") {
    if (!mayOrg) {
      return { denied: json({
        error: "Thauma's own channel needs the administrator or communications role.",
      }, 403) };
    }
    return { db, user, me, actor, partnerId: null, isOrg: true, mayOrg };
  }

  const partners = await db.query("partners_for_user", { email: actor.email });
  if (!partners.length) {
    return { denied: json({
      error: "This account is not attached to a partner yet.",
    }, 403) };
  }
  return { db, user, me, actor, partnerId: partners[0].id, partner: partners[0],
           isOrg: false, mayOrg };
}

/** Config plus the cached videos, which is everything the screen draws. */
async function state(db, partnerId) {
  const channel = await db.queryOne("video_channel_get", { partner_id: partnerId });
  if (!channel) {
    return { channel: null, videos: [] };
  }

  const rows = await db.query("videos_for_channel", {
    channel_id: channel.channel_id, limit: channel.max_items,
  });

  return {
    channel: {
      channel_id: channel.channel_id,
      channel_title: channel.channel_title || null,
      is_public: !!channel.is_public,
      max_items: channel.max_items,
      synced_at: channel.synced_at || null,
      sync_error: channel.sync_error || null,
      /* So the console can show the person what it is actually reading,
         rather than asking them to trust that the id resolved. */
      channel_url: `https://www.youtube.com/channel/${channel.channel_id}`,
    },
    videos: rows.map((v) => ({
      id: v.video_id,
      title: v.title,
      published_at: v.published_at,
      url: watchUrl(v.video_id),
      thumbnail_url: thumbUrl(v.video_id),
    })),
  };
}

export default {
  async fetch(request, env) {
    const s = await scopeFor(request, env);
    if (s.denied) return s.denied;

    const { db, actor, partnerId } = s;
    await auditActingWrite(request, db, actor);
    const now = new Date().toISOString();

    const shell = (extra = {}) => withActing({
      scope: s.isOrg ? "organisation" : "partner",
      may_use_organisation: s.mayOrg,
      partner: s.partner
        ? { id: s.partner.id, display_name: s.partner.display_name }
        : null,
      ...extra,
    }, actor);

    if (request.method === "GET") {
      return json(shell(await state(db, partnerId)));
    }

    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      /* CHECK NOW. Re-reads the stored channel rather than trusting anything
         in the request, so this button can never be used to make the Worker
         fetch a URL of the caller's choosing. */
      if (body.action === "check") {
        const channel = await db.queryOne("video_channel_get", { partner_id: partnerId });
        if (!channel) return json({ error: "No channel is set yet." }, 400);

        const result = await syncChannel(db, channel, { now });
        return json(shell({ ...(await state(db, partnerId)), checked: result }));
      }

      const raw = String(body.channel || "").trim();
      if (!raw) return json({ error: "Enter a channel address or id." }, 400);

      let channel_id;
      try {
        channel_id = await resolveChannelId(raw);
      } catch (err) {
        /* The messages from resolveChannelId are written for the person at
           the field, so they are passed through rather than replaced. */
        return json({ error: err.message }, 400);
      }

      const max_items = Math.min(15, Math.max(1, Math.round(Number(body.max_items) || 3)));
      const is_public = body.is_public ? 1 : 0;

      await db.query("video_channel_save", {
        partner_id: partnerId,
        channel_id,
        /* Left as-is until the sync reports what the feed calls it. Writing
           the raw input here would put "@somebody" on the screen as though it
           were the channel's name. */
        channel_title: null,
        is_public,
        max_items,
        now,
      });

      const result = await syncChannel(db, { partner_id: partnerId, channel_id }, { now });
      if (result.ok && result.title) {
        await db.query("video_channel_save", {
          partner_id: partnerId, channel_id, channel_title: result.title,
          is_public, max_items, now,
        });
      }

      await db.query("audit_write", {
        id: crypto.randomUUID(), now,
        user_id: actor.user_id || null, partner_id: partnerId,
        action: "videos.channel", entity: "video_channels", entity_id: channel_id,
        detail: JSON.stringify({ is_public: !!is_public, max_items }),
      }).catch(() => {});

      return json(shell({ ...(await state(db, partnerId)), checked: result }));
    }

    if (request.method === "DELETE") {
      /* Clears the CONFIG. The cached videos stay: another partner may point
         at the same channel, and rows keyed by channel are not this partner's
         to delete. The scheduled run stops touching them, and they cost a few
         hundred bytes. */
      await db.query("video_channel_clear", { partner_id: partnerId });
      await db.query("audit_write", {
        id: crypto.randomUUID(), now,
        user_id: actor.user_id || null, partner_id: partnerId,
        action: "videos.clear", entity: "video_channels", entity_id: "-",
        detail: "{}",
      }).catch(() => {});
      return json(shell(await state(db, partnerId)));
    }

    return json({ error: `${request.method} is not supported here.` }, 405);
  },
};
