/**
 * A sender's mail signatures (0057): a ministry's, or Thauma's own — several
 * of them, by name ("Thauma", "Chase Roush"), as a mailing may come from the
 * ministry or from one person in it.
 *
 * Kept by owner — the partner id, or ORG for the organization, whose mail has
 * no partner. TOLERANT of the table not existing: dev runs this code against
 * the shared database before the migration is applied, and until then there
 * are simply no signatures.
 */
export const ORG = "~organisation";

export const ownerOf = (partnerId) => partnerId || ORG;

export async function signaturesOf(db, partnerId) {
  try {
    return (await db.query("mail_sigs_for", { owner: ownerOf(partnerId) }))
      .map((r) => ({ id: r.id, name: r.name, html: r.html || "" }));
  } catch { return []; }
}
