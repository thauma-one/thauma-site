/**
 * A sender's mail signature (0055): a ministry's, or Thauma's own.
 *
 * Kept by owner — the partner id, or ORG for the organization, whose mail has
 * no partner (NULL cannot be a primary key). TOLERANT of the table not
 * existing: dev runs this code against the shared database before the
 * migration is applied, and until then there is simply no signature.
 */
export const ORG = "~organisation";

export const ownerOf = (partnerId) => partnerId || ORG;

export async function signatureOf(db, partnerId) {
  try {
    const row = await db.queryOne("mail_signature_get", { owner: ownerOf(partnerId) });
    return (row && row.html) || "";
  } catch { return ""; }
}
