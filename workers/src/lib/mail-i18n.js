/**
 * mail-i18n.js — the words a SUPPORTER reads that Thauma writes, not a person
 *
 * WHICH WORDS, AND WHY ONLY THESE. Confirming a subscription, the receipt for
 * the contact form, the unsubscribe pages — and the fixed labels, messages and
 * errors of the sign-up and contact forms that sit on partners' websites
 * (form.* and contact.*). They go to people who never asked for an account and
 * may not read English — a Croatian supporter confirming a Croatian ministry's
 * list in English is a worse experience and a worse conversion.
 *
 * EVERY LANGUAGE THE PUBLIC SITE OFFERS, not only the console's. Chase,
 * 2026-09-26: everything a visitor can read must be translatable, while the
 * console may lag behind. So Slovenian is here although the console has none.
 *
 * WHAT A PARTNER TYPED IS NOT HERE. A form's own heading, button and thank-you
 * line, when the partner set them, are theirs; these are only the defaults
 * used when they did not.
 *
 * THE STAFF ONES ARE DELIBERATELY ABSENT. Invitations and address changes go
 * to a handful of people who are about to use a console that has its own
 * language switcher. Translating them is work with almost nobody on the other
 * end of it, and it can be added here later without changing anything else.
 *
 * NOT THE NEWSLETTER. A mailing is written by a person in whatever language
 * they wrote it; there is nothing here to translate and nothing that should
 * try.
 *
 * THE TRANSLATIONS ARE ROUGH, and that is a deliberate first pass — Chase
 * asked for rough. They are worth a read by somebody who speaks these before
 * they meet a real supporter. What is NOT rough is the shape: one table, three
 * languages, every key present in all of them, which is what a proper pass
 * needs in order to be a proper pass rather than a rewrite.
 *
 * FALLBACK IS ENGLISH, ONE KEY AT A TIME. A missing Croatian string yields the
 * English one rather than nothing, so a half-finished translation degrades to
 * a mixed message instead of a blank.
 */
const STRINGS = {
  en: {
    "confirm.subject": "Confirm your {list} subscription",
    "confirm.heading": "Confirm your subscription",
    "confirm.hello": "Hi {name},",
    "confirm.helloAnon": "Hello,",
    "confirm.body": "Please confirm you would like to receive <b>{list}</b> from {from}.",
    "confirm.button": "Yes, subscribe me",
    "confirm.ignore": "If you did not ask for this, ignore this message. Nothing will be sent to you unless you confirm.",

    "receipt.subject": "We have your message",
    "receipt.heading": "We have your message",
    "receipt.body": "Thank you for writing to {ministry}. This is just to say it arrived — somebody will read it and reply to this address.",
    "receipt.noReply": "You do not need to do anything. If you think of something to add, send it through the form again — this address does not receive replies.",
    "receipt.footer": "You are receiving this because this address was used to write to {ministry} through their website. No account was created and you have not been added to any mailing list.",

    "unsub.title": "Unsubscribed",
    "unsub.heading": "You are unsubscribed",
    "unsub.body": "You will not receive any more of these.",
    "unsub.undo": "That was a mistake — put me back on",
    "back.title": "Subscribed again",
    "back.heading": "You are back on the list",
    "back.body": "Nothing was lost — you will receive the next one as usual.",
    "back.undo": "Actually, unsubscribe me",

    "form.name": "Your name",
    "form.email": "Email address",
    "form.receive": "I want to receive",
    "form.fine": "You can unsubscribe at any time.",
    "form.chooseOne": "Choose at least one thing to receive.",
    "form.sending": "Sending…",
    "form.failed": "Something went wrong. Please try again.",
    "form.checkEmail": "Check your email",
    "form.linkSent": "We sent you a confirmation link. Click it and you are on the list.",
    "form.heading": "Stay in touch",
    "form.button": "Subscribe",

    "contact.heading": "Get in touch",
    "contact.button": "Send",
    "contact.thanks": "Thank you — your message is on its way.",
    "contact.about": "What is this about",
    "contact.choose": "Choose one…",
    "contact.subject": "Subject",
    "contact.subjectHint": "A few words about it",
    "contact.message": "Message",
    "contact.messageHint": "What would you like to say?",
    "contact.failed": "Your message could not be sent. Please try again.",
    "contact.errForm": "Please fill the form in and try again.",
    "contact.errName": "Please add your name.",
    "contact.errEmail": "That does not look like an email address.",
    "contact.errMessage": "Please write a message.",
    "contact.errSetup": "This form is not finished being set up, so your message was not sent. Please try another way of getting in touch.",
    "contact.errSend": "Your message could not be sent just now. Please try again in a few minutes.",
  },

  hr: {
    "confirm.subject": "Potvrdite pretplatu na {list}",
    "confirm.heading": "Potvrdite pretplatu",
    "confirm.hello": "Bok {name},",
    "confirm.helloAnon": "Poštovani,",
    "confirm.body": "Molimo potvrdite da želite primati <b>{list}</b> od {from}.",
    "confirm.button": "Da, pretplati me",
    "confirm.ignore": "Ako ovo niste tražili, zanemarite ovu poruku. Ništa vam neće biti poslano ako ne potvrdite.",

    "receipt.subject": "Primili smo vašu poruku",
    "receipt.heading": "Primili smo vašu poruku",
    "receipt.body": "Hvala što ste pisali {ministry}. Ovo je samo potvrda da je poruka stigla — netko će je pročitati i odgovoriti na ovu adresu.",
    "receipt.noReply": "Ne morate ništa poduzimati. Ako se sjetite nečega što biste dodali, pošaljite to ponovno putem obrasca — ova adresa ne prima odgovore.",
    "receipt.footer": "Ovu poruku primate jer je ova adresa upotrijebljena za pisanje {ministry} putem njihove stranice. Nije stvoren nikakav račun i niste dodani ni na jedan popis za slanje.",

    "unsub.title": "Odjava",
    "unsub.heading": "Odjavljeni ste",
    "unsub.body": "Više nećete primati ove poruke.",
    "unsub.undo": "Ovo je bila pogreška — vratite me natrag",
    "back.title": "Ponovno pretplaćeni",
    "back.heading": "Ponovno ste na popisu",
    "back.body": "Ništa nije izgubljeno — sljedeću poruku primit ćete kao i obično.",
    "back.undo": "Ipak me odjavite",

    "form.name": "Vaše ime",
    "form.email": "Adresa e-pošte",
    "form.receive": "Želim primati",
    "form.fine": "Odjaviti se možete u bilo kojem trenutku.",
    "form.chooseOne": "Odaberite barem jedno što želite primati.",
    "form.sending": "Šaljem…",
    "form.failed": "Nešto nije u redu. Molimo pokušajte ponovno.",
    "form.checkEmail": "Provjerite e-poštu",
    "form.linkSent": "Poslali smo vam poveznicu za potvrdu. Kliknite je i na popisu ste.",
    "form.heading": "Ostanimo u kontaktu",
    "form.button": "Pretplati se",

    "contact.heading": "Javite nam se",
    "contact.button": "Pošalji",
    "contact.thanks": "Hvala — vaša je poruka na putu.",
    "contact.about": "O čemu se radi",
    "contact.choose": "Odaberite…",
    "contact.subject": "Naslov",
    "contact.subjectHint": "Nekoliko riječi o tome",
    "contact.message": "Poruka",
    "contact.messageHint": "Što nam želite poručiti?",
    "contact.failed": "Vašu poruku nije bilo moguće poslati. Molimo pokušajte ponovno.",
    "contact.errForm": "Molimo ispunite obrazac i pokušajte ponovno.",
    "contact.errName": "Molimo upišite svoje ime.",
    "contact.errEmail": "To ne izgleda kao adresa e-pošte.",
    "contact.errMessage": "Molimo napišite poruku.",
    "contact.errSetup": "Ovaj obrazac još nije do kraja postavljen pa vaša poruka nije poslana. Molimo javite nam se na drugi način.",
    "contact.errSend": "Vašu poruku trenutno nije moguće poslati. Molimo pokušajte ponovno za nekoliko minuta.",
  },

  sr: {
    "confirm.subject": "Потврдите претплату на {list}",
    "confirm.heading": "Потврдите претплату",
    "confirm.hello": "Здраво {name},",
    "confirm.helloAnon": "Поштовани,",
    "confirm.body": "Молимо потврдите да желите да примате <b>{list}</b> од {from}.",
    "confirm.button": "Да, претплати ме",
    "confirm.ignore": "Ако ово нисте тражили, занемарите ову поруку. Ништа вам неће бити послато ако не потврдите.",

    "receipt.subject": "Примили смо вашу поруку",
    "receipt.heading": "Примили смо вашу поруку",
    "receipt.body": "Хвала што сте писали {ministry}. Ово је само потврда да је порука стигла — неко ће је прочитати и одговорити на ову адресу.",
    "receipt.noReply": "Не морате ништа да предузимате. Ако се сетите нечега што бисте додали, пошаљите то поново преко обрасца — ова адреса не прима одговоре.",
    "receipt.footer": "Ову поруку примате јер је ова адреса употребљена за писање {ministry} преко њиховог сајта. Није направљен никакав налог и нисте додати ни на једну листу за слање.",

    "unsub.title": "Одјава",
    "unsub.heading": "Одјављени сте",
    "unsub.body": "Више нећете примати ове поруке.",
    "unsub.undo": "Ово је била грешка — вратите ме назад",
    "back.title": "Поново претплаћени",
    "back.heading": "Поново сте на листи",
    "back.body": "Ништа није изгубљено — следећу поруку примићете као и обично.",
    "back.undo": "Ипак ме одјавите",

    "form.name": "Ваше име",
    "form.email": "Имејл адреса",
    "form.receive": "Желим да примам",
    "form.fine": "Можете се одјавити у било ком тренутку.",
    "form.chooseOne": "Изаберите бар једну ствар коју желите да примате.",
    "form.sending": "Шаљем…",
    "form.failed": "Нешто није у реду. Молимо покушајте поново.",
    "form.checkEmail": "Проверите имејл",
    "form.linkSent": "Послали смо вам линк за потврду. Кликните на њега и на листи сте.",
    "form.heading": "Останимо у контакту",
    "form.button": "Претплати се",

    "contact.heading": "Јавите нам се",
    "contact.button": "Пошаљи",
    "contact.thanks": "Хвала — ваша порука је на путу.",
    "contact.about": "О чему се ради",
    "contact.choose": "Изаберите…",
    "contact.subject": "Наслов",
    "contact.subjectHint": "Неколико речи о томе",
    "contact.message": "Порука",
    "contact.messageHint": "Шта желите да нам поручите?",
    "contact.failed": "Вашу поруку није било могуће послати. Молимо покушајте поново.",
    "contact.errForm": "Молимо попуните образац и покушајте поново.",
    "contact.errName": "Молимо упишите своје име.",
    "contact.errEmail": "То не изгледа као имејл адреса.",
    "contact.errMessage": "Молимо напишите поруку.",
    "contact.errSetup": "Овај образац још није до краја подешен, па ваша порука није послата. Молимо јавите нам се на други начин.",
    "contact.errSend": "Вашу поруку тренутно није могуће послати. Молимо покушајте поново за неколико минута.",
  },

  sl: {
    "confirm.subject": "Potrdite naročnino na {list}",
    "confirm.heading": "Potrdite naročnino",
    "confirm.hello": "Pozdravljeni, {name},",
    "confirm.helloAnon": "Pozdravljeni,",
    "confirm.body": "Prosimo, potrdite, da želite od {from} prejemati <b>{list}</b>.",
    "confirm.button": "Da, naroči me",
    "confirm.ignore": "Če tega niste zahtevali, to sporočilo prezrite. Brez vaše potrditve vam ne bomo ničesar pošiljali.",

    "receipt.subject": "Vaše sporočilo smo prejeli",
    "receipt.heading": "Vaše sporočilo smo prejeli",
    "receipt.body": "Hvala, ker ste pisali ekipi {ministry}. S tem vam le sporočamo, da je sporočilo prispelo — nekdo ga bo prebral in odgovoril na ta naslov.",
    "receipt.noReply": "Ničesar vam ni treba storiti. Če se spomnite še česa, to ponovno pošljite prek obrazca — ta naslov ne sprejema odgovorov.",
    "receipt.footer": "To sporočilo ste prejeli, ker je bil ta naslov uporabljen za pisanje ekipi {ministry} prek njihove spletne strani. Račun ni bil ustvarjen in niste bili dodani na noben poštni seznam.",

    "unsub.title": "Odjava",
    "unsub.heading": "Odjavljeni ste",
    "unsub.body": "Teh sporočil ne boste več prejemali.",
    "unsub.undo": "To je bila pomota — ponovno me prijavite",
    "back.title": "Ponovno naročeni",
    "back.heading": "Spet ste na seznamu",
    "back.body": "Nič se ni izgubilo — naslednje sporočilo boste prejeli kot običajno.",
    "back.undo": "Vendarle me odjavite",

    "form.name": "Vaše ime",
    "form.email": "E-poštni naslov",
    "form.receive": "Želim prejemati",
    "form.fine": "Odjavite se lahko kadar koli.",
    "form.chooseOne": "Izberite vsaj eno stvar, ki jo želite prejemati.",
    "form.sending": "Pošiljam…",
    "form.failed": "Nekaj je šlo narobe. Prosimo, poskusite znova.",
    "form.checkEmail": "Preverite e-pošto",
    "form.linkSent": "Poslali smo vam povezavo za potrditev. Kliknite nanjo in ste na seznamu.",
    "form.heading": "Ostanimo v stiku",
    "form.button": "Naroči se",

    "contact.heading": "Pišite nam",
    "contact.button": "Pošlji",
    "contact.thanks": "Hvala — vaše sporočilo je na poti.",
    "contact.about": "O čem gre",
    "contact.choose": "Izberite…",
    "contact.subject": "Zadeva",
    "contact.subjectHint": "Nekaj besed o tem",
    "contact.message": "Sporočilo",
    "contact.messageHint": "Kaj bi nam radi sporočili?",
    "contact.failed": "Vašega sporočila ni bilo mogoče poslati. Prosimo, poskusite znova.",
    "contact.errForm": "Prosimo, izpolnite obrazec in poskusite znova.",
    "contact.errName": "Prosimo, vpišite svoje ime.",
    "contact.errEmail": "To ni videti kot e-poštni naslov.",
    "contact.errMessage": "Prosimo, napišite sporočilo.",
    "contact.errSetup": "Ta obrazec še ni povsem nastavljen, zato vaše sporočilo ni bilo poslano. Prosimo, stopite v stik z nami na drug način.",
    "contact.errSend": "Vašega sporočila trenutno ni mogoče poslati. Prosimo, poskusite znova čez nekaj minut.",
  },
};

/**
 * One string, in the best language available.
 *
 * `{name}` style placeholders are substituted here rather than by the caller,
 * so a key that gains a placeholder does not need every call site edited.
 * Values are NOT escaped: some strings carry deliberate markup, and the caller
 * escapes what came from a person before passing it in.
 */
export function t(lang, key, vars = {}) {
  const table = STRINGS[String(lang || "").toLowerCase()] || STRINGS.en;
  let s = (key in table ? table : STRINGS.en)[key];
  if (s === undefined) return key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** The languages this file actually carries. */
export const LANGS = Object.keys(STRINGS);

/**
 * Every key starting with one of `prefixes`, in every language, each language
 * completed from English — so a widget running in a browser can pick its own
 * language without a round trip and without a missing key ever reading as
 * blank. Small: only what that widget shows.
 */
export function wordsFor(...prefixes) {
  const keep = (k) => prefixes.some((p) => k.startsWith(p));
  const out = {};
  for (const lang of LANGS) {
    out[lang] = {};
    for (const k of Object.keys(STRINGS.en).filter(keep)) {
      out[lang][k] = STRINGS[lang][k] !== undefined ? STRINGS[lang][k] : STRINGS.en[k];
    }
  }
  return out;
}
export { STRINGS as _STRINGS };
