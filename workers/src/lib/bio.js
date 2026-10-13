/**
 * A person's own bio, sent for approval (0058) — what may be sent, and the
 * answer that goes back.
 *
 * Chase, 2026-10-13: "they can edit, but it has to be approved by an Admin
 * before it goes live." Later the same day: "The partner can edit their whole
 * bio, including the photo and email contact. Since it has to be approved. It
 * isn't a big deal. The admin needs the ability to edit though, then it can
 * be published and notify the changes back to the staff member. Even a
 * notification if it was approved or declined is good."
 *
 * THE WHOLE TEAM PAGE, except what decides whether and where it is shown —
 * on or off, the address, the order. Those stay an administrator's.
 *
 * EACH CHANGE IS ANSWERED ON ITS OWN (Chase, the same day: "We should have
 * the ability to approve, edit, or decline individual aspects of the staff
 * bio edits, all communicating back to the staff member"). Nothing records
 * which button was pressed: the outcome of each part is read from the three
 * versions of it — what the person sent, what the page said before, and what
 * the administrator saved. Saved as sent: approved. Saved as it was: not
 * approved. Anything else: changed by the administrator (outcomes()).
 *
 * THE ANSWER IS KEPT on the same row, beside what was sent: each part's
 * outcome with its before and after, by whom, when, and the administrator's
 * note. Settings › Your bio shows it, word by word, until the person sends
 * again or puts it away. A row with an answer is not waiting: the People page
 * and the waiting state ignore it (isWaiting).
 */
import { notifyPerson } from "./notify.js";

const MAX = { region: 120, email: 200, role_title: 120, bio: 4000, note: 600 };

/* What the person may send, besides the words. */
export const BIO_FIELDS = ["region", "public_email", "photo", "bio_photo", "bio_photo_aspect", "photo_master", "bio_photo_master"];

const str = (v, max) => String(typeof v === "string" ? v : "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " ").trim().slice(0, max);

/* A packed staff_profiles_all row's words, by language. */
export function unpackText(packed) {
  const out = {};
  String(packed || "").split("\u001e").forEach((rec) => {
    const b = rec.split("\u001f");
    if (b[0]) out[b[0]] = { role_title: b[1] || "", bio: b[2] || "" };
  });
  return out;
}

/** The team page as it is saved now, in the shape a proposal has. */
export function liveBio(row) {
  const out = { text: unpackText(row.translations) };
  for (const f of BIO_FIELDS) out[f] = f === "bio_photo_aspect" ? (row[f] == null ? null : Number(row[f])) : (row[f] || "");
  return out;
}

/* A picture is one the person uploaded for themselves (media.js, team/), or
   the one already on their page; nothing else, so a proposal cannot point the
   team page at somebody else's address. */
const picture = (v, live) => {
  const s = str(v, 300);
  return s === "" || s === live || /^\/media\/team\/[A-Za-z0-9._-]{1,180}$/.test(s) ? s : (live || "");
};

/** What was sent, made safe. codes: the languages that exist. live: the page
    as saved now (liveBio), which a picture may also keep. */
export function cleanBio(raw, codes, live = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const text = {};
  for (const [lang, t] of Object.entries(r.text || {})) {
    if (!codes.has(lang) || !t || typeof t !== "object") continue;
    text[lang] = { role_title: str(t.role_title, MAX.role_title), bio: str(t.bio, MAX.bio) };
  }
  const email = str(r.public_email, MAX.email);
  const aspect = Number(r.bio_photo_aspect);
  return {
    region: str(r.region, MAX.region),
    public_email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    photo: picture(r.photo, live.photo),
    bio_photo: picture(r.bio_photo, live.bio_photo),
    bio_photo_aspect: Number.isFinite(aspect) && aspect > 0 ? Math.max(0.4, Math.min(2.5, aspect)) : null,
    photo_master: picture(r.photo_master, live.photo_master),
    bio_photo_master: picture(r.bio_photo_master, live.bio_photo_master),
    text,
  };
}

/* Every part a person can change, by key: region, public_email, photo,
   bio_photo, text.<lang>.role_title, text.<lang>.bio. Only what is there —
   a proposal sent before email and photos could be sent has no such keys. */
export function partsOf(b) {
  const n = (v) => String(v == null ? "" : v).trim();
  const out = {};
  for (const f of ["region", "public_email", "photo", "bio_photo"]) if (b && typeof b[f] === "string") out[f] = n(b[f]);
  for (const [l, t] of Object.entries((b && b.text) || {})) {
    out[`text.${l}.role_title`] = n(t && t.role_title);
    out[`text.${l}.bio`] = n(t && t.bio);
  }
  return out;
}

/** Each part the person changed, and what became of it: approved, edited or
    declined, with the value before and the value saved. */
export function outcomes(sent, was, kept) {
  const S = partsOf(sent), W = partsOf(was), K = partsOf(kept);
  const out = {};
  for (const k of Object.keys(S)) {
    const before = W[k] || "", after = K[k] || "";
    if (S[k] === before) continue;
    out[k] = { result: after === S[k] ? "approved" : after === before ? "declined" : "edited", was: before, kept: after };
  }
  return out;
}

/** A stored row: what was sent, and the answer if there is one. */
export function readProposal(row) {
  if (!row) return null;
  try { return { ...JSON.parse(row.payload), user_id: row.user_id, submitted_at: row.submitted_at }; }
  catch { return null; }
}
export const isWaiting = (p) => !!p && !p.decision;

/**
 * Answer what somebody sent, and tell them. was: the page before the answer;
 * kept: the page as saved by it (a decline of everything saves nothing, so
 * kept is was). Nothing waiting → nothing done.
 */
export async function answerProposal(env, db, { userId, by, note, was, kept, origin }) {
  const stored = readProposal(await db.queryOne("profile_proposal_get", { user_id: userId }).catch(() => null));
  if (!isWaiting(stored)) return { answered: false };
  const { user_id, submitted_at, ...sent } = stored;
  const parts = outcomes(sent, was || {}, kept || was || {});
  const results = Object.values(parts).map((p) => p.result);
  const status = results.every((r) => r === "declined") && results.length ? "declined"
    : results.every((r) => r !== "declined") ? "approved" : "partly";
  const edited = results.includes("edited");
  const decision = { status, at: new Date().toISOString(), by: str(by, 120), note: str(note, MAX.note), edited, parts };
  await db.query("profile_proposal_set", { user_id: userId, payload: JSON.stringify({ ...sent, decision }), now: submitted_at });
  /* one notice, worded for the whole: approved (perhaps with changes of
     theirs), partly, or not; the parts are on Settings › Your bio */
  const v = status === "partly" ? "partly" : edited ? "edited" : null;
  await notifyPerson(env, db, status === "declined" ? "profile_declined" : "profile_approved", userId,
    { by: decision.by, ...(v ? { _v: v } : {}), ...(decision.note ? { note: decision.note } : {}) },
    { origin, link: "/staff/settings/#bio" }).catch(() => {});
  return { answered: true, status, edited };
}
