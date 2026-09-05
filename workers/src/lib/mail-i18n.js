/**
 * mail-i18n.js — the words in the messages a SUPPORTER receives
 *
 * WHICH MESSAGES, AND WHY ONLY THESE. Three: confirming a subscription, the
 * receipt for the contact form, and the unsubscribe pages. They go to people
 * who never asked for an account and may not read English — a Croatian
 * supporter confirming a Croatian ministry's list in English is a worse
 * experience and a worse conversion.
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
export { STRINGS as _STRINGS };
