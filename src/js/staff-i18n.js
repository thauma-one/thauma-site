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
      'set.createKey': 'Create key'
    },

    hr: {
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
      'set.createKey': 'Stvori ključ'
    },

    sr: {
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
    (root || document).querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.dataset.i18n;
      var val = t(key);
      if (val) el.textContent = val;
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
