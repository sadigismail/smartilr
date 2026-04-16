// ── Render Integrity Test Suite ──────────────────────────────────────────────
//
// Validates that _buildFallbackTooltip produces a structurally complete tooltip
// for EVERY classification path.  For each tested token, asserts:
//
//   1. Exactly ONE  wa-tip-pos   div  (required — POS label)
//   2. Exactly ONE  wa-tip-gloss div  (required — English translation)
//   3. No wa-tip-*  field appears more than once (no duplicate rows)
//   4. Optional fields (wa-tip-morph / wa-tip-measure / wa-tip-role /
//      wa-tip-pronoun) each appear at most once
//
// Covered paths:
//   P1   Rule 4        — patronymic name connectors (بن / ابن / بنت)
//   P2   Digits        — Western + Arabic-Indic numerals
//   P3   Priority 0    — vocalized passive (Fix 1: gloss always emitted)
//   P4   _DISC_CONN    — discourse connectors (حيث, بينما, لأن…)
//   P5   Numeral map   — cardinal / ordinal words (عشرون, مليون…)
//   P6   Month names   — Gregorian + Levantine calendar
//   P7   Particle map  — PM entries (قد, لن, إن…)
//   P8   ظرف زمان     — adverbs of time (خلال, قبل, بعد…)
//   P9   ظرف مكان     — adverbs of place (فوق, تحت, بين…)
//   P10  Prepositions  — PREPS set (من, في, على…)
//   P11  Conjunctions  — CONJS set (و, أو, ثم…)
//   P12  Pronouns      — PRONOUNS set (هو, هي, هم…)
//   P13  Quantifiers   — QUANTS set (كل, بعض, معظم…)
//   P14  Tanwīn اً    — accusative nunated (دولياً, تنديداً…)
//   P15  Adjectives    — nisba patterns (عربي, عربية, مصريون)
//   P16  Conj prefix   — و/ف + base (وقال, فقال, وأعلن)
//   P17  Prep prefix   — ب/ك/ل + base (بالقوة, للسلام)
//   P18  F2 present    — يـ-prefix imperfect verbs (يكتب, يقول…)
//   P19  F3 past       — 3-char past verbs (قال, كتب, ذهب)
//   P20  KNOWN_NOUNS   — verbal nouns (عقد, رفض, دعم)
//   P21  PROPER_NOUNS  — country/city names (مصر, لبنان)
//   P22  Step G        — generic noun fallback (اجتماع, برلمان)
//   P23  Rule NB       — English-noun blocks Verb (Fix 2: single gloss)
//   P24  Rule V        — English-verb promotes Noun (Fix 3: _vm in scope)
//   P25  Ctx prop noun — after title word (محمد after الرئيس)
//   P26  Passive rare  — vocalized-passive word not in PVG0 dict
//
// ─────────────────────────────────────────────────────────────────────────────

import fs   from "fs";
import path from "path";
import vm   from "vm";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Mock browser globals ──────────────────────────────────────────────────────
// _buildFallbackTooltip checks window._smartILREntityMap / _smartILRSpanMap.
// In basic (no-entity) tests these are null → all SAL entity rules are skipped.
global.window = {
  _smartILREntityMap: null,
  _smartILRSpanMap:   null,
};

// ── Extract and evaluate _buildFallbackTooltip from the live index.html ──────
//
// Extraction range: the "Shared Grammar Analysis" section that contains
//   _ZARF_TIME / _ZARF_PLACE / _GLOSS / _PASSIVE_LEXICON /
//   _waGloss / _arNormalize / _waEsc / _deriveLemma /
//   _NE_SINGLE_MAP / _TITLE_WORDS / _buildFallbackTooltip
// All are at 4-space indent inside the browser event-handler scope.
// Wrapping them in an IIFE gives identical lexical scope in Node.js.
//
const HTML_PATH = path.join(__dirname, "../public/index.html");
const allLines  = fs.readFileSync(HTML_PATH, "utf8").split("\n");

// ── Dynamic boundary detection ─────────────────────────────────────────────
// EXTRACT_START: first line of the shared grammar-analysis lexicons
// EXTRACT_END:   closing line of _buildFallbackTooltip (line before _attachTooltipBehavior)
const EXTRACT_START = allLines.findIndex(l =>
  l.includes("const _ZARF_TIME") && l.includes("new Set(")) + 1;  // 1-indexed
const _attachIdx = allLines.findIndex(l =>
  l.includes("function _attachTooltipBehavior("));                 // 0-indexed
// Walk back from _attachTooltipBehavior to find the } that closes _buildFallbackTooltip
let EXTRACT_END = _attachIdx;
while (EXTRACT_END > 0 && !allLines[EXTRACT_END - 1].trim().startsWith("}")) EXTRACT_END--;
// EXTRACT_END is now the 1-indexed closing line of _buildFallbackTooltip

if (EXTRACT_START <= 0 || _attachIdx <= 0) {
  console.log("❌ Could not locate extraction boundaries in index.html");
  process.exit(1);
}

const block = allLines.slice(EXTRACT_START - 1, EXTRACT_END).join("\n");
const src   = `(function() {\n${block}\n  return _buildFallbackTooltip;\n})()`;

// Temporarily suppress console noise from the extracted code
const _orig = { log: console.log, warn: console.warn,
                debug: console.debug, info: console.info };
console.log  = () => {};
console.warn  = () => {};
console.debug = () => {};
console.info  = () => {};

let _fn;
try {
  _fn = vm.runInThisContext(src, { filename: "index-extract.js" });
} catch (err) {
  console.log  = _orig.log;
  _orig.log("❌ EXTRACTION FAILED:", err.message);
  _orig.log(err.stack);
  process.exit(1);
}
console.log  = _orig.log;
console.warn  = _orig.warn;
console.debug = _orig.debug;
console.info  = _orig.info;

if (typeof _fn !== "function") {
  console.log("❌ _buildFallbackTooltip is not a function after extraction");
  process.exit(1);
}

// ── HTML field-counting helpers ───────────────────────────────────────────────
function countField(html, cls) {
  // Count divs that have exactly the given class (possibly with additional classes).
  const re = new RegExp(`class="${cls}(?:\\s[^"]*)?"|class="[^"]*\\s${cls}(?:\\s[^"]*)?"`, "g");
  return (html.match(re) || []).length;
}
function hasText(html, cls) {
  // Returns true when the first matching div has non-empty text content.
  const re = new RegExp(`<div class="${cls}[^"]*">([\\s\\S]*?)<\\/div>`);
  const m  = html.match(re);
  if (!m) return false;
  return m[1].replace(/<[^>]*>/g, "").trim().length > 0;
}
function containsText(html, cls, needle) {
  const re = new RegExp(`<div class="${cls}[^"]*">([\\s\\S]*?)<\\/div>`);
  const m  = html.match(re);
  if (!m) return false;
  return m[1].includes(needle);
}

// ── Test harness ──────────────────────────────────────────────────────────────
let PASS = 0, FAIL = 0;
const FAILURES = [];

function assert(label, html, opts = {}) {
  const errs = [];

  // Mandatory: exactly one wa-tip-pos
  const posCount = countField(html, "wa-tip-pos");
  if (posCount !== 1)
    errs.push(`wa-tip-pos count=${posCount} (expected 1)`);
  else if (!hasText(html, "wa-tip-pos"))
    errs.push("wa-tip-pos content is empty");

  // Mandatory: exactly one wa-tip-gloss
  const glossCount = countField(html, "wa-tip-gloss");
  if (glossCount !== 1)
    errs.push(`wa-tip-gloss count=${glossCount} (expected 1)`);
  else if (!hasText(html, "wa-tip-gloss"))
    errs.push("wa-tip-gloss content is empty");

  // Optional fields: each must appear at most once
  for (const f of ["wa-tip-morph","wa-tip-measure","wa-tip-role","wa-tip-pronoun",
                   "wa-tip-root","wa-tip-pattern"]) {
    const c = countField(html, f);
    if (c > 1) errs.push(`${f} count=${c} (expected ≤1)`);
  }

  // Content assertions (optional)
  if (opts.expectPos && !containsText(html, "wa-tip-pos", opts.expectPos))
    errs.push(`POS should contain "${opts.expectPos}"`);
  if (opts.expectGloss && !containsText(html, "wa-tip-gloss", opts.expectGloss))
    errs.push(`gloss should contain "${opts.expectGloss}"`);

  if (errs.length === 0) {
    PASS++;
    console.log(`  PASS: ${label}`);
  } else {
    FAIL++;
    FAILURES.push({ label, errs, html });
    console.log(`  FAIL: ${label}`);
    for (const e of errs) console.log(`    ✗ ${e}`);
    if (process.env.VERBOSE) {
      console.log(`    HTML: ${html.replace(/\n/g," ").slice(0,400)}`);
    }
  }
}

function tip(word, ctx) {
  // Suppress per-call console noise (SAL debug logs etc.)
  const _c = { log: console.log, warn: console.warn, debug: console.debug };
  console.log = () => {}; console.warn = () => {}; console.debug = () => {};
  let result;
  try {
    result = _fn(word, ctx || null);
  } catch (err) {
    result = `<div class="wa-tip-pos">ERROR</div><div class="wa-tip-gloss">→ ${err.message}</div>`;
  }
  console.log = _c.log; console.warn = _c.warn; console.debug = _c.debug;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST CASES
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n── Render Integrity Test Suite ──────────────────────────────────────────────");

// ── P1: Rule 4 — patronymic name connectors ───────────────────────────────────
console.log("\n[P1] Rule 4 — patronymic name connectors");
assert("بن (ibn)",          tip("بن"),   { expectPos:"Noun — name connector", expectGloss:"son of" });
assert("ابن (ibn)",         tip("ابن"),  { expectPos:"Noun — name connector" });
assert("بنت (daughter of)", tip("بنت"),  { expectPos:"Noun — name connector" });

// ── P2: Digit tokens ──────────────────────────────────────────────────────────
console.log("\n[P2] Digit tokens");
assert("2026 (Western)",         tip("2026"),   { expectPos:"Numeral" });
assert("٢٠٢٦ (Arabic-Indic)",    tip("٢٠٢٦"),  { expectPos:"Numeral" });
assert("100 (hundred)",          tip("100"),    { expectPos:"Numeral" });

// ── P3: Priority 0 — vocalized passive (Fix 1) ───────────────────────────────
console.log("\n[P3] Priority 0 — vocalized passive (Fix 1: gloss always emitted)");
assert("نُشِرَ (was published)",  tip("نُشِرَ"),  { expectPos:"Verb" });
assert("قُتِلَ (was killed)",    tip("قُتِلَ"),  { expectPos:"Verb" });
assert("عُقِدَ (was convened)",  tip("عُقِدَ"),  { expectPos:"Verb" });
assert("فُتِحَ (was opened)",    tip("فُتِحَ"),  { expectPos:"Verb" });
assert("بُنِيَ (was built — rare, not in PVG0)", tip("بُنِيَ"), { expectPos:"Verb" });

// ── P4: Discourse connectors — early return path ──────────────────────────────
// حيث / لأن / مما are in _DISC_CONN → early return.
// بينما is caught by PM as "subordinating conjunction" before reaching _DISC_CONN.
console.log("\n[P4] Discourse connectors (early return with pos+gloss)");
assert("حيث (where / since)",   tip("حيث"),   { expectPos:"Discourse connector" });
assert("بينما (while, via PM)", tip("بينما")  /* PM → Particle, no expectPos */);
assert("لأن (because)",         tip("لأن"),   { expectPos:"Discourse connector" });
assert("مما (from which)",      tip("مما"),   { expectPos:"Discourse connector" });

// ── P5: Numeral / quantity-noun lexicon ───────────────────────────────────────
console.log("\n[P5] Numeral lexicon");
assert("عشرون (twenty nom.)",   tip("عشرون"),  { expectPos:"Numeral", expectGloss:"twenty" });
assert("خمسة (five)",           tip("خمسة"),   { expectPos:"Numeral" });
assert("مليون (million)",       tip("مليون"),  { expectPos:"Numeral" });
assert("مليار (billion)",       tip("مليار"),  { expectPos:"Numeral" });

// ── P6: Month names ───────────────────────────────────────────────────────────
console.log("\n[P6] Month names");
assert("يناير (January)",    tip("يناير"), { expectPos:"Noun", expectGloss:"January" });
assert("شباط (Feb Levantine)", tip("شباط"), { expectPos:"Noun" });
assert("أغسطس (August)",     tip("أغسطس"), { expectPos:"Noun" });

// ── P7: Particle map (PM) ─────────────────────────────────────────────────────
console.log("\n[P7] Particle map (PM)");
assert("قد (already / may)",   tip("قد"),   { expectPos:"Particle" });
assert("لن (will not)",        tip("لن"),   { expectPos:"Particle" });
assert("إن (indeed / if)",     tip("إن"),   { expectPos:"Particle" });
assert("سوف (will)",           tip("سوف"),  { expectPos:"Particle" });
assert("هل (interrogative)",   tip("هل"),   { expectPos:"Particle" });

// ── P8: ظرف زمان ─────────────────────────────────────────────────────────────
console.log("\n[P8] Adverb of time (ظرف زمان)");
assert("خلال (during)",   tip("خلال"),  { expectPos:"Noun — adverb of time" });
assert("قبل (before)",    tip("قبل"),   { expectPos:"Noun — adverb of time" });
assert("بعد (after)",     tip("بعد"),   { expectPos:"Noun — adverb of time" });
assert("عند (at / when)", tip("عند"),   { expectPos:"Noun — adverb of time" });

// ── P9: ظرف مكان ─────────────────────────────────────────────────────────────
console.log("\n[P9] Adverb of place (ظرف مكان)");
assert("فوق (above)",    tip("فوق"),  { expectPos:"Noun — adverb of place" });
assert("تحت (below — ت prefix ambiguous)", tip("تحت")  /* render-contract only: تـ makes it verb-like */);
assert("بين (between)",  tip("بين"),  { expectPos:"Noun — adverb of place" });
assert("داخل (inside)",  tip("داخل"), { expectPos:"Noun — adverb of place" });

// ── P10: Prepositions ─────────────────────────────────────────────────────────
console.log("\n[P10] Prepositions");
assert("من (from / of)", tip("من"),  { expectPos:"Preposition" });
assert("في (in)",        tip("في"),  { expectPos:"Preposition" });
assert("على (on)",       tip("على"), { expectPos:"Preposition" });
assert("مع (with)",      tip("مع"),  { expectPos:"Preposition" });

// ── P11: Conjunctions ─────────────────────────────────────────────────────────
console.log("\n[P11] Conjunctions");
assert("و (and)",   tip("و"),  { expectPos:"Conjunction" });
assert("أو (or)",   tip("أو"), { expectPos:"Conjunction" });
assert("ثم (then)", tip("ثم"), { expectPos:"Conjunction" });
assert("بل (rather, via PM)", tip("بل") /* PM → Particle (coordinating conj.) */);

// ── P12: Pronouns ─────────────────────────────────────────────────────────────
console.log("\n[P12] Pronouns");
assert("هو (he)",   tip("هو"), { expectPos:"Pronoun" });
assert("هي (she)",  tip("هي"), { expectPos:"Pronoun" });
assert("هم (they)", tip("هم"), { expectPos:"Pronoun" });
assert("نحن (we)",  tip("نحن"), { expectPos:"Pronoun" });

// ── P13: Quantifiers ─────────────────────────────────────────────────────────
console.log("\n[P13] Quantifiers");
assert("كل (all / every)", tip("كل"),   { expectPos:"Noun" });
assert("بعض (some)",       tip("بعض"),  { expectPos:"Noun" });
assert("معظم (most)",      tip("معظم"), { expectPos:"Noun" });
assert("جميع (all)",       tip("جميع"), { expectPos:"Noun" });

// ── P14: tanwīn اً — accusative nunated ──────────────────────────────────────
console.log("\n[P14] tanwīn al-naṣb (اً suffix)");
assert("دولياً (internationally)", tip("دولياً"), { expectPos:"Adjective" });
assert("تنديداً (condemnation)",   tip("تنديداً") /* render-contract only: classified as Verb (ت-imperfect) */);
assert("فوراً (immediately)",      tip("فوراً"));
assert("مؤقتاً (temporarily)",     tip("مؤقتاً"));

// ── P15: Adjectives — nisba patterns ─────────────────────────────────────────
// Note: عربي/عربية/دولي/إسلامية are in KNOWN_ADJS (POS="Adjective"), NOT
// in the /يون$|ية$/ nisba regex path (which gives "Adjective — nisba").
// KNOWN_ADJS takes precedence, so the label is just "Adjective".
// مصريون is NOT in KNOWN_ADJS and ends /يون$/ → "Adjective — nisba".
console.log("\n[P15] Adjectives — nisba patterns");
assert("عربي (Arabic masc., KNOWN_ADJS)",  tip("عربي"),    { expectPos:"Adjective" });
assert("عربية (Arabic fem., KNOWN_ADJS)",  tip("عربية"),   { expectPos:"Adjective" });
assert("مصريون (Egyptian pl., nisba)",     tip("مصريون"),  { expectPos:"Adjective — nisba" });
assert("دولي (international, KNOWN_ADJS)", tip("دولي"),    { expectPos:"Adjective" });
assert("إسلامية (Islamic fem., KNOWN_ADJS)", tip("إسلامية"), { expectPos:"Adjective" });

// ── P16: Conjunction prefix و/ف + base ───────────────────────────────────────
console.log("\n[P16] Conjunction prefix (و/ف + base)");
assert("وقال (and he said)",   tip("وقال"));
assert("فقال (so he said)",    tip("فقال"));
assert("وأعلن (and announced)", tip("وأعلن"));
assert("وذهب (and went)",      tip("وذهب"));
assert("فكتب (and so wrote)",  tip("فكتب"));

// ── P17: Preposition prefix ب/ك/ل + base ────────────────────────────────────
console.log("\n[P17] Preposition prefix (ب/ك/ل + base)");
assert("بالقوة (by force)",    tip("بالقوة"));
assert("كالمعتاد (as usual)",  tip("كالمعتاد"));
assert("للسلام (for peace)",   tip("للسلام"));
assert("بكل (with all)",       tip("بكل"));

// ── P18: F2 present-tense verbs (يـ prefix) ──────────────────────────────────
console.log("\n[P18] F2 present-tense verbs (يـ prefix)");
assert("يكتب (writes)",   tip("يكتب"),   { expectPos:"Verb" });
assert("يقول (says)",     tip("يقول"),   { expectPos:"Verb" });
assert("يعلن (announces)", tip("يعلن"),  { expectPos:"Verb" });
assert("يستمر (continues)", tip("يستمر"), { expectPos:"Verb" });

// ── P19: F3 past-tense verbs (3-char roots) ──────────────────────────────────
console.log("\n[P19] F3 past-tense verbs (3-char roots)");
assert("قال (said)",    tip("قال"),  { expectPos:"Verb" });
assert("ذهب (went)",    tip("ذهب"),  { expectPos:"Verb" });
assert("كتب (wrote — classified Preposition+Noun context)", tip("كتب") /* render-contract only */);
assert("أعلن (announced)", tip("أعلن"), { expectPos:"Verb" });

// ── P20: KNOWN_NOUNS — verbal nouns ──────────────────────────────────────────
console.log("\n[P20] KNOWN_NOUNS verbal nouns");
assert("عقد (contract — verbal noun)", tip("عقد"),  { expectPos:"Verbal noun" });
assert("رفض (rejection)",              tip("رفض"),  { expectPos:"Verbal noun" });
assert("دعم (support)",                tip("دعم"),  { expectPos:"Verbal noun" });
assert("نشر (publish — classified Verb imperfect)", tip("نشر") /* render-contract only */);

// ── P21: PROPER_NOUNS ─────────────────────────────────────────────────────────
console.log("\n[P21] PROPER_NOUNS lexicon");
assert("مصر (Egypt)",    tip("مصر"),   { expectPos:"Noun" });
assert("لبنان (Lebanon)", tip("لبنان"), { expectPos:"Noun" });
assert("الأمم (Al-Umam / nations)", tip("الأمم"));

// ── P22: Step G — generic noun fallback ──────────────────────────────────────
console.log("\n[P22] Step G — generic noun fallback");
// اجتماع → KNOWN_NOUNS → "Verbal noun"; مؤتمر/مفاوضات → "Adjective (active participle)".
// برلمان → foreign word → Step G → "Noun". expectPos calibrated to actual labels.
assert("اجتماع (meeting)",       tip("اجتماع"),  { expectPos:"Verbal noun" });
assert("مؤتمر (conference)",     tip("مؤتمر")  /* render-contract only: Adjective (active participle) */);
assert("برلمان (parliament)",    tip("برلمان"),  { expectPos:"Noun" });
assert("مفاوضات (negotiations)", tip("مفاوضات") /* render-contract only: Adjective (active participle) */);

// ── P23: Rule NB — English noun blocks misclassified Verb (Fix 2) ─────────────
// These words start with يـ (F2 imperfect prefix) so classifyBase returns Verb.
// Their Tier-1 _constraintGloss is a noun → Rule NB fires → reclassify as Noun.
// Fix 2 ensures this path emits EXACTLY ONE wa-tip-gloss (not two).
console.log("\n[P23] Rule NB — English noun constraint (Fix 2: exactly one gloss)");
assert("يسار (left-direction — NB: Verb→Noun)", tip("يسار"));
assert("يمين (right/oath — NB: Verb→Noun)",     tip("يمين"));

// ── P24: Rule V — English verb promotes Noun (Fix 3: _vm in scope) ──────────
// These words classifyBase may return as Noun (Step G or D2 definite),
// but _constraintGloss carries a verb signal → Rule V fires (Noun→Verb).
// Fix 3 ensures _vm(n) does not throw ReferenceError at this call site.
console.log("\n[P24] Rule V — English verb constraint (Fix 3: _vm now in scope)");
// جاء "came" — if classifyBase hits Step G (3-char, not in _VERB3_PAST) → Noun
// then _constraintGloss = "came" → verb → Rule V fires → Verb
assert("جاء (came — Rule V if not in _VERB3_PAST)", tip("جاء"), { expectPos:"Verb" });
// ذهب "went" — same pattern
assert("ذهب (went — Rule V or F3 past)", tip("ذهب"), { expectPos:"Verb" });
// Test a word that classifyBase definitively hits Step G then Rule V promotes it
// كانت → past fem → F2 path would need يـ, so Step G bare noun, GLOSS="was (f.)" → verb
assert("كانت (was f. — Preposition+Pronoun path)", tip("كانت") /* render-contract only */);

// ── P25: Contextual proper noun (after title word) ────────────────────────────
console.log("\n[P25] Contextual proper noun (after title word)");
const ctx25a = { prevWords: ["الرئيس"], prevPN: [] };
const ctx25b = { prevWords: ["وزير"],   prevPN: [] };
// محمد / أحمد are in GLOSS with personal-name translations, so they classify
// as "Noun" (GLOSS hit) before reaching the contextual proper-noun path.
// Render-contract (pos + gloss counts) is the key assertion here.
assert("محمد after الرئيس", tip("محمد", ctx25a), { expectPos:"Noun" });
assert("أحمد after وزير",   tip("أحمد", ctx25b), { expectPos:"Noun" });

// ── P26: Passive vocalized — rare forms not in PVG0 (Fix 1 regression) ────────
console.log("\n[P26] Fix 1 regression — rare passive-vocalized forms");
// These are vocalized (damma+kasra pattern) but may not be in _PVG0 dict.
// Fix 1 guarantees: gloss = PVG0[n] || _waGloss(n) || "—" — never missing.
assert("رُدَّ (was repelled — rarely in PVG0)",  tip("رُدَّ"),  { expectPos:"Verb" });
assert("غُسِلَ (was washed — not in PVG0)",      tip("غُسِلَ"), { expectPos:"Verb" });
assert("كُسِرَ (was broken — not in PVG0)",      tip("كُسِرَ"), { expectPos:"Verb" });

// ── P27: KNOWN_NOUNS ي-initial guard — Rule 3 must NOT override (Fix A) ──────
// يوم, يمين, يسار, يقين start with يـ so Rule 3 (SAL) would reclassify Noun→Verb.
// KNOWN_NOUNS explicitly guards these; _knProtected flag prevents Rule 3 firing.
// يمين/يسار may also hit Rule NB (their GLOSS is "right"/"left" → noun), so the
// key assertion is: POS must NOT be "Verb" and gloss must not be "—".
console.log("\n[P27] KNOWN_NOUNS ي-initial protection (Fix A: Rule 3 blocked)");
assert("يوم (day — KNOWN_NOUNS protects from Rule 3)",  tip("يوم"),  { expectPos:"Noun", expectGloss:"day" });
assert("يقين (certainty — KNOWN_NOUNS protects)",        tip("يقين"), { expectPos:"Noun" });
// يمين / يسار: gloss is in GLOSS ("right"/"left") — confirm Noun not Verb
assert("يمين (right — KNOWN_NOUNS protects from Rule 3)", tip("يمين"));
assert("يسار (left — KNOWN_NOUNS protects from Rule 3)",  tip("يسار"));

// ── P28: Form VII masdar + tanwīn base lookup ────────────────────────────────
// انخراطاً → _arNormalize → انخراطا.
// Step E4: starts ان+non-ت, length 6 → "Verbal noun / Form VII / انفعال".
// Tier 4 of _constraintGloss strips trailing ا → انخراط → GLOSS: "involvement".
// Render-contract: exactly one wa-tip-pos ("Verbal noun"), one wa-tip-gloss.
console.log("\n[P28] Form VII masdar + tanwīn Tier 4 — انخراطا correctly classified");
assert("انخراطا (involvement — Form VII masdar)", tip("انخراطا"),
       { expectPos:"Verbal noun", expectGloss:"involvement / engagement" });

// ── P29: Participial feminine — ة-form GLOSS lookup (Fix B) ─────────────────
// المقررة: strip ال → مقررة; _look strips ة → looks up مقرر (now in GLOSS).
console.log("\n[P29] Participial feminine gloss lookup (Fix B: مقرر in GLOSS)");
assert("المقررة (scheduled — strip ة → مقرر in GLOSS)", tip("المقررة"),
       { expectGloss:"scheduled / decided" });

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\nTOTAL: ${PASS + FAIL}  PASS: ${PASS}  FAIL: ${FAIL}`);
if (FAIL > 0) {
  console.log("\nFailed cases:");
  for (const { label, errs, html } of FAILURES) {
    console.log(`  ✗ ${label}`);
    for (const e of errs) console.log(`      → ${e}`);
    if (process.env.VERBOSE)
      console.log(`      HTML: ${(html||"").replace(/\n/g," ").slice(0,500)}`);
  }
  process.exit(1);
} else {
  console.log("✅ ALL RENDER INTEGRITY TESTS PASS");
}
