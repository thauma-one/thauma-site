# Thauma operations database

Thauma is the system of record. Ministry partners — Chase Roush, and anyone
who comes after — are **tenants inside it**, not separate systems.

```
db/
  migrations/0001_init.sql   the schema
  seed.dev.sql               throwaway data for local work
  test_schema.py             asserts the guarantees below actually hold
```

Run the tests with `python3 db/test_schema.py`. They execute the migration
into an in-memory SQLite database and check the rules that are expensive to
discover later. **14 passing at time of writing.**

---

## The three decisions baked in

### 1. Every tenant-owned row carries `partner_id`, NOT NULL

Not "we filter in the app layer." The column is `NOT NULL` on `contacts`,
`interactions`, `goals`, `goal_snapshots` and `api_keys`, so a query that
forgets to scope is a bug you can grep for rather than a silent cross-tenant
leak.

A trigger also enforces that an interaction's `partner_id` matches its
contact's, so an app bug can't file Chase's phone call under someone else.

### 2. No donor PII. Ever.

There is **deliberately no `donations` table**, no `amount` column on
`contacts`, and no donor name or email on `goal_snapshots`. Donation records
live in the giving platform (Donorbox et al). This database stores four
aggregate numbers per goal: raised, donor count, source, captured-at.

Consequences, all intended:

- A partner reads their own donor detail by logging into the giving platform.
- **You cannot see another partner's donor list, because it is not here.**
  That is a technical guarantee, not a policy promise.
- The GDPR surface, the breach exposure, and the PCI-adjacent scrutiny all
  shrink to almost nothing.

`test_schema.py` asserts the absence of these columns, so adding one breaks
the build rather than quietly changing what this system is.

### 3. Consent is per-purpose and per-partner

Giving is not newsletter consent. Someone who donated has not opted into a
mailing list, and someone on Chase's list has not opted into Thauma's.

`newsletter_consent` is its own column with its own `_source` and `_at`, and
`postal_consent` is separate again. All of it is partner-scoped. Croatia is in
the EU, so GDPR applies, and these timestamps are your evidence.

---

## Who can see what

Two independent layers, deliberately:

| | |
|---|---|
| `users.global_role` | org-level authority — `admin` or `staff` |
| `partner_users.role` | per-partner grant — `owner`, `assist`, or `view` |

**An `admin` is not automatically entitled to read a partner's contacts.** The
UI still has to go through `partner_users`, and every such read should write to
`audit_log`.

That distinction is the whole point. You asked to avoid having access to staff
data, and the honest answer is that whoever holds the database credentials can
read the database — no schema prevents that. What a schema *can* do is make
access **deliberate, logged, and visible to the partner whose data it is**.
`audit_log` is append-only, enforced by triggers: updates and deletes both
abort.

Combined with decision 2 — the most sensitive data isn't here at all — that's
about as close to your intent as is actually achievable.

---

## Deriving, not storing

`contacts` has no `last_contacted` column, on purpose. A stored column goes
stale the moment something is logged out of order.

The `contact_touch` view computes both numbers that matter:

```sql
SELECT contact_id, last_contact_any, last_personal_contact
FROM contact_touch WHERE partner_id = ?;
```

`last_personal_contact` counts only `is_personal = 1` rows — calls, texts,
visits, handwritten notes. **A newsletter going to 400 people is contact, but
it is not personal contact**, and a dashboard that conflates them will cheerfully
report that everyone is looked after when nobody has been called in four
months. A trigger makes it impossible to log a newsletter as personal.

`goal_progress` does the same for money: latest snapshot per goal, percentage
computed and clamped at 100.

---

## Applying it

Cloudflare D1:

```bash
wrangler d1 create thauma-ops
wrangler d1 execute thauma-ops --file=db/migrations/0001_init.sql        # local
wrangler d1 execute thauma-ops --remote --file=db/migrations/0001_init.sql
```

Conventions: ids are app-generated TEXT (UUID/ULID), timestamps are ISO-8601
UTC strings, dates are `YYYY-MM-DD`, **money is INTEGER cents — never a float**,
booleans are 0/1, and enums are TEXT with CHECK constraints since SQLite has
no native enum.

Migrations are forward-only and numbered. Never edit `0001_init.sql` once it
has been applied anywhere real — add `0002_*.sql` instead.

---

## Open questions

These need answers before the admin is built on top, but none of them block
the schema as it stands:

1. **Auth provider.** `users.auth_subject` assumes an external identity
   provider holds credentials, so passwords, MFA and reset flows are someone
   else's problem. If you'd rather roll your own, add `password_hash` in a
   later migration — don't repurpose `auth_subject`.
2. **Is Thauma the US 501(c)(3) or a Croatian entity?** Still the biggest open
   question in the whole design. It doesn't change these tables, but it changes
   what `giving_provider` should point at and who the donor relationship
   legally belongs to.
3. **Do Chase's existing subscribers migrate in?** The schema supports it —
   `contacts` with `newsletter_consent = 1` scoped to his partner row. The
   consent provenance needs to come across with them, not be invented.
4. **Currency.** `goals.currency` defaults to USD. If Croatian partners ever
   raise in EUR, decide now whether aggregates are converted or kept native.
