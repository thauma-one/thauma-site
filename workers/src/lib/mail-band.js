/**
 * mail-band.js — the header every supporter email opens with
 *
 * Chase, 2026-10-07: "all of the email headers should match that THAUMA
 * style. Replace the Thauma text header with the name of the person,
 * underneath that still in the header is the type of email it is (like
 * Newsletter, Prayer, Contact, Sign Up Confirmation, etc), and the background
 * is the gradient with accent color and secondary color."
 *
 * THAUMA'S BAND (src/img/email-band.png) is the model: a night ground with two
 * washes of color in opposite corners, the name spaced wide and thin, and a
 * line in the accent along the foot. Here the washes are the ministry's own
 * two colors and the words are live text — no image per ministry, and it reads
 * with pictures blocked.
 *
 * THE GRADIENT IS A BONUS, THE GROUND IS THE PROMISE. bgcolor carries the
 * night color for Outlook on Windows, which draws no gradients; the clients
 * that do (Gmail, Apple Mail, Outlook on the web and on phones) paint the
 * washes over it. The stops are solid colors already mixed with the ground,
 * not transparent ones, because some clients drop rgba() and 8-digit hex.
 *
 * Used by the newsletter (newsletter.js render()) and the system emails a
 * partner's supporters receive (mail.js shell() with a brand).
 */
import { readable, luminance } from "../embed-colour.js";

const GROUND = "#070A10";
const HEX = /^#[0-9a-fA-F]{6}$/;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* `hex` laid over `ground` at `amount` (0–1), as one solid color. */
export function wash(hex, amount, ground = GROUND) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(ground.slice(1), 16);
  const ch = (n, s) => (n >> s) & 255;
  const mix = (s) => Math.round(ch(a, s) * amount + ch(b, s) * (1 - amount));
  return "#" + [16, 8, 0].map((s) => mix(s).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/* THE WASHES, QUIETER (2026-10-07, Chase: "Can we lessen the color gradient
   so it isn't so pronounced. It takes away from the email"): about a fifth
   of the color on a dark ground and an eighth on a light one, fading out
   well before the middle. */
function glow(a1, a2, ground) {
  const k = luminance(ground) < 0.25 ? [0.2, 0.24] : [0.1, 0.13];
  return `linear-gradient(45deg,${wash(a2, k[0], ground)} 0%,${ground} 40%,${ground} 60%,${wash(a1, k[1], ground)} 100%)`;
}
const pair = (accent, accent2) => {
  const a1 = HEX.test(String(accent || "")) ? accent : "#1AE4FF";
  return [a1, HEX.test(String(accent2 || "")) ? accent2 : a1];
};

/**
 * The header rows: name, the kind of email beneath it, the line along the
 * foot. Returns <tr>s for a 100%-wide presentation table.
 *
 * ON THE LETTER'S OWN GROUND (2026-10-07, Chase: "is there a way to match
 * the light vs dark mode so it isn't a dark header on a light text body?"):
 * `ground` and `ink` are the card's color and its text, so a light letter
 * has a light band and a dark one a dark band. Thauma's night is the default.
 */
export function band({ name, kind, accent, accent2, ground = GROUND, ink = "#EDF2F8" }) {
  const [a1, a2] = pair(accent, accent2);
  const font = "'Helvetica Neue',Helvetica,Arial,sans-serif";
  return `<tr><td class="band" bgcolor="${ground}" align="left"
              style="background-color:${ground};background-image:${glow(a1, a2, ground)};padding:44px 36px 38px;">
        <p class="bname" style="margin:0;font-family:${font};font-size:26px;line-height:1.25;font-weight:200;
                  letter-spacing:10px;text-transform:uppercase;color:${ink};">${esc(name)}</p>
        ${kind ? `<p class="bkind" style="margin:12px 0 0;font-family:${font};font-size:11px;line-height:1.4;font-weight:600;
                  letter-spacing:4px;text-transform:uppercase;color:${readable(a1, ground, 4.5)};">${esc(kind)}</p>` : ""}
      </td></tr>
      <tr><td bgcolor="${a1}" style="background-color:${a1};background-image:linear-gradient(90deg,${a1},${a2});
                     height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

/* The same band repainted for a dark reader, for a letter that matches the
   reader's setting: rules for a prefers-color-scheme block. */
export function bandDarkCss({ accent, accent2, ground, ink }) {
  const [a1, a2] = pair(accent, accent2);
  return `.band { background-color: ${ground} !important; background-image: ${glow(a1, a2, ground)} !important; }
  .bname { color: ${ink} !important; }
  .bkind { color: ${readable(a1, ground, 4.5)} !important; }`;
}
