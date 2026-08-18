# The database, in plain words

You said you don't know what SQLite is. That's fine — you shouldn't need to.
This explains it once, then shows you the two buttons you'll actually press.

---

## What the database is

The website has **words** and it has **records**.

Words are the sentences on the pages: headings, the about text, button labels.
Those live in files, you edit them on the Content page, and Save commits them
to GitHub. You've already done this.

Records are everything with structure: people, partners, goals, milestones,
supporters, the log of who did what. Those can't live in files sensibly —
you'd be hand-editing a spreadsheet of relationships and it would go wrong
within a week. They live in a **database**.

**SQLite** is the kind of database. It's the most widely deployed database in
the world — it's in your phone, your browser, and your car. The whole thing is
one file, and it's small and fast, which is why Cloudflare uses it for **D1**,
which is the version we're on.

That's the entire vocabulary:

- **SQLite** — the kind of database
- **D1** — Cloudflare's hosting of it, which is where ours actually lives
- **SQL** — the language you write to ask it questions

You will never write SQL. That's my job.

---

## What a migration is

The database has a **shape**: which tables exist, which columns are in them,
what's allowed in each. "A person has a name and an email." "A goal belongs to
exactly one partner."

When the site grows, the shape has to change. Adding embeds meant partners
needed three new pieces of information: whether embedding is allowed, what
colour, and light or dark.

You can't just decide that and have it be true — the existing database
doesn't have those columns yet. So the change is written as a small file of
instructions:

```
db/migrations/0011_embeds.sql
```

**That file is a migration.** A numbered, one-at-a-time instruction for
changing the database's shape.

### Why they're numbered

Because they must run **in order** and **exactly once**.

`0011` assumes `0010` has already run. Running `0011` twice would try to add a
column that's already there and fail. Running them out of order breaks in
worse, quieter ways.

So the database keeps a list of which ones it has run. That's all the
migration system is: a numbered list, and a record of how far you've got.

### Why it went wrong before

Two migrations, `0009` and `0010`, changed how the database handles a person
leaving — so their name stops appearing but the record of what they did
survives.

I wrote them. I wrote the code that assumed them. **Nobody ran them on the
live database.** So the code asked for something the live tables couldn't do,
and "remove a person" returned a 500 with no explanation.

That's fixed, and the reason it can't happen quietly again is the panel below.

---

## The two buttons

### On the Publish page

You'll see a box about the database. It's one of three things:

**Green — "The database is up to date."**
Nothing to do. This is the normal state.

**Amber — "The database is behind the code."**
It lists what's waiting and gives you an **Apply changes** button. Press it,
type `MIGRATE`, and it runs them in order and records each one.

**Grey — "Could not read the database's migration state."**
Something's wrong with the connection, not with your data. Tell me.

### The order matters

**Apply the database changes BEFORE you publish.**

```
merge  →  apply  →  publish
```

New code that expects a column which isn't there breaks the moment it goes
live. A database slightly ahead of the code breaks nothing at all — the extra
column just sits there unused. So when in doubt, apply first.

### If one fails

It stops. It tells you which file, which instruction number, and which line.
It does **not** carry on to the next one, and it does **not** record a failed
migration as done.

If it says the migration was **partly applied**, don't press it again — some
instructions ran and some didn't, and repeating them could make it worse. Send
me the message.

---

## "Mark as already applied"

You may see this instead of Apply, and only once per database.

It means: this database already has the right shape, but no record of how it
got there — because I applied those migrations by hand before this page
existed. Marking them tells the list "these are done" **without running them
again**, which is correct, because running `0001` against a database that
already has all the tables would fail immediately.

It's a different word to type (`BASELINE`) on purpose. Claiming work was done
when it wasn't is the one thing here that can leave the database in a state
nobody can reason about. If you're not sure, don't.

---

## What you never have to do

- Write SQL
- Open a terminal
- Install anything
- Know what a foreign key is
- Remember which migration is which

If a situation comes up that needs any of those, that's a gap in what I've
built, not something for you to learn.

---

## The one-line summary

**A migration is a numbered instruction for changing the database's shape. The
Publish page tells you when any are waiting and gives you a button. Apply them
before you publish, not after.**
