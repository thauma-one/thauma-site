/* ============================================================
   staff-i18n.js — the console's own interface, translated
   ============================================================
   Not the same thing as milestone translations. Those are CONTENT
   a partner writes and publishes; this is the furniture around it.
   A Croatian staff member should be able to read the buttons.

   APPLIED IN THE BROWSER, not at build time. The console is one
   set of pages served to everyone, and which language you get is
   a property of your account rather than of the URL — building
   /staff/hr/ and /staff/sr/ would triple the pages and put the
   language in a place people could share and land on someone
   else's preference.

   The language is cached in localStorage so it applies on the
   first paint. Without that the console renders in English and
   then visibly rewrites itself once the account loads, which
   looks like a fault.

   TRANSLATIONS ARE ROUGH. Written to prove the mechanism and to
   make it obvious which language is active — Serbian is in
   Cyrillic for exactly that reason. They want a real pass from
   someone who speaks these languages before anyone relies on them.
   ============================================================ */
(function () {
  'use strict';

  var STRINGS = {
    en: {
      "common.loading": "Loading…",
      "common.saving": "Saving…",
      "common.cancel": "Cancel",
      "common.copy": "Copy",
      "common.signedIn": "Signed in",
      "dash.stewardship": "Stewardship",
      "dash.staleNote": "people overdue a personal contact",
      "dash.support": "Support",
      "dash.goalNote": "of the monthly goal",
      "dash.directory": "Directory",
      "dash.contactsNote": "network contacts",
      "dash.foot": "Dashboard, Support, Stewardship and Activity read <code>/api/staff-snapshot</code>, which runs the named queries in <code>db/queries.sql</code> against the operations database and returns only the rows your account has been granted.",
      "dash.needsAttention": "Needs attention",
      "dash.supporters": "Supporters",
      "dash.newsletterOptin": "Newsletter opt-in",
      "dash.personalTouches": "Personal touches",
      "stew.person": "Person",
      "stew.lastPersonal": "Last personal contact",
      "stew.lastAny": "Last contact (any)",
      "stew.consent": "Consent",
      "stew.touches": "Touches",
      "stew.note": "<b>Newsletters do not count as personal contact.</b> A bulk send is contact, but it is not a conversation — and a dashboard that conflates the two reports everyone as looked after when nobody has been called in months.",
      "sup.note": "<b>This holds no donor records.</b> Only four numbers per goal — raised, donor count, source and captured-at — pulled from the giving platform. Donor detail lives there, and a partner reads their own by logging into it directly.",
      "act.note": "Whoever holds the database credentials can read the database — no schema prevents that. What a schema <b>can</b> do is make access deliberate, logged, and visible to the partner whose data it is. <code>audit_log</code> is append-only, enforced by triggers.",
      "dir.add": "+ Add contact",
      "dir.name": "Name",
      "dir.role": "Role (optional)",
      "dir.emails": "Emails",
      "dir.addEmail": "+ Add email",
      "dir.phones": "Phone numbers",
      "dir.addPhone": "+ Add phone",
      "dir.save": "Save contact",
      "dir.empty": "No contacts yet.",
      "res.add": "+ Add resource",
      "res.title": "Title",
      "res.description": "Description (optional)",
      "res.link": "Link — https://… (optional)",
      "res.photo": "Photo URL or /img/… path (optional)",
      "res.save": "Save resource",
      "res.empty": "No resources yet.",
      "res.open": "Open →",
      "ms.publishedLeave": "<b>Published entries leave this building.</b> Anything switched to Published is served to partner websites through the public API and can be read by anyone. New milestones start unpublished.",
      "ms.freeText": "free text",
      "ms.orderingOnly": "for ordering only",
      "ms.percent": "percent",
      "ms.optional": "optional",
      "ms.topLevel": "— top level —",
      "ms.upcoming": "Upcoming",
      "ms.inProgress": "In progress",
      "ms.complete": "Complete",
      "ms.cancelled": "Cancelled",
      "ms.applyNote": "Applies to the list — save to publish",
      "ms.empty": "No milestones yet. Add one and it will stay unpublished until you switch it on.",
      "ms.draft": "not published",
      "ms.unsaved": "unsaved",
      "ms.featuredBadge": "featured",
      "ms.missing": "missing",
      "ms.untitled": "(untitled)",
      "set.keysNote": "An API key lets a partner website read your <b>published</b> milestones and goal totals at build time. It can read nothing else — no contacts, no interactions, no drafts.",
      "set.keyPlaceholder": "What is this key for? e.g. chaseroush.com build",
      "set.keyRevealTitle": "Copy this now — it cannot be shown again",
      "set.keyRevealNote": "Store it in the partner site's build environment as <code>THAUMA_API_KEY</code>. Never in a repository, and never in client-side JavaScript.",
      "set.publicWarn": "<b>Everything below changes what partner websites serve.</b> A language switched on here is offered to visitors; one switched off disappears from the public API. Translations you have already written are kept either way.",
      "set.keysEmpty": "No API keys yet.",
      "set.revoke": "Revoke",
      "set.revoked": "revoked",
      "set.defaultLangNote": "the default language — cannot be switched off",
      "err.unreachable": "Cannot reach the server. Check your connection.",
      "err.unreadable": "The server sent a reply this page could not read.",
      "err.expired": "Your session has expired. Reload the page to sign in again.",
      "err.refused": "The server refused this request",
      "err.renderFailed": "This page failed to display",
      "err.noPartner": "This account has no partner access yet.",
      "err.tryAgain": "Try again",
      "err.nameKeyFirst": "Give the key a name first",
      'mark.staff': 'STAFF',
      'set.accessNote': 'What this account is allowed to do. Changed by an administrator.',
      'set.identityNote': 'Your sign-in is managed by Cloudflare Access. Changing your email address or password is done there, not here.',
      'set.yourLanguageDesc': 'Translates this console and opens the milestone editor in the same language.',
      'set.publishedDesc': "Switch a language on to translate into it and serve it on partner sites. The site's default language cannot be switched off.",
      'set.yourLanguageNote': 'Affects only you. It changes nothing a visitor sees, whatever your role.',

      'page.index.title': 'Dashboard',
      'page.index.heading': 'Where things <b>stand</b>',
      'page.support.title': 'Support',
      'page.support.heading': 'Goals and <b>progress</b>',
      'page.support.hint': 'aggregates only — no donor records held',
      'page.stewardship.title': 'Stewardship',
      'page.stewardship.heading': 'Who needs a <b>call</b>',
      'page.stewardship.hint': 'supporters — sorted worst first, click a row for history',
      'page.milestones.title': 'Milestones',
      'page.milestones.heading': 'The public <b>roadmap</b>',
      'page.milestones.hint': 'what partner sites show — published entries are visible to anyone',
      'page.directory.title': 'Directory',
      'page.resources.title': 'Resources',
      'page.activity.title': 'Activity',
      'page.activity.heading': 'Who looked at <b>what</b>',
      'page.activity.hint': 'visible to the partner, not just to admins',
      'page.settings.title': 'Settings',
      'page.settings.heading': 'How this <b>works</b>',
      'page.settings.hint': 'some of these change what the public sees',

      'nav.dashboard': 'Dashboard', 'nav.support': 'Support',
      'nav.stewardship': 'Stewardship', 'nav.milestones': 'Milestones',
      'nav.directory': 'Directory', 'nav.resources': 'Resources',
      'nav.activity': 'Activity', 'nav.settings': 'Settings',
      'nav.signout': 'Sign out',

      'ms.add': 'Add milestone', 'ms.apply': 'Apply', 'ms.cancel': 'Cancel',
      'ms.save': 'Save changes', 'ms.discard': 'Discard',
      'ms.published': 'Published', 'ms.publishedNote': 'Visible on partner websites',
      'ms.featured': 'Featured', 'ms.featuredNote': 'Highlighted on their home page',
      'ms.title': 'Title', 'ms.description': 'Description', 'ms.when': 'When',
      'ms.sortDate': 'Sort date', 'ms.status': 'Status',
      'ms.completion': 'Completion', 'ms.partOf': 'Part of',
      'ms.notLive': 'Nothing is live until you save.',
      'ms.edit': 'Edit', 'ms.delete': 'Delete',

      'set.account': 'Account', 'set.languages': 'Languages', 'set.keys': 'API keys',
      'set.signedInAs': 'Signed in as', 'set.yourAccess': 'Your access',
      'set.yourLanguage': 'Your language',
      'set.publishedLanguages': 'Published languages',
      'toast.langChanged': 'Language changed',
      'toast.saved': 'Saved',
      'toast.published': 'Published — now visible on partner sites',
      'toast.unpublished': 'Unpublished',
      'toast.added': 'Milestone added',
      'toast.updated': 'Milestone updated',
      'toast.deleted': 'Deleted',
      'toast.discarded': 'Changes discarded',
      'toast.keyCreated': 'Key created',
      'toast.keyRevoked': 'Key revoked',
      'toast.copied': 'Copied',
      'set.createKey': 'Create key'
    },

    hr: {
      "common.loading": "Učitavanje…",
      "common.saving": "Spremanje…",
      "common.cancel": "Odustani",
      "common.copy": "Kopiraj",
      "common.signedIn": "Prijavljeni",
      "dash.stewardship": "Skrb",
      "dash.staleNote": "osoba koje čekaju osobni kontakt",
      "dash.support": "Podrška",
      "dash.goalNote": "mjesečnog cilja",
      "dash.directory": "Imenik",
      "dash.contactsNote": "kontakti u mreži",
      "dash.foot": "Nadzorna ploča, Podrška, Skrb i Aktivnost čitaju <code>/api/staff-snapshot</code>, koji izvodi imenovane upite iz <code>db/queries.sql</code> nad operativnom bazom i vraća samo retke koje vaš račun smije vidjeti.",
      "dash.needsAttention": "Treba pažnju",
      "dash.supporters": "Podupiratelji",
      "dash.newsletterOptin": "Pristanak na newsletter",
      "dash.personalTouches": "Osobni kontakti",
      "stew.person": "Osoba",
      "stew.lastPersonal": "Zadnji osobni kontakt",
      "stew.lastAny": "Zadnji kontakt (bilo koji)",
      "stew.consent": "Pristanak",
      "stew.touches": "Kontakti",
      "stew.note": "<b>Newsletteri se ne računaju kao osobni kontakt.</b> Masovna poruka jest kontakt, ali nije razgovor — a nadzorna ploča koja to miješa prikazuje sve kao zbrinute iako nitko nije nazvan mjesecima.",
      "sup.note": "<b>Ovdje se ne čuvaju podaci o donatorima.</b> Samo četiri broja po cilju — prikupljeno, broj donatora, izvor i vrijeme — preuzeta s platforme za donacije. Detalji o donatorima su ondje.",
      "act.note": "Tko ima pristupne podatke baze može čitati bazu — nijedna shema to ne sprječava. Ono što shema <b>može</b> jest učiniti pristup namjernim, zabilježenim i vidljivim partneru čiji su podaci. <code>audit_log</code> je samo za dodavanje.",
      "dir.add": "+ Dodaj kontakt",
      "dir.name": "Ime",
      "dir.role": "Uloga (nije obavezno)",
      "dir.emails": "E-adrese",
      "dir.addEmail": "+ Dodaj e-adresu",
      "dir.phones": "Telefonski brojevi",
      "dir.addPhone": "+ Dodaj telefon",
      "dir.save": "Spremi kontakt",
      "dir.empty": "Još nema kontakata.",
      "res.add": "+ Dodaj resurs",
      "res.title": "Naslov",
      "res.description": "Opis (nije obavezno)",
      "res.link": "Poveznica — https://… (nije obavezno)",
      "res.photo": "URL slike ili /img/… putanja (nije obavezno)",
      "res.save": "Spremi resurs",
      "res.empty": "Još nema resursa.",
      "res.open": "Otvori →",
      "ms.publishedLeave": "<b>Objavljene stavke napuštaju ovu kuću.</b> Sve što je označeno kao objavljeno šalje se partnerskim stranicama putem javnog API-ja i može ga pročitati bilo tko. Nove prekretnice počinju neobjavljene.",
      "ms.freeText": "slobodan tekst",
      "ms.orderingOnly": "samo za redoslijed",
      "ms.percent": "posto",
      "ms.optional": "nije obavezno",
      "ms.topLevel": "— najviša razina —",
      "ms.upcoming": "Nadolazeće",
      "ms.inProgress": "U tijeku",
      "ms.complete": "Završeno",
      "ms.cancelled": "Otkazano",
      "ms.applyNote": "Primjenjuje se na popis — spremite za objavu",
      "ms.empty": "Još nema prekretnica. Dodajte jednu i ostat će neobjavljena dok je ne uključite.",
      "ms.draft": "nije objavljeno",
      "ms.unsaved": "nespremljeno",
      "ms.featuredBadge": "istaknuto",
      "ms.missing": "nedostaje",
      "ms.untitled": "(bez naslova)",
      "set.keysNote": "API ključ omogućuje partnerskoj stranici čitanje vaših <b>objavljenih</b> prekretnica i ukupnih iznosa ciljeva. Ne može čitati ništa drugo — ni kontakte, ni interakcije, ni nacrte.",
      "set.keyPlaceholder": "Čemu služi ovaj ključ? npr. izrada chaseroush.com",
      "set.keyRevealTitle": "Kopirajte sada — više se neće prikazati",
      "set.keyRevealNote": "Spremite ga u okruženje za izradu partnerske stranice kao <code>THAUMA_API_KEY</code>. Nikad u repozitorij i nikad u JavaScript na strani preglednika.",
      "set.publicWarn": "<b>Sve ispod mijenja ono što partnerske stranice poslužuju.</b> Uključen jezik nudi se posjetiteljima; isključen nestaje iz javnog API-ja. Već napisani prijevodi ostaju u oba slučaja.",
      "set.keysEmpty": "Još nema API ključeva.",
      "set.revoke": "Opozovi",
      "set.revoked": "opozvano",
      "set.defaultLangNote": "zadani jezik — ne može se isključiti",
      "err.unreachable": "Nije moguće doseći poslužitelj. Provjerite vezu.",
      "err.unreadable": "Poslužitelj je poslao odgovor koji ova stranica ne može pročitati.",
      "err.expired": "Vaša sesija je istekla. Ponovno učitajte stranicu za prijavu.",
      "err.refused": "Poslužitelj je odbio ovaj zahtjev",
      "err.renderFailed": "Ova stranica se nije uspjela prikazati",
      "err.noPartner": "Ovaj račun još nema pristup partneru.",
      "err.tryAgain": "Pokušaj ponovno",
      "err.nameKeyFirst": "Prvo imenujte ključ",
      'mark.staff': 'OSOBLJE',
      'set.accessNote': 'Što ovaj račun smije raditi. Mijenja administrator.',
      'set.identityNote': 'Vašom prijavom upravlja Cloudflare Access. Promjena e-pošte ili lozinke radi se ondje, ne ovdje.',
      'set.yourLanguageDesc': 'Prevodi ovu konzolu i otvara uređivač prekretnica na istom jeziku.',
      'set.publishedDesc': 'Uključite jezik da biste prevodili na njega i objavili ga na partnerskim stranicama. Zadani jezik stranice ne može se isključiti.',
      'set.yourLanguageNote': 'Utječe samo na vas. Ne mijenja ništa što posjetitelj vidi, bez obzira na vašu ulogu.',

      'page.index.title': 'Nadzorna ploča',
      'page.index.heading': 'Kako <b>stojimo</b>',
      'page.support.title': 'Podrška',
      'page.support.heading': 'Ciljevi i <b>napredak</b>',
      'page.support.hint': 'samo zbirni podaci — ne čuvaju se podaci o donatorima',
      'page.stewardship.title': 'Skrb',
      'page.stewardship.heading': 'Tko treba <b>poziv</b>',
      'page.stewardship.hint': 'podupiratelji — najhitniji prvi, kliknite red za povijest',
      'page.milestones.title': 'Prekretnice',
      'page.milestones.heading': 'Javni <b>plan</b>',
      'page.milestones.hint': 'ono što partnerske stranice prikazuju — objavljeno je vidljivo svima',
      'page.directory.title': 'Imenik',
      'page.resources.title': 'Resursi',
      'page.activity.title': 'Aktivnost',
      'page.activity.heading': 'Tko je što <b>gledao</b>',
      'page.activity.hint': 'vidljivo partneru, ne samo administratorima',
      'page.settings.title': 'Postavke',
      'page.settings.heading': 'Kako ovo <b>radi</b>',
      'page.settings.hint': 'neke od ovih mijenjaju ono što javnost vidi',

      'nav.dashboard': 'Nadzorna ploča', 'nav.support': 'Podrška',
      'nav.stewardship': 'Skrb', 'nav.milestones': 'Prekretnice',
      'nav.directory': 'Imenik', 'nav.resources': 'Resursi',
      'nav.activity': 'Aktivnost', 'nav.settings': 'Postavke',
      'nav.signout': 'Odjava',

      'ms.add': 'Dodaj prekretnicu', 'ms.apply': 'Primijeni', 'ms.cancel': 'Odustani',
      'ms.save': 'Spremi promjene', 'ms.discard': 'Odbaci',
      'ms.published': 'Objavljeno', 'ms.publishedNote': 'Vidljivo na partnerskim stranicama',
      'ms.featured': 'Istaknuto', 'ms.featuredNote': 'Istaknuto na naslovnici',
      'ms.title': 'Naslov', 'ms.description': 'Opis', 'ms.when': 'Kada',
      'ms.sortDate': 'Datum za redoslijed', 'ms.status': 'Status',
      'ms.completion': 'Dovršenost', 'ms.partOf': 'Dio čega',
      'ms.notLive': 'Ništa nije objavljeno dok ne spremite.',
      'ms.edit': 'Uredi', 'ms.delete': 'Obriši',

      'set.account': 'Račun', 'set.languages': 'Jezici', 'set.keys': 'API ključevi',
      'set.signedInAs': 'Prijavljeni kao', 'set.yourAccess': 'Vaš pristup',
      'set.yourLanguage': 'Vaš jezik',
      'set.publishedLanguages': 'Objavljeni jezici',
      'toast.langChanged': 'Jezik promijenjen',
      'toast.saved': 'Spremljeno',
      'toast.published': 'Objavljeno — sada vidljivo na partnerskim stranicama',
      'toast.unpublished': 'Objava uklonjena',
      'toast.added': 'Prekretnica dodana',
      'toast.updated': 'Prekretnica ažurirana',
      'toast.deleted': 'Obrisano',
      'toast.discarded': 'Promjene odbačene',
      'toast.keyCreated': 'Ključ stvoren',
      'toast.keyRevoked': 'Ključ opozvan',
      'toast.copied': 'Kopirano',
      'set.createKey': 'Stvori ključ'
    },

    sr: {
      "common.loading": "Учитавање…",
      "common.saving": "Чување…",
      "common.cancel": "Откажи",
      "common.copy": "Копирај",
      "common.signedIn": "Пријављени",
      "dash.stewardship": "Брига",
      "dash.staleNote": "особа које чекају лични контакт",
      "dash.support": "Подршка",
      "dash.goalNote": "месечног циља",
      "dash.directory": "Именик",
      "dash.contactsNote": "контакти у мрежи",
      "dash.foot": "Контролна табла, Подршка, Брига и Активност читају <code>/api/staff-snapshot</code>, који извршава именоване упите из <code>db/queries.sql</code> над оперативном базом и враћа само редове које ваш налог сме да види.",
      "dash.needsAttention": "Треба пажњу",
      "dash.supporters": "Подржаваоци",
      "dash.newsletterOptin": "Пристанак на билтен",
      "dash.personalTouches": "Лични контакти",
      "stew.person": "Особа",
      "stew.lastPersonal": "Последњи лични контакт",
      "stew.lastAny": "Последњи контакт (било који)",
      "stew.consent": "Пристанак",
      "stew.touches": "Контакти",
      "stew.note": "<b>Билтени се не рачунају као лични контакт.</b> Масовна порука јесте контакт, али није разговор — а контролна табла која то меша приказује све као збринуте иако нико није позван месецима.",
      "sup.note": "<b>Овде се не чувају подаци о донаторима.</b> Само четири броја по циљу — прикупљено, број донатора, извор и време — преузета са платформе за донације. Детаљи о донаторима су тамо.",
      "act.note": "Ко има приступне податке базе може читати базу — ниједна шема то не спречава. Оно што шема <b>може</b> јесте учинити приступ намерним, забележеним и видљивим партнеру чији су подаци. <code>audit_log</code> је само за додавање.",
      "dir.add": "+ Додај контакт",
      "dir.name": "Име",
      "dir.role": "Улога (није обавезно)",
      "dir.emails": "Е-адресе",
      "dir.addEmail": "+ Додај е-адресу",
      "dir.phones": "Телефонски бројеви",
      "dir.addPhone": "+ Додај телефон",
      "dir.save": "Сачувај контакт",
      "dir.empty": "Још нема контаката.",
      "res.add": "+ Додај ресурс",
      "res.title": "Наслов",
      "res.description": "Опис (није обавезно)",
      "res.link": "Веза — https://… (није обавезно)",
      "res.photo": "URL слике или /img/… путања (није обавезно)",
      "res.save": "Сачувај ресурс",
      "res.empty": "Још нема ресурса.",
      "res.open": "Отвори →",
      "ms.publishedLeave": "<b>Објављене ставке напуштају ову кућу.</b> Све што је означено као објављено шаље се партнерским сајтовима преко јавног API-ја и може га прочитати било ко. Нове прекретнице почињу необјављене.",
      "ms.freeText": "слободан текст",
      "ms.orderingOnly": "само за редослед",
      "ms.percent": "проценат",
      "ms.optional": "није обавезно",
      "ms.topLevel": "— највиши ниво —",
      "ms.upcoming": "Предстојеће",
      "ms.inProgress": "У току",
      "ms.complete": "Завршено",
      "ms.cancelled": "Отказано",
      "ms.applyNote": "Примењује се на списак — сачувајте за објаву",
      "ms.empty": "Још нема прекретница. Додајте једну и остаће необјављена док је не укључите.",
      "ms.draft": "није објављено",
      "ms.unsaved": "несачувано",
      "ms.featuredBadge": "истакнуто",
      "ms.missing": "недостаје",
      "ms.untitled": "(без наслова)",
      "set.keysNote": "API кључ омогућава партнерском сајту читање ваших <b>објављених</b> прекретница и укупних износа циљева. Не може читати ништа друго — ни контакте, ни интеракције, ни нацрте.",
      "set.keyPlaceholder": "Чему служи овај кључ? нпр. израда chaseroush.com",
      "set.keyRevealTitle": "Копирајте сада — више се неће приказати",
      "set.keyRevealNote": "Сачувајте га у окружење за израду партнерског сајта као <code>THAUMA_API_KEY</code>. Никад у репозиторијум и никад у JavaScript на страни прегледача.",
      "set.publicWarn": "<b>Све испод мења оно што партнерски сајтови служе.</b> Укључен језик нуди се посетиоцима; искључен нестаје из јавног API-ја. Већ написани преводи остају у оба случаја.",
      "set.keysEmpty": "Још нема API кључева.",
      "set.revoke": "Опозови",
      "set.revoked": "опозвано",
      "set.defaultLangNote": "подразумевани језик — не може се искључити",
      "err.unreachable": "Није могуће доћи до сервера. Проверите везу.",
      "err.unreadable": "Сервер је послао одговор који ова страница не може прочитати.",
      "err.expired": "Ваша сесија је истекла. Поново учитајте страницу за пријаву.",
      "err.refused": "Сервер је одбио овај захтев",
      "err.renderFailed": "Ова страница није успела да се прикаже",
      "err.noPartner": "Овај налог још нема приступ партнеру.",
      "err.tryAgain": "Покушај поново",
      "err.nameKeyFirst": "Прво именујте кључ",
      'mark.staff': 'ОСОБЉЕ',
      'set.accessNote': 'Шта овај налог сме да ради. Мења администратор.',
      'set.identityNote': 'Вашом пријавом управља Cloudflare Access. Промена е-поште или лозинке ради се тамо, не овде.',
      'set.yourLanguageDesc': 'Преводи ову конзолу и отвара уређивач прекретница на истом језику.',
      'set.publishedDesc': 'Укључите језик да бисте преводили на њега и објавили га на партнерским сајтовима. Подразумевани језик сајта не може се искључити.',
      'set.yourLanguageNote': 'Утиче само на вас. Не мења ништа што посетилац види, без обзира на вашу улогу.',

      'page.index.title': 'Контролна табла',
      'page.index.heading': 'Како <b>стојимо</b>',
      'page.support.title': 'Подршка',
      'page.support.heading': 'Циљеви и <b>напредак</b>',
      'page.support.hint': 'само збирни подаци — не чувају се подаци о донаторима',
      'page.stewardship.title': 'Брига',
      'page.stewardship.heading': 'Коме треба <b>позив</b>',
      'page.stewardship.hint': 'подржаваоци — најхитнији први, кликните ред за историју',
      'page.milestones.title': 'Прекретнице',
      'page.milestones.heading': 'Јавни <b>план</b>',
      'page.milestones.hint': 'оно што партнерски сајтови приказују — објављено је видљиво свима',
      'page.directory.title': 'Именик',
      'page.resources.title': 'Ресурси',
      'page.activity.title': 'Активност',
      'page.activity.heading': 'Ко је шта <b>гледао</b>',
      'page.activity.hint': 'видљиво партнеру, не само администраторима',
      'page.settings.title': 'Подешавања',
      'page.settings.heading': 'Како ово <b>ради</b>',
      'page.settings.hint': 'неке од ових мењају оно што јавност види',

      'nav.dashboard': 'Контролна табла', 'nav.support': 'Подршка',
      'nav.stewardship': 'Брига', 'nav.milestones': 'Прекретнице',
      'nav.directory': 'Именик', 'nav.resources': 'Ресурси',
      'nav.activity': 'Активност', 'nav.settings': 'Подешавања',
      'nav.signout': 'Одјава',

      'ms.add': 'Додај прекретницу', 'ms.apply': 'Примени', 'ms.cancel': 'Откажи',
      'ms.save': 'Сачувај измене', 'ms.discard': 'Одбаци',
      'ms.published': 'Објављено', 'ms.publishedNote': 'Видљиво на партнерским сајтовима',
      'ms.featured': 'Истакнуто', 'ms.featuredNote': 'Истакнуто на почетној страни',
      'ms.title': 'Наслов', 'ms.description': 'Опис', 'ms.when': 'Када',
      'ms.sortDate': 'Датум за редослед', 'ms.status': 'Статус',
      'ms.completion': 'Довршеност', 'ms.partOf': 'Део чега',
      'ms.notLive': 'Ништа није објављено док не сачувате.',
      'ms.edit': 'Измени', 'ms.delete': 'Обриши',

      'set.account': 'Налог', 'set.languages': 'Језици', 'set.keys': 'API кључеви',
      'set.signedInAs': 'Пријављени као', 'set.yourAccess': 'Ваш приступ',
      'set.yourLanguage': 'Ваш језик',
      'set.publishedLanguages': 'Објављени језици',
      'toast.langChanged': 'Језик промењен',
      'toast.saved': 'Сачувано',
      'toast.published': 'Објављено — сада видљиво на партнерским сајтовима',
      'toast.unpublished': 'Објава уклоњена',
      'toast.added': 'Прекретница додата',
      'toast.updated': 'Прекретница ажурирана',
      'toast.deleted': 'Обрисано',
      'toast.discarded': 'Промене одбачене',
      'toast.keyCreated': 'Кључ направљен',
      'toast.keyRevoked': 'Кључ опозван',
      'toast.copied': 'Копирано',
      'set.createKey': 'Направи кључ'
    }
  };

  var CACHE = 'thauma.staff.lang';
  var current = 'en';

  try { current = localStorage.getItem(CACHE) || 'en'; } catch (e) {}

  function t(key) {
    var table = STRINGS[current] || STRINGS.en;
    // Falls back to English rather than showing the key. A missing string
    // should read as an untranslated interface, not a broken one.
    return table[key] || STRINGS.en[key] || key;
  }

  /* Walks the page and replaces anything tagged. Elements keep their English
     text in the markup, so the console is readable with JavaScript disabled
     and legible in the source. */
  function apply(root) {
    var scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      var val = t(el.dataset.i18n);
      if (val) el.textContent = val;
    });

    // Headings carry markup — "How this <b>works</b>" — and textContent would
    // flatten it. innerHTML is safe HERE and only here: every one of these
    // strings is a literal in this file, never anything a user typed.
    scope.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var val = t(el.dataset.i18nHtml);
      if (val) el.innerHTML = val;
    });

    // ATTRIBUTES PEOPLE READ. Placeholders were missed entirely on the first
    // pass — a text box is not translated just because its label is, and a
    // placeholder is often the only instruction a field has. aria-label and
    // title are here for the same reason: a screen reader user gets the
    // untranslated string otherwise.
    scope.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      // "placeholder:key" or "placeholder:key,aria-label:other"
      el.dataset.i18nAttr.split(',').forEach(function (pair) {
        var bits = pair.split(':');
        if (bits.length !== 2) return;
        var val = t(bits[1].trim());
        if (val) el.setAttribute(bits[0].trim(), val);
      });
    });

    document.documentElement.setAttribute('lang', current);
  }

  function setLang(code) {
    if (!code || !STRINGS[code]) return;
    current = code;
    try { localStorage.setItem(CACHE, code); } catch (e) {}
    apply();
  }

  window.StaffI18n = { t: t, apply: apply, setLang: setLang,
                       get lang() { return current; },
                       available: Object.keys(STRINGS) };

  apply();
})();
