// ── Architecture Regression Suite v136 ──────────────────────────────────────
// Tests for the live-UI failures identified in the grammar/tooltip architecture
// stabilization pass. Each test exercises a specific failure mode.
//
// Suite structure:
//   J. Verb recognition (يسهم, وتأتي, قام, وسيزور, سيزور)
//   K. Title-noun protection (وزير, رئيس, نائب)
//   L. Common noun protection (الطاقة, الأسبوع, السلام)
//   M. Proper-name chain (إسحاق → PROPER_NOUNS; قام as Verb)
//   N. Entity override control (entity gate for verbs/common nouns)
//
// All tests run against _waGloss and _tryImperfect replicas from the
// production GLOSS (inline copy from server.js _GLOSS table).
// ─────────────────────────────────────────────────────────────────────────────

// ── Minimal _arNormalize / _waGloss replica ───────────────────────────────────
function _arNormalize(s) {
  return String(s || "")
    .replace(/[\u064B-\u065F\u0610-\u061A\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ؤئ]/g, "ء")
    .replace(/ة/g,    "ه")
    .replace(/ى/g,    "ي")
    .trim();
}

// Lightweight GLOSS snapshot (only keys needed for these tests).
// IMPORTANT: keys must match POST-normalization forms (_arNormalize converts ئ→ء, ة→ه, ى→ي).
// E.g.: رئيس → رءيس, نائب → ناءب, جاء → جاء (ء unchanged), رأى → راي (after full normalization).
const _GLOSS = {
  "وزير":"minister",
  "رءيس":"president",  // _arNormalize("رئيس") → ئ→ء → "رءيس"
  "ناءب":"deputy",     // _arNormalize("نائب") → ئ→ء → "ناءب"
  "امير":"prince",
  "طاقه":"energy",     // ة→ه
  "سلام":"peace",
  "حكومه":"government", // ة→ه
  "اسبوع":"week",
  "اسابيع":"weeks",
  "دار":"house / abode / Dar",
  "قال":"said","جاء":"came","قام":"rose / stood up / carried out",
  "اسهم":"contribute / play a role",
};

function _look(s) {
  return _GLOSS[s] || _GLOSS[s.replace(/ه$/,"ة")] || null;
}
function _waGloss(raw) {
  const n = _arNormalize(raw);
  let g = _look(n); if (g) return g;
  // strip ال
  const noAl = n.startsWith("ال") ? n.slice(2) : n;
  if (noAl !== n) { g = _look(noAl); if (g) return g; }
  // strip proclitic + ال
  const noClit = n.replace(/^[وفبكل]ال/, "");
  if (noClit !== n) { g = _look(noClit); if (g) return g; }
  const noClitOnly = n.replace(/^[وفبكل]/,"");
  if (noClitOnly !== n && noClitOnly.length >= 2) {
    g = _look(noClitOnly); if (g) return g;
    const nca = noClitOnly.startsWith("ال") ? noClitOnly.slice(2) : noClitOnly;
    if (nca !== noClitOnly) { g = _look(nca); if (g) return g; }
  }
  return null;
}

// ── Architecture rules being tested ──────────────────────────────────────────

// J. Verb detection: token starts with imperfect verb prefix → should be Verb
function _isVerbPrefixed(normW) {
  return /^[يتنأ].{2,}/.test(normW);
}
// Future/compound verb prefix guard (conjunction + imperfect/future verb prefix combos)
// Matches: وتـ / ويـ / فتـ / فيـ / وسيـ / فسيـ
// Intentionally excludes bare سيـ/ستـ (those pass through _waGloss gate for future verbs)
function _isCompoundVerbPrefix(normW) {
  return /^(وت|وي|فت|في|وسي|فسي)/.test(normW);
}
// Step 3 title-noun guard: should NOT strip و/ف if word has direct GLOSS
function _shouldStep3Fire(normW) {
  return /^[وف]/.test(normW) && normW.length > 2 && !_waGloss(normW);
}
// D7 verb form guard: should NOT classify as idafa when starts with verb prefix + ي suffix
function _d7VerbGuard(normW) {
  const SFXS = ["هما","كما","هم","هن","كم","كن","ني","نا","ها","ه","ك","ي"];
  const sfx = SFXS.find(x => normW.length > x.length + 1 && normW.endsWith(x));
  if (!sfx) return false; // no suffix
  if (sfx === "ي" && /^[يتن]/.test(normW)) return true; // guard fires → NOT idafa
  return false;
}
// PROPER_NOUNS replica for إسحاق check
const PROPER_NOUNS_TEST = new Map([
  ["اسحاق", { label:"Noun", subtype:"proper noun", morph:"given name", gloss:"Isaac / Ishaaq (personal name)" }],
  ["ماركو",  { label:"Noun", subtype:"proper noun", morph:"given name", gloss:"Marco (personal name)" }],
  ["روبيو",  { label:"Noun", subtype:"proper noun", morph:"given name", gloss:"Rubio (personal name)" }],
  ["ستارمر", { label:"Noun", subtype:"proper noun", morph:"given name", gloss:"Starmer (personal name)" }],
]);

// ── Test cases ────────────────────────────────────────────────────────────────
const CASES = [
  // J. Verb recognition
  ["يسهم",    n => _isVerbPrefixed(n),          "J. Verb recognition", "يسهم starts with ي → verb-prefix flag"],
  ["وتاتي",   n => _isCompoundVerbPrefix(n),     "J. Verb recognition", "وتاتي (وتأتي norm) → compound verb prefix"],
  ["وسيزور",  n => _isCompoundVerbPrefix(n),     "J. Verb recognition", "وسيزور → compound verb prefix (وسي)"],
  ["سيزور",   n => /^سي/.test(n),               "J. Verb recognition", "سيزور → starts with future marker سيـ"],
  ["قام",     n => !!_waGloss(n),               "J. Verb recognition", "قام → GLOSS 'rose / stood up'"],
  // K. Title-noun protection
  ["وزير",    n => !_shouldStep3Fire(n),         "K. Title-noun protection", "وزير → Step 3 skips (has GLOSS)"],
  ["رئيس",    n => !!_waGloss(n),               "K. Title-noun protection", "رئيس → GLOSS 'president'"],
  ["نائب",    n => !!_waGloss(n),               "K. Title-noun protection", "نائب → GLOSS 'deputy'"],
  // L. Common noun protection
  ["الطاقه",  n => !!_waGloss(n),               "L. Common noun protection", "الطاقه → GLOSS 'energy' (entity gate blocks)"],
  ["الاسبوع", n => !!_waGloss(n),               "L. Common noun protection", "الاسبوع → GLOSS 'week' (strips ال)"],
  ["السلام",  n => !!_waGloss(n),               "L. Common noun protection", "السلام → GLOSS 'peace'"],
  ["الحكومه", n => !!_waGloss(n),               "L. Common noun protection", "الحكومه → GLOSS 'government'"],
  // M. Proper-name chain
  ["اسحاق",   n => PROPER_NOUNS_TEST.has(n),    "M. Proper-name chain", "اسحاق (norm of إسحاق) → PROPER_NOUNS hit"],
  ["ماركو",   n => PROPER_NOUNS_TEST.has(n),    "M. Proper-name chain", "ماركو → PROPER_NOUNS hit"],
  ["روبيو",   n => PROPER_NOUNS_TEST.has(n),    "M. Proper-name chain", "روبيو → PROPER_NOUNS hit"],
  ["ستارمر",  n => PROPER_NOUNS_TEST.has(n),    "M. Proper-name chain", "ستارمر → PROPER_NOUNS hit"],
  // N. Entity gate controls — verbs and common nouns should fail entity gate
  ["يسهم",    n => !(!_waGloss(n) && !_isVerbPrefixed(n) && !_isCompoundVerbPrefix(n)),
                                                  "N. Entity gate control", "يسهم → entity gate BLOCKS (verb prefix)"],
  ["وتاتي",   n => !(!_waGloss(n) && !_isVerbPrefixed(n) && !_isCompoundVerbPrefix(n)),
                                                  "N. Entity gate control", "وتاتي → entity gate BLOCKS (compound verb)"],
  ["الطاقه",  n => !(!_waGloss(n) && !_isVerbPrefixed(n) && !_isCompoundVerbPrefix(n)),
                                                  "N. Entity gate control", "الطاقه → entity gate BLOCKS (has GLOSS)"],
  ["وزير",    n => !(!_waGloss(n) && !_isVerbPrefixed(n) && !_isCompoundVerbPrefix(n)),
                                                  "N. Entity gate control", "وزير → entity gate BLOCKS (has GLOSS)"],
  // N2. Entity gate allows: foreign transliterations with no GLOSS and no verb prefix
  // ستارمر (Starmer) starts with "ست" which is NOT in compound-verb guard (only وتـ/ويـ/فتـ/فيـ/وسيـ).
  // ستارمر also not an imperfect-verb prefix (doesn't start with ي/ت/ن/أ/ا).
  // Therefore entity gate ALLOWS it (if entity map contains it AND it has no GLOSS).
  ["ستارمر",  n => !_waGloss(n) && !_isVerbPrefixed(n) && !_isCompoundVerbPrefix(n),
                                                  "N. Entity gate control", "ستارمر → entity gate ALLOWS (no GLOSS, no verb/compound prefix)"],
  // D7 verb form guard
  ["تاتي",    n => _d7VerbGuard(n),              "D7. Verb form guard", "تاتي → D7 ي-suffix suppressed (verb prefix)"],
  ["يجري",    n => _d7VerbGuard(n),              "D7. Verb form guard", "يجري → D7 ي-suffix suppressed (verb prefix)"],
  ["حكومتي",  n => !_d7VerbGuard(n),             "D7. Verb form guard", "حكومتي → D7 ي-suffix allowed (no verb prefix, normal idafa)"],
];

// ── Execute ───────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failDetails = [];
const suites = {};

for (const [word, testFn, suite, desc] of CASES) {
  const norm = _arNormalize(word);
  let ok = false;
  try { ok = testFn(norm); } catch(e) { ok = false; }
  if (!suites[suite]) suites[suite] = { pass:0, fail:0 };
  if (ok) { pass++; suites[suite].pass++; }
  else     { fail++; suites[suite].fail++; failDetails.push(`  ✗ [${suite}] ${desc}`); }
}

for (const [s, r] of Object.entries(suites)) {
  const icon = r.fail === 0 ? "✅" : "⚠️ ";
  console.log(`${icon} ${s}  (${r.pass}/${r.pass+r.fail})`);
}
if (failDetails.length) { console.log("\nFAILURES:"); failDetails.forEach(l => console.log(l)); }
console.log(`\nTOTAL: ${pass+fail}  PASS: ${pass}  FAIL: ${fail}`);
if (fail === 0) console.log("✅ ALL ARCHITECTURE REGRESSION TESTS PASS");
else            process.exit(1);
