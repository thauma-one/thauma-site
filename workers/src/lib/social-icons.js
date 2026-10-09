/**
 * social-icons.js — the social links' icons and names, in one place
 *
 * Drawn by a partner's site (site/render.js) and by Thauma's own footer
 * (src/_data/socialIcons.js reads this file), so a social link looks the same
 * wherever it is (2026-10-07: "one footer and links model"). Each icon is the
 * inside of a 24×24 <svg>, in currentColor.
 */
export const ICON = {
  youtube: '<path d="M22 8.2s-.2-1.5-.8-2.1c-.8-.8-1.6-.8-2-.9C16.4 5 12 5 12 5s-4.4 0-7.2.2c-.4.1-1.2.1-2 .9-.6.6-.8 2.1-.8 2.1S2 9.9 2 11.6v1.6c0 1.7.2 3.4.2 3.4s.2 1.5.8 2.1c.8.8 1.8.8 2.2.9 1.6.2 6.8.2 6.8.2s4.4 0 7.2-.2c.4-.1 1.2-.1 2-.9.6-.6.8-2.1.8-2.1s.2-1.7.2-3.4v-1.6c0-1.7-.2-3.4-.2-3.4zM10 15V9l5.2 3L10 15z" fill="currentColor"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor"/>',
  facebook: '<path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.3-1.5 1.6-1.5h1.6V3.6c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1v2.3H7.6V13h2.7v8h3.2z" fill="currentColor"/>',
  x: '<path d="M17.7 3h3l-6.6 7.5L22 21h-6.1l-4.8-6.2L5.6 21h-3l7-8L2.5 3h6.2l4.3 5.7L17.7 3zm-1 16.2h1.7L7.8 4.7H6l10.7 14.5z" fill="currentColor"/>',
  tiktok: '<path d="M16.5 3c.4 2.2 1.8 3.6 4 3.8v3c-1.5 0-2.9-.4-4-1.2v6.2c0 3.4-2.6 5.7-5.7 5.7S5 18.2 5 15.1c0-3.3 2.8-5.8 6.2-5.6v3.1c-1.6-.3-3.1.8-3.1 2.5 0 1.4 1.1 2.6 2.6 2.6 1.6 0 2.7-1.1 2.7-3V3h3.1z" fill="currentColor"/>',
  linkedin: '<path d="M4.5 9h3v11h-3V9zm1.5-5a1.8 1.8 0 110 3.6A1.8 1.8 0 016 4zm4 5h2.9v1.5c.4-.8 1.5-1.7 3.1-1.7 3.3 0 3.9 2.1 3.9 4.9V20h-3v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V20h-3V9z" fill="currentColor"/>',
  spotify: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 9.6c3-1 6.6-.7 9.2.8M8 12.6c2.5-.7 5.3-.4 7.4.8M8.6 15.4c2-.5 4-.3 5.6.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
};
export const SOCIAL_NAME = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", x: "X", tiktok: "TikTok",
  linkedin: "LinkedIn", spotify: "Spotify", email: "Email" };

