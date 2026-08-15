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
