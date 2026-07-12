// Serves staff-area content ONLY to logged-in users with the staff or
// admin role. Sensitive data lives here (or is fetched from private
// storage here) - never in the public repo or static HTML.
//
// TO EDIT CONTENT: change the two arrays below. Shapes:
//   contacts:  { name, role, info, link (optional) }
//   resources: { title, description, link, photo (optional URL) }
exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  const roles = (user && user.app_metadata && user.app_metadata.roles) || [];
  const allowed = roles.includes("staff") || roles.includes("admin");

  if (!user || !allowed) {
    return { statusCode: 401, body: JSON.stringify({ error: "Not authorized" }) };
  }

  const contacts = [
    { name: "Example Person", role: "Example role", info: "email@example.com · +385 00 000 0000", link: "mailto:email@example.com" }
  ];
  const resources = [
    { title: "Example resource", description: "Replace me in netlify/functions/staff-data.js — a checklist, doc, or internal link.", link: "https://example.com", photo: "" }
  ];

  return { statusCode: 200, body: JSON.stringify({ contacts, resources }) };
};
