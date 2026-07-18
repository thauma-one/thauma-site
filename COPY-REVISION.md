> **STATUS: APPLIED** (2026-07-16, commit "copy: need-first tone pass").
> Kept in the repo because the tone principles below remain the standard
> for ALL future copy — including the Serbian file (sr.json), which was
> transliterated from the already-revised hr.json.

# COPY-REVISION — Tone pass (need-first, own-terms)

**For Claude Code.** This revises site copy only — no templates, no
design, no key renames. Every change below is a value swap inside
`src/_data/i18n/en.json` and `src/_data/i18n/hr.json`. Keys are
unchanged, so `src/admin/config.yml` needs no edits. Work on dev,
commit as "copy: need-first tone pass (founder direction)".

**The principle behind every change (from the business plan):** lead
with the real technical need and the concrete work; care for the
person is the engine underneath, deliberately not the marketing
banner. Do not advertise "free" — the cost posture may be *implied*
once, never headlined. Present the work on its own terms.

---

## 1. HOME (`home.*`)

| Key | EN (new) |
|---|---|
| sub | Churches across Croatia and the surrounding region carry a real technical need — sound, lighting, video, streaming, and the people who run them, often with no one to learn from. Thauma exists to meet that need. |
| who_cue | The need |
| who_h2_thin | Real churches, |
| who_h2_bold | real technical need. |
| who_lede | Aging equipment without anyone trained on it. Volunteers running complex systems alone. No training pipeline, no peer network. The need is practical, and it's this Sunday's — so that's where we start. |
| values_cue | How we help |
| values_h2_thin | Three forms of |
| values_h2_bold | the same work. |
| value1_title | Serve |
| value1_text | Hands-on help in real services — fixing what's broken, improving what's struggling, working alongside the team that's already there. |
| value2_title | Train |
| value2_text | Practical, in-language training: signal flow, mixing, troubleshooting, and stewarding the equipment a church already owns. |
| value3_title | Resource |
| value3_text | Wise, affordable equipment decisions and access to knowledge that's hard to reach — guides and materials in Croatian and English. |
| values_link | What we hold to → |
| cta_cue | Partner with us |
| cta_h2_thin | The work is carried |
| cta_h2_bold | by partnership. |
| cta_lede | Thauma is support-raised. Partners — individuals and churches — are what put us alongside the teams that need it. |
| cta_give | Support the Work |
| cta_contact | Reach Out |

| Key | HR (new) |
|---|---|
| sub | Crkve u Hrvatskoj i okolnoj regiji nose stvarnu tehničku potrebu — zvuk, rasvjeta, video, prijenosi i ljudi koji sve to vode, često bez ikoga od koga bi učili. Thauma postoji da tu potrebu ispuni. |
| who_cue | Potreba |
| who_h2_thin | Stvarne crkve, |
| who_h2_bold | stvarna tehnička potreba. |
| who_lede | Stara oprema bez ikoga tko je obučen. Volonteri koji sami vode složene sustave. Bez obuke, bez mreže kolega. Potreba je praktična — i tiče se već ove nedjelje, pa upravo tu počinjemo. |
| values_cue | Kako pomažemo |
| values_h2_thin | Tri oblika |
| values_h2_bold | istoga posla. |
| value1_title | Služiti |
| value1_text | Praktična pomoć na stvarnim bogoslužjima — popravljamo pokvareno, poboljšavamo ono što šteka, radimo uz tim koji je već ondje. |
| value2_title | Obučavati |
| value2_text | Praktična obuka na hrvatskom: tok signala, miksanje, rješavanje problema i dobro upravljanje opremom koju crkva već ima. |
| value3_title | Opskrbiti |
| value3_text | Mudre i pristupačne odluke o opremi te pristup znanju do kojeg je teško doći — vodiči i materijali na hrvatskom i engleskom. |
| values_link | Čega se držimo → |
| cta_cue | Partnerstvo s nama |
| cta_h2_thin | Ovaj posao nose |
| cta_h2_bold | partneri. |
| cta_lede | Thauma se financira potporom. Partneri — pojedinci i crkve — omogućuju nam da stanemo uz timove kojima je to potrebno. |
| cta_give | Podržite rad |
| cta_contact | Javite nam se |

Note: the homepage section that displayed the three CONVICTIONS now
displays the three WORK cards (same keys, new content). The heart
language lives on the Values page, linked via values_link.

---

## 1b. HERO LINES — metaphor retired (founder direction)

Home (`home.h1_thin` / `home.h1_bold`):
- EN: "First in," / "last out."
- HR: "Prvi dolaze," / "posljednji odlaze."

Landing page (`coming.line_thin` / `coming.line_bold`):
- EN: "Thauma is" / "in preparation."
- HR: "Thauma je" / "u pripremi."

Also update `coming.text` to match the new homepage sub's tone:
- EN: "A production ministry for the churches of Croatia and the
  surrounding region — serving, training, and resourcing their
  technical teams. Launching soon."
- HR: "Produkcijska služba za crkve u Hrvatskoj i okolnoj regiji —
  služenje, obuka i opskrba njihovih tehničkih timova. Uskoro."

Grep both i18n files for remaining "in the dark" / "u mraku" in
home/coming sections and confirm none remain (the 404 game copy keeps
its own language — it is out of scope for this pass).

---

## 2. VALUES PAGE (`values.items`) — titles AND text rewritten, order unchanged

Founder direction: the titles themselves were never well-stated values
(fragments, bare nouns, or plain facts stated as if that were enough).
All seven titles are replaced below, designed as ONE SET sharing a
register — short, declarative, each landing on a strong final word —
so they build rhythm read top to bottom rather than shifting style
mid-list. Body text is rewritten to fit the new titles, keeping the
"earned claim" shape (state it, show the cost or the alternative
rejected, land on why it matters). ORDER UNCHANGED from the current
live order. This is a straight value-swap on the existing array
(title + text both change; array position does not).

| # | Title (was) | Title (NEW) |
|---|---|---|
| 1 | The person is the point | People over projects |
| 2 | Production is the door | Service is the door |
| 3 | Community is the fruit | Community is the harvest |
| 4 | Multiplication | Built to multiply |
| 5 | For the whole church | One church, no owners |
| 6 | Assimilation, not influence | Guests, not reformers |
| 7 | God does the work | We plant; God grows |

### EN

**1. People over projects**
It would be simpler to measure success by equipment fixed or services
covered. We don't, on purpose: the volunteer running the board matters
more than the board they're running, and that has to survive contact
with a broken deadline or a frustrating rehearsal. It's the standard
behind the visit, not the pitch in front of it.

**2. Service is the door**
We could frame the technical work as a means to something else, but
that would be dishonest — the need is real on its own terms, and
treating it as a pretext for "the real ministry" would insult the
people asking for help. So the console gets fixed because it needs
fixing. What grows from being there long enough to do that well is a
separate gift, not the hidden agenda.

**3. Community is the harvest**
A well-run sound system says nothing about whether the people running
it know each other, or anyone else doing the same work three towns
over. We could call the technical work finished and leave. Instead we
count it unfinished until something relational exists that didn't
before — technicians, worship leaders, and pastors in contact, across
churches that would otherwise never have met.

**4. Built to multiply**
Every hour spent training someone is an hour we're betting they'll
spend training someone else. That bet doesn't always pay off
immediately, and it means real patience with people still learning.
But an organization whose center never shrinks isn't multiplying —
it's building dependency, and that's a fruit we're actively trying not
to grow.

**5. One church, no owners**
Neutrality is easy to claim and hard to practice, especially when one
denomination is easier to reach than another, or better funded, or
simply already in the room. We don't get to have a favorite.
Independence from any single church body isn't a nice sentiment here —
it's structural, because the moment we're seen as belonging to one
tradition, we stop being useful to the rest.

**6. Guests, not reformers**
The instinct to arrive with answers is strong, especially for anyone
who's already done this work somewhere else. We resist it on purpose:
language and culture come before relationship, and relationship comes
before any opinion about how a church should run its production. Years
spent as a student, not a consultant — because the alternative is
importing a model nobody here asked for.

**7. We plant; God grows**
Everything above describes effort, and effort alone has a ceiling. We
can open a door, show up consistently, and serve competently — we
cannot manufacture the community or the multiplication that follows.
Saying that plainly isn't false modesty; it's the reason the first six
convictions never collapse into pressure to perform.

### HR

**1. Ljudi prije projekata**
Bilo bi jednostavnije uspjeh mjeriti popravljenom opremom ili
pokrivenim bogoslužjima. Namjerno to ne radimo: volonter za pultom
važniji je od pulta za kojim stoji, a to mora preživjeti susret s
propuštenim rokom ili napornom probom. To je mjerilo iza posjeta, a ne
parola ispred njega.

**2. Služenje je vrata**
Mogli bismo tehnički posao prikazati kao sredstvo za nešto drugo, ali
to bi bilo neiskreno — potreba je stvarna sama po sebi, a tretirati je
kao izliku za "pravu službu" vrijeđalo bi ljude koji traže pomoć. Zato
se pult popravlja jer treba popravak. Ono što izraste iz dovoljno
dugog i dobrog rada zaseban je dar, ne skriveni plan.

**3. Zajednica je žetva**
Dobro postavljen zvučni sustav ništa ne govori o tome poznaju li se
ljudi koji njime upravljaju, ili itko drugi tko radi isti posao tri
grada dalje. Mogli bismo tehnički posao smatrati završenim i otići.
Umjesto toga smatramo ga nedovršenim dok ne nastane nešto odnosno što
prije nije postojalo — tehničari, voditelji slavljenja i pastori u
kontaktu, iz crkava koje se inače nikada ne bi srele.

**4. Stvoreni za umnožavanje**
Svaki sat uložen u obuku netko je sat kojim se kladimo da će ga ta
osoba uložiti u obuku nekog drugog. Ta se oklada ne isplati uvijek
odmah, a znači i stvarno strpljenje s ljudima koji još uče. No
organizacija čije se središte nikada ne smanjuje ne umnožava se —
gradi ovisnost, a to je plod koji aktivno pokušavamo izbjeći.

**5. Jedna Crkva, bez vlasnika**
Neutralnost je lako izjaviti, a teško provoditi — osobito kad je jednu
denominaciju lakše doseći nego drugu, ili je bolje financirana, ili je
jednostavno već u prostoriji. Ne smijemo imati favorita. Neovisnost od
bilo koje crkvene zajednice ovdje nije lijepa gesta — strukturni je
zahtjev, jer čim nas se počne doživljavati kao pripadnike jedne
tradicije, prestajemo biti korisni ostalima.

**6. Gosti, ne reformatori**
Poriv da se dođe s gotovim odgovorima jak je, osobito za svakoga tko je
ovaj posao već negdje drugdje radio. Namjerno mu se opiremo: jezik i
kultura dolaze prije odnosa, a odnos dolazi prije bilo kakvog mišljenja
o tome kako bi crkva trebala voditi svoju produkciju. Godine provedene
kao učenik, ne kao konzultant — jer je alternativa uvoz modela koji
ovdje nitko nije tražio.

**7. Mi sadimo; Bog daje rast**
Sve gore navedeno opis je truda, a trud sam po sebi ima strop. Možemo
otvoriti vrata, dolaziti dosljedno i služiti stručno — ne možemo
proizvesti zajednicu ili umnožavanje koje iz toga slijedi. Reći to
jasno nije lažna skromnost; to je razlog zašto se prvih šest uvjerenja
ne pretvara u pritisak da se nešto izvede.

---

## 3. GIVE PAGE (`give.*`) — no "free" advertising

| Key | EN (new) |
|---|---|
| cue | Partner with us |
| h2_thin | This work runs on |
| h2_bold | partnership. |
| lede | Thauma is support-raised in the missionary tradition: the churches we serve are not the ones who carry the cost — partners are. Giving here puts skilled help alongside teams that have no other way to reach it. |
| monthly_title | Monthly partners |
| monthly_text | Committed monthly support is the backbone of the work — it funds the language years, the on-the-ground serving, and the long horizon this region requires. |
| project_title | Project gifts |
| project_text | One-time gifts toward equipment, travel, and gathering costs as specific needs arise. |
| legal_note | Thauma is a Missouri nonprofit in formation. Until federal tax-exempt status is granted, gifts are not yet tax-deductible — we will say so plainly here the moment that changes. |
| form_placeholder | Our secure giving form will live here. |

| Key | HR (new) |
|---|---|
| cue | Partnerstvo s nama |
| h2_thin | Ovaj posao počiva na |
| h2_bold | partnerstvu. |
| lede | Thauma se financira potporom u misijskoj tradiciji: crkve kojima služimo nisu te koje nose trošak — nose ga partneri. Darovi ovdje stavljaju stručnu pomoć uz timove koji do nje inače ne mogu doći. |
| monthly_title | Mjesečni partneri |
| monthly_text | Redovita mjesečna potpora kralježnica je ovoga posla — ona financira godine učenja jezika, služenje na terenu i dugi horizont koji ova regija traži. |
| project_title | Projektni darovi |
| project_text | Jednokratni darovi za opremu, putovanja i troškove okupljanja kad se pojave konkretne potrebe. |
| legal_note | Thauma je neprofitna organizacija u osnivanju (Missouri, SAD). Dok savezni status porezne izuzetosti ne bude odobren, darovi još nisu porezno priznati u SAD-u — ovdje ćemo to jasno objaviti čim se promijeni. |
| form_placeholder | Ovdje će se nalaziti naš sigurni obrazac za darivanje. |

---

## 4. TAGLINE RELOCATION

- `footer.tagline` (both languages): replace with `θαῦμα · wonder`
  (EN) / `θαῦμα · čudo` (HR). The phrase "All of me for all of Him"
  is the FOUNDER'S personal vow, not an organizational slogan.
- Add it to the founder's Team bio instead: append to
  `src/content/team/chase-roush.md` bio.en: "His personal vow:
  all of me for all of Him." / bio.hr: "Njegov osobni zavjet:
  sav ja — za svega Njega."
- Also sweep: `home.cta_h2_*` previously carried "All of it for all
  of Him" — already replaced by §1 above. Grep both i18n files for
  any remaining "for all of Him" / "za svega Njega" occurrences and
  remove/relocate per this rule.

---

## 5. VERIFY

- `npm run build` passes; spot-check /en/ and /hr/ homepage, values,
  give pages render the new copy.
- Values page ORDER IS UNCHANGED from the current live order (person,
  door, community, multiplication, whole church, assimilation, God) —
  BOTH title and text changed for all seven; array position did not.
- Both languages' titles read in sequence as one connected set (short,
  declarative, each ending on a strong final word) — spot check this
  reads smoothly, not as seven disconnected labels.
- Grep confirms no remaining "free"/"besplatno" cost-advertising in
  home/give copy, and no "for all of Him" outside the founder bio.
- Both languages updated in the SAME commit (CLAUDE.md rule 1).
