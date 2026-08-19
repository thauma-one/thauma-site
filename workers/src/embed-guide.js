/**
 * embed-guide.js — the document a developer (or an AI) downloads with the API
 *
 * Served at /embed/v1/{slug}-guide.md, and linked beside the data address in
 * the console.
 *
 * WHY IT EXISTS
 * ---------------------------------------------------------------------------
 * The snippet is for people who want the picture. The JSON is for people
 * building their own design — and increasingly, for people who will paste the
 * URL into an assistant and ask it to build one. That second group needs to
 * know things the payload cannot tell them by looking at one response:
 *
 *   · which fields are always present and which are optional
 *   · that goals and milestones are ARRAYS that grow, so a design hardcoded to
 *     "two goals" breaks the week a third is added — the single most likely
 *     mistake, and the one this document exists to prevent
 *   · that `text` is keyed by language code and the set of codes varies
 *   · that money is in MINOR UNITS and percent can exceed 100
 *   · that milestones can have no date, and where those belong when sorted
 *
 * It is generated per partner rather than written once, so the examples name
 * their real slug and the URLs are the ones they will actually call.
 *
 * Markdown rather than OpenAPI: the audience is a person with a text editor or
 * a language model, and both read prose better than a schema. The schema is in
 * here too, as a table.
 */

/** The guide for one partner, as Markdown. */
export function embedGuide(origin, slug, displayName) {
  const url = `${origin}/embed/v1/${slug}.json`;

  return `# ${displayName} — public data

A single JSON document with this ministry's published goals and roadmap.
No key, no sign-up, no rate limit worth worrying about.

    ${url}

Everything here is intended for a public web page. It contains no supporter
records, no contact details and no donor identities — not by policy but by
construction, so there is nothing in it you need to be careful with.

---

## Before you build anything

**Read this section if you are asking an AI to build something from this
data.** These are the four things people get wrong, in the order they get
them wrong.

### 1. \`goals\` and \`milestones\` are lists that GROW

They are arrays. Today there may be two goals; next month there may be four.
A design that reads \`goals[0]\` and \`goals[1]\` and stops will silently omit
everything added later, and nobody will notice until a supporter asks why
their campaign is missing.

**Loop over the array. Never index into it.**

    // wrong — breaks the day a third goal is added
    render(data.goals[0]);
    render(data.goals[1]);

    // right — grows on its own
    data.goals.forEach(render);

The same is true of \`milestones\`, and of the language keys inside each
milestone's \`text\`.

### 2. Money is in MINOR UNITS

\`raised_cents\` and \`target_cents\` are integers in the currency's smallest
unit — cents, lipa, para. Divide by 100 before showing them, and format with
the currency from the \`currency\` field rather than assuming dollars.

    new Intl.NumberFormat('en', { style: 'currency', currency: goal.currency })
      .format(goal.raised_cents / 100)

### 3. \`percent\` can be more than 100

An over-funded goal is a real and happy state. Show the number as it is;
clamp only the width of a progress bar, or you will draw a bar wider than its
track.

### 4. A milestone may have no date

\`actual_date\` is \`null\` for anything not yet scheduled. Two traps:

- \`new Date(null)\` is **1 January 1970**, not an invalid date. Sort naively
  and every undated milestone jumps to the front of your roadmap.
- Undated entries belong at the END of a chronological list.

Guard the null explicitly before comparing dates.

---

## The shape

### Top level

| field | type | notes |
|---|---|---|
| \`version\` | number | \`1\`. If this changes, fields may have moved. |
| \`partner.slug\` | string | \`"${slug}"\` |
| \`partner.display_name\` | string | How to name them on your page. |
| \`theme.accent\` | string | Six-digit hex the ministry chose. Use it or don't. |
| \`theme.mode\` | string | \`auto\` \\| \`light\` \\| \`dark\` — their preference. |
| \`generated_at\` | string | ISO 8601 UTC. When this response was built. |
| \`languages\` | array | Which languages they publish. Build a switcher from THIS, not from the keys you happen to find. |
| \`goals\` | array | May be empty. |
| \`milestones\` | array | May be empty. |

### A goal

| field | type | notes |
|---|---|---|
| \`id\` | string | Stable. Safe to use as a key. |
| \`label\` | string | Already in the ministry's own words. |
| \`kind\` | string | \`monthly\` \\| \`one_time\` \\| \`project\` |
| \`target_cents\` | number \\| null | Minor units. Null means no target set. |
| \`raised_cents\` | number | Minor units. |
| \`currency\` | string | ISO 4217, e.g. \`USD\`, \`EUR\`. |
| \`donor_count\` | number \\| null | A count. Never a list of people. |
| \`percent\` | number | May exceed 100. |
| \`captured_at\` | string | When the giving platform was last read. |

### A milestone

| field | type | notes |
|---|---|---|
| \`id\` | string | Stable. |
| \`parent_id\` | string \\| null | Milestones can nest one level. |
| \`actual_date\` | string \\| null | ISO date. **Null is normal.** |
| \`status\` | string | \`upcoming\` \\| \`in_progress\` \\| \`complete\` \\| \`cancelled\` |
| \`completion\` | number \\| null | 0–100, if they track it. |
| \`is_featured\` | boolean | The ministry marked this as the current focus. |
| \`text\` | object | **Keyed by language code.** See below. |

### \`text\` is keyed by language

    "text": {
      "en": { "title": "...", "description": "...", "target_label": "..." },
      "hr": { "title": "...", "description": "...", "target_label": "..." }
    }

The set of codes varies by ministry and changes as translations are written.
**Do not hardcode \`text.en\`.** Ask for the language you want, fall back to
English, then to whatever exists:

    const t = m.text[lang] || m.text.en || m.text[Object.keys(m.text)[0]];

A milestone whose \`text\` has no usable title should be skipped rather than
drawn as a blank row.

---

## Caching

The response is cacheable for five minutes and carries
\`stale-while-revalidate\`. Giving figures are a snapshot that moves a few
times a day at most, so there is no reason to poll harder than that. If you
are rendering at build time, fetch once per build.

## When it stops answering

The ministry controls whether this address is public. If they switch embedding
off you will get **404**, the same 404 as a slug that does not exist — that is
deliberate, so the endpoint cannot be used to discover who is in the system.

Handle 404 as "nothing to show right now" rather than as an error worth
alarming anyone about.

## CORS

\`Access-Control-Allow-Origin: *\`, no credentials accepted. You can call it
from a browser on any domain.

---

## A complete, correct example

Renders every goal and every milestone, in the reader's language, and keeps
working when either list grows.

    async function render(el, lang = 'en') {
      const res = await fetch('${url}');
      if (res.status === 404) { el.textContent = ''; return; }
      const data = await res.json();

      const fmt = (cents, cur) =>
        new Intl.NumberFormat(lang, { style: 'currency', currency: cur })
          .format((cents || 0) / 100);

      // GOALS — loop, never index
      for (const g of data.goals) {
        const pct = Math.min(100, g.percent);        // bar clamps
        el.insertAdjacentHTML('beforeend',
          '<div class="goal">' +
            '<h3></h3>' +
            '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
            '<p>' + fmt(g.raised_cents, g.currency) +
              (g.target_cents ? ' of ' + fmt(g.target_cents, g.currency) : '') +
              ' — ' + Math.round(g.percent) + '%</p>' +
          '</div>');
        el.lastElementChild.querySelector('h3').textContent = g.label;
      }

      // MILESTONES — null dates last, language fallback, skip the unusable
      const when = d => (d === null || d === undefined || d === '')
        ? NaN : new Date(d).getTime();

      const rows = data.milestones
        .map(m => ({ m, t: m.text[lang] || m.text.en || m.text[Object.keys(m.text)[0]] }))
        .filter(r => r.t && r.t.title)
        .sort((a, b) => {
          const x = when(a.m.actual_date), y = when(b.m.actual_date);
          if (isNaN(x) && isNaN(y)) return 0;
          if (isNaN(x)) return 1;            // undated goes last
          if (isNaN(y)) return -1;
          return x - y;
        });

      for (const { m, t } of rows) {
        const li = document.createElement('li');
        li.className = 'milestone ' + m.status;
        li.textContent = t.title;            // textContent, not innerHTML
        el.appendChild(li);
      }
    }

Note \`textContent\` rather than \`innerHTML\` for anything coming from the
API. Titles and descriptions are free text written by people, and this is
somebody else's website.

---

*Generated ${new Date().toISOString().slice(0, 10)} for ${displayName}.
Questions: the ministry, or whoever set up their Thauma account.*
`;
}
