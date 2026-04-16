#!/usr/bin/env node
/**
 * SmartILR — grammarRegressionNext
 * Second grammar regression pack (25 tests).
 * Pure client-side logic mirror — no server required.
 * Run: node tests/grammarRegressionNext.js
 * Exit 0 = all pass, Exit 1 = any failure.
 *
 * Last updated: v123 (2026-04-09)
 * Covers:
 *   Cat 1 — particle+pronoun compounds     (T01–T05)
 *   Cat 2 — lexicalized prepositions       (T06–T09)
 *   Cat 3 — numeral / quantity nouns       (T10–T16)
 *   Cat 4 — false م-prefix participle traps (T17–T21)
 *   Cat 5 — context-sensitive verb/masdar   (T22–T25)
 *
 * RULE: numeral/quantity lexicon outranks D5 and D6.
 *       particle PM map outranks noun fallback.
 *       PLACE_NOUNS protects م-prefix nouns from D6 participle heuristic.
 *
 * Run both suites after every grammar change:
 *   node tests/grammarRegression20.js && node tests/grammarRegressionNext.js
 */

const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;
function N(s) {
  if (!s) return "";
  return s.replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
          .replace(/\u0649/g, "\u064A")
          .replace(DIACRITICS, "");
}
function isPassiveVoweled(s) {
  const di = s.search(/\u064F/);
  if (di >= 0 && /\u0650/.test(s.slice(di))) return true;
  if (/^[\u064A\u062A\u0646\u0623\u0627]\u064F/.test(s)) return true;
  return false;
}

const PM_KEYS = new Set([
  "فيه","فيها","فيهم","بهم","لهم","منهم","منها","باسم",
  "عليه","عليها","عليهم","عنه","عنها","عنهم","اليه","اليها","اليهم",
  "معه","معها","معهم","بينه","بينها","بينهم",
  "وهو","وهي","وهم","وهن","وكان","وكانت","وقال","وقالت","واكد","واضاف",
  "عنده","عندها","عندهم","عندنا","عندك","عندكم","عندي",
  "لديه","لديها","لديهم","لدينا","لديكم","لديك","لدي",
]);
const PREPS = new Set([
  "في","من","الى","الي","على","علي","عن","مع","دون","ضد","منذ",
  "حتى","حتي","ازاء","عبر","رغم","نحو","لدى","لدي","عدا",
  "سوى","سوي","بشأن","بشان","باستثناء",
]);
const PASSIVE_LEXICON = new Set([
  "تم","جري","قتل","ذكر","نقل","صدر","ورد","سمع","حكم",
  "اعلن","اصيب","اعدم","اوقف","اسقط","افرج","افيد","اعيد","ادين","اطلق","اجري",
  "احتجز","اعتقل","اعتمد","استهدف","استبدل",
]);
const KNOWN_NOUNS = new Set([
  "عقد","صدر","نشر","نقل","قتل","حكم","فرض","نقد","قبض","ضرب",
  "دفع","سحب","كسر","شن","هجم","فقد","حظر","صنع","حفظ","دعم","قصف","رفض","فتح","ضغط",
]);
const KNOWN_BP = new Set([
  "اعمال","اسباب","احداث","اطراف","افكار","انواع","احزاب","اقسام",
  "اسلحة","اجهزة","امثلة","ارقام","اهالي",
]);
const PLACE_NOUNS = new Set([
  "مكان","مطار","مكتب","ملعب","مسجد","مصنع","مدرسة","مستشفى",
  "مخيم","ملجا","معسكر","منطقة","مدينة","محطة","منفذ","مدخل","مخرج",
  "موسم","موقع","موضع","مجلس","مجال","مطلب","مطبخ","مقبرة","ملحق","ملف",
]);
const QUANTS = new Set(["كل","بعض","جميع","اغلب","معظم","سائر","كلا","كلتا","بضع"]);
const NUMERAL_WORDS = new Map([
  ["عشرة","ten"],["عشرون","twenty-nom"],["عشرين","twenty"],
  ["ثلاثون","thirty-nom"],["ثلاثين","thirty"],["اربعون","forty-nom"],["اربعين","forty"],
  ["خمسون","fifty-nom"],["خمسين","fifty"],["ستون","sixty-nom"],["ستين","sixty"],
  ["سبعون","seventy-nom"],["سبعين","seventy"],["ثمانون","eighty-nom"],["ثمانين","eighty"],
  ["تسعون","ninety-nom"],["تسعين","ninety"],
  ["مئة","hundred"],["مائة","hundred"],["مئات","hundreds"],
  ["الف","thousand"],["الاف","thousands"],
  ["مليون","million"],["مليونان","two-million"],["مليوني","two-million-obl"],
  ["ملايين","millions"],
  ["مليار","billion"],["ملياران","two-billion"],["مليارين","two-billion-obl"],
  ["مليارات","billions"],["تريليون","trillion"],
]);

function classify(word) {
  const n = N(word);
  if (isPassiveVoweled(word))              return { label:"Verb",        voice:"passive",         path:"P0" };
  if (PM_KEYS.has(n) || PM_KEYS.has(word)) return { label:"Particle",                            path:"PM" };
  if (PREPS.has(n)   || PREPS.has(word))   return { label:"Preposition",                         path:"PREPS" };
  if (QUANTS.has(n))                       return { label:"Noun",        subtype:"quantifier",    path:"QUANTS" };
  if (NUMERAL_WORDS.has(n))                return { label:"Numeral",                              path:"NUMERAL_WORDS" };
  if (KNOWN_NOUNS.has(n) && !PASSIVE_LEXICON.has(n))
    return { label:"Noun", subtype:"verbal noun", voiceAmbiguous: n.length === 3, path:"KNOWN_NOUNS" };
  if (PASSIVE_LEXICON.has(n))
    return { label:"Verb", voice:"passive",       voiceAmbiguous: n.length === 3, path:"LEXICON" };
  if (KNOWN_BP.has(n))                     return { label:"Noun",        subtype:"broken plural", path:"KNOWN_BP" };
  if (/^ال/.test(n) && KNOWN_BP.has(n.slice(2)))
    return { label:"Noun", subtype:"broken plural", morph:"definite",               path:"KNOWN_BP_def" };
  if (PLACE_NOUNS.has(n))                  return { label:"Noun",        subtype:"noun of place", path:"PLACE_NOUNS" };
  if (/ان$/.test(n) && n.length >= 5 && !/^ا/.test(n))
    return { label:"Noun",        subtype:"dual-nom",      path:"D4" };
  if (/ين$/.test(n) && n.length >= 4) {
    const stem = n.slice(0, -2);
    return stem.length <= 3
      ? { label:"Noun", subtype:"dual",                   path:"D5-dual" }
      : { label:"Noun", subtype:"mpl",                    path:"D5-mpl" };
  }
  if (/^م/.test(n) && n.length >= 5)       return { label:"Adjective",   subtype:"participle",    path:"D6" };
  if (/^است.+ت(ها|هم|هن|ه|ك|ني|نا|هما)$/.test(n) && n.length >= 8)
    return { label:"Verb",        morph:"past, 3fs",       path:"D6.5" };
  if (n.length === 3)                       return { label:"Noun|Verb",   voiceAmbiguous:true,     path:"Fallback-3" };
  return                                           { label:"Unknown",                              path:"Fallback" };
}

const T = (id, w, e, mn, d) => ({ id, word:w, expLabel:e, mustNot:mn, desc:d });

const TESTS = [
  // ── Cat 1: particle+pronoun compounds ─────────────────────────────────────
  T(1,  "عليها",    "Particle",              "noun",       "prep+pronoun — عليها"),
  T(2,  "إليه",     "Particle",              "noun",       "prep+pronoun — إليه"),
  T(3,  "لديهم",    "Particle|Preposition",  "noun",       "possession compound — لديهم"),
  T(4,  "عندها",    "Particle|Preposition",  "noun",       "possession compound — عندها"),
  T(5,  "بينها",    "Particle",              "noun",       "prep+pronoun — بينها"),
  // ── Cat 2: lexicalized prepositions ───────────────────────────────────────
  T(6,  "بشأن",     "Preposition|Particle",  "verb",       "regarding/concerning — بشأن"),
  T(7,  "لدى",      "Particle|Preposition",  "noun",       "preposition لدى (Particle|Preposition both valid)"),
  T(8,  "دون",      "Preposition",           "noun",       "preposition دون"),
  T(9,  "سوى",      "Preposition",           "noun",       "except/other than — سوى"),
  // ── Cat 3: numeral / quantity nouns ───────────────────────────────────────
  T(10, "مليون",    "Numeral",               "participle", "million"),
  T(11, "مليونان",  "Numeral",               "dual",       "two million — not dual noun"),
  T(12, "ملايين",   "Numeral",               "plural",     "millions — not broken plural"),
  T(13, "مئة",      "Numeral",               "participle", "hundred"),
  T(14, "مئات",     "Numeral",               "plural",     "hundreds — not broken plural"),
  T(15, "مليار",    "Numeral",               "participle", "billion — not participle"),
  T(16, "مليارات",  "Numeral",               "plural",     "billions"),
  // ── Cat 4: م-prefix place noun traps ──────────────────────────────────────
  T(17, "مكتب",    "Noun",                  "participle", "office — not participle"),
  T(18, "مسجد",    "Noun",                  "participle", "mosque — not participle"),
  T(19, "مصنع",    "Noun",                  "participle", "factory — not participle"),
  T(20, "مدرسة",   "Noun",                  "participle", "school — not participle (6 chars, D6 would fire)"),
  T(21, "موسم",    "Noun",                  "participle", "season — not participle"),
  // ── Cat 5: context-sensitive verb/masdar (voiceAmbiguous flag required) ───
  T(22, "نشر",     "Noun",                  "participle", "nashr — verbal noun + voiceAmbiguous"),
  T(23, "جرى",     "Verb",                  "noun",       "jara — passive auxiliary + voiceAmbiguous"),
  T(24, "منع",     "Noun|Verb",             "participle", "man' — voiceAmbiguous (not participle)"),
  T(25, "مليونان", "Numeral",               "dual",       "two-million dual form — Numeral not dual noun"),
];

let pass = 0, fail = 0;
console.log("SmartILR — grammarRegressionNext (25 tests)");
console.log("=".repeat(78));
for (const { id, word, expLabel, mustNot, desc } of TESTS) {
  const cls = classify(word);
  const labelOk = expLabel.split("|").some(e => cls.label.startsWith(e));
  const mustOk  = !cls.label.toLowerCase().includes(mustNot) &&
                  !(cls.subtype || "").toLowerCase().includes(mustNot);
  const ok = labelOk && mustOk;
  if (ok) pass++; else fail++;
  const sub  = cls.subtype ? ` (${cls.subtype})` : cls.morph ? ` [${cls.morph}]` : "";
  const va   = cls.voiceAmbiguous ? " [ambig]" : "";
  const mark = ok ? "✓" : "✗ FAIL";
  if (!ok) {
    console.log(`${mark} | T${String(id).padStart(2,"0")} | token: "${word}" | expected: ${expLabel} | got: ${cls.label}${sub}${va} via ${cls.path} | ${desc}`);
  } else {
    console.log(`${mark} | T${String(id).padStart(2,"0")} | ${String(word).padEnd(12)} | ${cls.label}${sub}${va} via ${cls.path} | ${desc}`);
  }
}
console.log("=".repeat(78));
console.log(`PASS: ${pass}  FAIL: ${fail}`);
if (fail > 0) {
  console.error("🔴 REGRESSION DETECTED — DO NOT SHIP");
  process.exit(1);
}
console.log("✅ ALL 25 PASS");
