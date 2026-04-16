#!/usr/bin/env node
// ── Tooltip Gloss Regression Suite (v131) ─────────────────────────────────────
// Validates that every seed token from the live-UI failure reports resolves to a
// non-empty, English-looking gloss via the _waGloss pipeline
// (the client-side engine that drives both _buildTooltipHtml and _buildFallbackTooltip).
//
// Run: node tests/tooltipGlossRegression.js
// ESM-compatible (package.json has "type":"module").

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Minimal inline replica of _arNormalize ──────────────────────────────────
function _arNormalize(s) {
  return String(s)
    .replace(/[\u064B-\u065F\u0670\u0671]/g, "")
    .replace(/[أإآٱ\u0622\u0623\u0625\u0627\u0671]/g, "ا")
    .replace(/\u0640/g, "");
}

// ── Load the _GLOSS and _BROKEN_PL_MAP from the HTML ─────────────────────────
const html = readFileSync(join(__dirname, "../public/index.html"), "utf8");

function extractObject(html, marker, startSkip) {
  const start = html.indexOf(marker);
  if (start === -1) return {};
  let depth = 0, end = -1;
  for (let i = start + startSkip; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      if (depth === 0) { end = i; break; }
      depth--;
    }
  }
  if (end === -1) return {};
  try { return eval("(" + html.slice(start + startSkip - 1, end + 1) + ")"); } catch(e) { return {}; }
}

const _GLOSS = extractObject(html, "const _GLOSS = {", 16);
const _BROKEN_PL_MAP = extractObject(html, "const _BROKEN_PL_MAP = {", 24);

if (!Object.keys(_GLOSS).length) { console.error("ERROR: Cannot parse _GLOSS"); process.exit(1); }

// ── Inline replica of _look / _lookPlural / _lookBrokenPlural ────────────────
function _look(s) {
  if (!s || s.length < 2) return null;
  let r = _GLOSS[s]; if (r) return r;
  if (/ة$/.test(s)) {
    r = _GLOSS[s.slice(0, -1)]; if (r) return r;         // strip ة → try base
  } else {
    r = _GLOSS[s + "ة"];        if (r) return r;          // restore ة
    // tā' marbūṭa (ة) → tā' (ت) when followed by suffix; stem may end ت
    if (/ت$/.test(s) && s.length > 2) {
      r = _GLOSS[s.slice(0, -1) + "ة"]; if (r) return r; // حكومت → حكومة ✓
    }
  }
  return null;
}
function _lookPlural(s) {
  if (!s || s.length < 3) return null;
  if (/ات$/.test(s) && s.length > 4)    { const b = s.slice(0, -2); const r = _look(b); if (r) return r + " (pl.)"; }
  if (/ون$|ين$/.test(s) && s.length > 4){ const b = s.slice(0, -2); const r = _look(b); if (r) return r + " (pl.)"; }
  if (/ان$/.test(s) && s.length > 4)    { const b = s.slice(0, -2); const r = _look(b); if (r) return r + " (dual)"; }
  return null;
}
function _lookBrokenPlural(s) {
  const sg = _BROKEN_PL_MAP[s];
  if (sg) { const r = _look(sg); if (r) return r; }
  return null;
}

// ── Minimal replica of _deriveLemma ──────────────────────────────────────────
// NOTE: proclitic stripping (و ف ب ك ل) removed — _waGloss Tiers 2-3b handle it.
// This prevents و-initial roots (وزير) from being trimmed incorrectly.
function _deriveLemma(word) {
  if (!word) return null;
  let s = word.replace(/^[\u00AB\u00BB"'()\[\]\u060C\u061F\u061B.!?,;:\u2026]+/u, "")
              .replace(/[\u00AB\u00BB"'()\[\]\u060C\u061F\u061B.!?,;:\u2026]+$/u, "")
              .trim();
  if (!s) return null;
  s = _arNormalize(s);
  // Step 4: strip ال (definite article)
  if (s.startsWith("ال") && s.length > 3) s = s.slice(2);
  // Step 5: strip pronoun suffixes
  for (const p of ["هما","كما","هم","هن","كم","كن","ني","نا","ها","ه","ك","ي"]) {
    if (s.length > p.length + 1 && s.endsWith(p)) { s = s.slice(0, -p.length); break; }
  }
  // Step 6: strip sound plural/dual suffixes
  if (/ات$/.test(s) && s.length > 3)      s = s.slice(0, -2);
  else if (/ون$|ين$/.test(s) && s.length > 3) s = s.slice(0, -2);
  else if (/ان$/.test(s) && s.length > 3)  s = s.slice(0, -2);
  // Step 7: strip ة
  if (/ة$/.test(s) && s.length > 2) s = s.slice(0, -1);
  // Step 8: strip accusative trailing ا
  if (/ا$/.test(s) && s.length > 2) s = s.slice(0, -1);
  return s.length >= 2 ? s : null;
}

// ── Full _waGloss pipeline replica (mirrors client-side v131) ────────────────
function _waGloss(normWord, extraLemmas) {
  if (!normWord || normWord.length < 2) return null;
  let _g;
  // Tier 1: exact lookup (with ة-swap)
  _g = _look(normWord);             if (_g) return _g;
  _g = _lookPlural(normWord);       if (_g) return _g;
  _g = _lookBrokenPlural(normWord); if (_g) return _g;
  // Tier 2: strip definite ال
  const _noAl = normWord.startsWith("ال") ? normWord.slice(2) : normWord;
  if (_noAl !== normWord) {
    _g = _look(_noAl);              if (_g) return _g;
    _g = _lookPlural(_noAl);        if (_g) return _g;
    _g = _lookBrokenPlural(_noAl);  if (_g) return _g;
  }
  // Tier 3: strip proclitic [وفبكل] + optional ال
  const _noClitAl = normWord.replace(/^[وفبكل]ال/, "");
  if (_noClitAl !== normWord) {
    _g = _look(_noClitAl);                if (_g) return _g;
    _g = _lookPlural(_noClitAl);          if (_g) return _g;
    _g = _lookBrokenPlural(_noClitAl);    if (_g) return _g;
  }
  const _noClit = normWord.replace(/^[وفبكل]/, "");
  if (_noClit !== normWord && _noClit.length >= 2) {
    _g = _look(_noClit);       if (_g) return _g;
    _g = _lookPlural(_noClit); if (_g) return _g;
    const _noClitNoAl = _noClit.startsWith("ال") ? _noClit.slice(2) : _noClit;
    if (_noClitNoAl !== _noClit) {
      _g = _look(_noClitNoAl);            if (_g) return _g;
      _g = _lookPlural(_noClitNoAl);      if (_g) return _g;
      _g = _lookBrokenPlural(_noClitNoAl);if (_g) return _g;
    }
  }
  // Tier 3b: لل contraction
  if (normWord.startsWith("لل") && normWord.length > 3) {
    const _noLal = normWord.slice(2);
    _g = _look(_noLal);                   if (_g) return _g;
    _g = _lookPlural(_noLal);             if (_g) return _g;
    _g = _lookBrokenPlural(_noLal);       if (_g) return _g;
    if (_noLal.startsWith("ال") && _noLal.length > 3) {
      const _noLalNoAl = _noLal.slice(2);
      _g = _look(_noLalNoAl);             if (_g) return _g;
      _g = _lookPlural(_noLalNoAl);       if (_g) return _g;
    }
  }
  // Tier 4: accusative tanwin trailing ا
  if (/ا$/.test(normWord) && normWord.length > 2 && !normWord.startsWith("ال")) {
    const _tanBase = normWord.slice(0, -1);
    _g = _look(_tanBase);       if (_g) return _g;
    _g = _lookPlural(_tanBase); if (_g) return _g;
    const _tanNoClit = _tanBase.replace(/^[وفبكل]/, "");
    if (_tanNoClit !== _tanBase) { _g = _look(_tanNoClit); if (_g) return _g; }
  }
  // Tier 5: hyphenated compound
  if (normWord.includes("-")) {
    const _parts = normWord.split("-").filter(p => p.length >= 2);
    if (_parts.length >= 2) {
      const _partGlosses = _parts.map(p => {
        let pg = _look(p) || _lookPlural(p);
        if (!pg) {
          const _pNoAl = p.startsWith("ال") ? p.slice(2) : p;
          if (_pNoAl !== p) pg = _look(_pNoAl) || _lookPlural(_pNoAl) || _lookBrokenPlural(_pNoAl);
        }
        if (!pg && p.startsWith("لل") && p.length > 3) pg = _look(p.slice(2)) || _lookPlural(p.slice(2));
        return pg;
      });
      if (_partGlosses.some(pg => pg)) return _partGlosses.map((pg, i) => pg || _parts[i]).join("-");
    }
  }
  // Tier 6: _deriveLemma stem recovery (pronoun suffixes, plural affixes, ة, accusative ا)
  const _dl = _deriveLemma(normWord);
  if (_dl && _dl !== normWord && _dl.length >= 2) {
    _g = _look(_dl);              if (_g) return _g;
    _g = _lookPlural(_dl);        if (_g) return _g;
    _g = _lookBrokenPlural(_dl);  if (_g) return _g;
    const _dlNoAl = _dl.startsWith("ال") ? _dl.slice(2) : _dl;
    if (_dlNoAl !== _dl) {
      _g = _look(_dlNoAl);        if (_g) return _g;
      _g = _lookPlural(_dlNoAl);  if (_g) return _g;
      _g = _lookBrokenPlural(_dlNoAl); if (_g) return _g;
    }
    const _dlNoClit = _dl.replace(/^[وفبكل]/, "");
    if (_dlNoClit !== _dl && _dlNoClit.length >= 2) {
      _g = _look(_dlNoClit);      if (_g) return _g;
      _g = _lookPlural(_dlNoClit);if (_g) return _g;
    }
  }
  // Tier 7: Verb morphology (imperfect prefix, future marker, Form X, past ت)
  let _vb = normWord;
  if (_vb.startsWith("س") && _vb.length >= 4) _vb = _vb.slice(1);
  if (/^[يتنأا]/.test(_vb) && _vb.length >= 3) {
    const _impRoot = _vb.slice(1);
    _g = _look(_impRoot);             if (_g) return _g;
    _g = _lookPlural(_impRoot);       if (_g) return _g;
    if (_impRoot.startsWith("ست") && _impRoot.length >= 4) {
      _g = _look("ا" + _impRoot);     if (_g) return _g;
    }
    if (/^[تن]/.test(_impRoot) && _impRoot.length >= 3) {
      const _innerRoot = _impRoot.slice(1);
      _g = _look(_innerRoot);         if (_g) return _g;
      _g = _lookPlural(_innerRoot);   if (_g) return _g;
    }
  }
  if (/ت$/.test(normWord) && !/ات$/.test(normWord) && normWord.length >= 4) {
    const _pastStem = normWord.slice(0, -1);
    _g = _look(_pastStem);            if (_g) return _g;
    _g = _lookPlural(_pastStem);      if (_g) return _g;
    if (/^[وفبكل]/.test(_pastStem) && _pastStem.length > 2) {
      const _pStemNoClit = _pastStem.slice(1);
      _g = _look(_pStemNoClit);       if (_g) return _g;
      _g = _lookPlural(_pStemNoClit); if (_g) return _g;
    }
  }
  if (normWord.endsWith("وا") && normWord.length >= 4) {
    const _pastMp = normWord.slice(0, -2);
    _g = _look(_pastMp);              if (_g) return _g;
    _g = _lookPlural(_pastMp);        if (_g) return _g;
  }
  // Tier 8: AI-provided extra lemmas (w.lemma, w.root)
  if (extraLemmas) {
    const _el = Array.isArray(extraLemmas) ? extraLemmas : [extraLemmas];
    for (const lem of _el) {
      if (!lem || lem.length < 2) continue;
      const _nLem = _arNormalize(String(lem));
      if (_nLem === normWord) continue;
      _g = _look(_nLem);                if (_g) return _g;
      _g = _lookPlural(_nLem);          if (_g) return _g;
      _g = _lookBrokenPlural(_nLem);    if (_g) return _g;
      if (_nLem.startsWith("ال") && _nLem.length > 3) {
        const _nLemNoAl = _nLem.slice(2);
        _g = _look(_nLemNoAl);          if (_g) return _g;
        _g = _lookPlural(_nLemNoAl);    if (_g) return _g;
        _g = _lookBrokenPlural(_nLemNoAl); if (_g) return _g;
      }
      const _nLemDL = _deriveLemma(_nLem);
      if (_nLemDL && _nLemDL !== _nLem && _nLemDL.length >= 2) {
        _g = _look(_nLemDL);            if (_g) return _g;
        _g = _lookPlural(_nLemDL);      if (_g) return _g;
      }
    }
  }
  return null;
}

// ── Test runner ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function test(label, surface, expectContains, aiLemma, aiRoot) {
  const norm   = _arNormalize(surface);
  const extras = [aiLemma, aiRoot].filter(Boolean);
  const result = _waGloss(norm, extras.length ? extras : undefined);
  const ok     = result && (
    expectContains
      ? result.toLowerCase().includes(expectContains.toLowerCase())
      : result.length > 0
  );
  if (ok) {
    passed++;
    console.log(`  ✓ ${label} → "${result}"`);
  } else {
    failed++;
    failures.push({ label, surface, norm, result, expectContains });
    const got = result ? `"${result}"` : "null";
    console.log(`  ✗ ${label} → ${got}  [expected "${expectContains || "non-null"}"]`);
  }
}

console.log("\n── Tooltip Gloss Regression Suite v131 ─────────────────────────\n");

// ── Group 1: v131 Seed tokens — lemma-aware pipeline ─────────────────────────
console.log("Group 1: Seed tokens (v131 lemma-aware pipeline)");
// Surface → Tier 6 (_deriveLemma strips pronoun suffix ه → مكتب)
test("مكتبه  (office+his — pronoun suffix via Tier 6)",   "مكتبه",    "office");
// Surface → Tier 3b (لل contraction) → ابناء → "sons/children"
test("للأبناء (for the sons — لل contraction, Tier 3b)",  "للأبناء",  "sons");
// Surface → Tier 7c (strip past ت) → نقل → "transfer"
test("نقلت   (she transferred — past ت via Tier 7c)",     "نقلت",     "transfer");
// Surface → Tier 7a+7b (strip س + ت + Form X ست→است) → استمر → "continued"
test("ستستمر (will continue — future+Form X via Tier 7)", "ستستمر",   "continu");
// Surface → Tier 2 (strip ال) → رامية → "targeting (f.)"
test("الرامية (the targeting f. — Tier 2 + GLOSS entry)", "الرامية",  "target");
// Surface → Tier 2 (strip ال) → سلام → "peace"
test("السلام (the peace — Tier 2)",                        "السلام",   "peace");
// Surface → Tier 2 (strip ال) → خليج → "gulf"
test("الخليج (the Gulf — Tier 2 + GLOSS entry)",          "الخليج",   "gulf");
// Surface → Tier 2 (strip ال) → نار → "fire"
test("النار  (the fire — Tier 2 + GLOSS entry)",           "النار",    "fire");

// ── Group 2: v131 Tier 8 — AI-provided lemma/root ────────────────────────────
console.log("\nGroup 2: AI-provided lemma/root (Tier 8)");
// AI provides lemma رمى for forms like الرامية, رامٍ, يرمي
test("يرمي   (he throws — lemma رمى via Tier 8)",   "يرمي",   "throw", "رمى",   null);
// الرامي → Tier 2 strips ال → رامي → _look ة-swap → رامية → "targeting / aiming (f.)"
// (reaches before Tier 8, so AI lemma رام is not used — correct behaviour)
test("الرامي (the targeting m. — Tier 2 ة-swap wins)", "الرامي", "target","رام",  null);
test("مرميا  (thrown — root رمي via Tier 8)",       "مرميا",  "throw",  null,   "رمي");
// AI provides lemma for complex verb form
test("ستستمر (AI lemma: استمر)",  "ستستمر",  "continu",  "استمر", null);
test("نقلت   (AI lemma: نقل)",    "نقلت",    "transfer",  "نقل",  null);
test("مكتبه  (AI lemma: مكتب)",  "مكتبه",   "office",    "مكتب", null);

// ── Group 3: v130 seed tokens (regression guard) ─────────────────────────────
console.log("\nGroup 3: v130 seed tokens (regression guard)");
test("للأبناء  (لل contraction)",     "للأبناء",           "sons");
test("الأوسط  (missing elative)",     "الأوسط",            "central");
test("السلام  (peace)",               "السلام",            "peace");
test("إطلاق   (normalized إ key)",   "إطلاق",             "launch");
test("الأمريكي-الإيراني (hyphen)",   "الأمريكي-الإيراني", "American");
test("مكثفة   (intensive f.)",        "مكثفة",             "intensive");
test("لقاءات  (meetings pl.)",        "لقاءات",            "meeting");
test("بحث     (research)",            "بحث",               "research");

// ── Group 4: Verb morphology (Tier 7) ────────────────────────────────────────
console.log("\nGroup 4: Verb morphology (Tier 7)");
// Past 3fs suffix ت — pipeline strips ت to get past verb stem in GLOSS
// اعلن:"announced", اتفق:"agreed" — verb gloss returned (masdar is different word)
test("اعلنت  (she announced — strip ت → اعلن)",  "اعلنت",   "announc");
test("اتفقت  (she agreed — strip ت → اتفق)",     "اتفقت",   "agree");
test("قالت   (she said — strip ت)",       "قالت",    "said");
// Future + imperfect: ستستمر, سيستقر
test("ستستمر (will continue F3fs)",       "ستستمر",  "continu");
test("سيستقر (will stabilize F3ms)",      "سيستقر",  "stab");
// Imperfect without future
test("يتحدث (he speaks — strip ي+ت)",    "يتحدث",   "spoke");
test("تنفذ  (she executes — strip ت)",   "تنفذ",    "implement");

// ── Group 5: Tier 6 — pronoun/object suffixes ─────────────────────────────────
console.log("\nGroup 5: Pronoun/object suffix stripping (Tier 6)");
test("مكتبه   (office + his/it)",       "مكتبه",    "office");
test("حكومته  (his government)",        "حكومته",   "government");
test("قرارهم  (their decision)",        "قرارهم",   "decision");
test("مؤتمرها (her/its conference)",    "مؤتمرها",  "conference");
test("وزيره   (his minister)",          "وزيره",    "minister");
test("رئيسها  (her/its president)",     "رئيسها",   "president");

// ── Group 6: Core vocabulary regression (must stay passing) ──────────────────
console.log("\nGroup 6: Core vocabulary (regression guard)");
test("قال",       "قال",       "said");
test("رئيس",      "رئيس",      "president");
test("حكومة",     "حكومة",     "government");
test("الدولة",    "الدولة",    "state");
test("المفاوضات", "المفاوضات", "negotiation");
test("وزير",      "وزير",      "minister");
test("الشعب",     "الشعب",     "people");
test("اتفاق",     "اتفاق",     "agreement");
test("أمريكي",    "أمريكي",    "American");
test("وسط",       "وسط",       "middle");
test("لقاء",      "لقاء",      "meeting");
test("مكثف",      "مكثف",      "intensive");

// ── Group 7: v132 residual tokens — final cleanup pass ───────────────────────
console.log("\nGroup 7: v132 residual token cleanup");
// واتصالات: و (conj) + اتصالات → T3 strips و → اتصالات → GLOSS direct hit
//   OR: T3 strips و → اتصالات → _lookPlural strips ات → اتصال → GLOSS hit
test("واتصالات (and communications — conj+plural via T3)",      "واتصالات", "communic");
// للأبناء: already resolved in v131 via T1 / لل-contraction (regression guard)
test("للأبناء  (for the sons — لل contraction, confirmed v131)", "للأبناء",  "sons");
// Place names: added to GLOSS in v132
test("المنامة  (Manama — T2 strips ال → منامة)",                "المنامة",  "Manama");
test("أبوظبي   (Abu Dhabi — normalized ابوظبي → GLOSS direct)",  "أبوظبي",   "Abu Dhabi");
test("جدة      (Jeddah — direct GLOSS hit)",                     "جدة",      "Jeddah");
// ستستمر: already resolved in v131 via T7 Form X (regression guard)
test("ستستمر   (will continue — T7 Form X, confirmed v131)",     "ستستمر",   "continu");
// كبير: already in GLOSS (regression guard)
test("كبير     (large — direct GLOSS hit, confirmed v131)",       "كبير",     "large");
// السلام: T2 strips ال → سلام → GLOSS (regression guard)
test("السلام   (the peace — T2 strips ال, confirmed v131)",       "السلام",   "peace");
// العودة: T2 strips ال → عودة → GLOSS (added v132)
test("العودة   (the return — T2 strips ال → عودة, v132)",         "العودة",   "return");

// ── Group 8: v133 — broken plural lemma + proper noun ────────────────────────
console.log("\nGroup 8: v133 broken-plural + proper noun");
// للأنباء: لل (prep) → انباء → BROKEN_PL_MAP["انباء"]="نبا" → GLOSS["نبا"]="news / report"
//   (also: GLOSS["انباء"]="news / reports" — direct hit at T3b before BP lookup)
test("للأنباء  (for the news — لل+broken-plural انباء→نبا)",   "للأنباء",  "news");
// كير / ستارمر — foreign proper names added to GLOSS
test("كير      (Keir — foreign proper name)",                   "كير",      "Keir");
test("ستارمر   (Starmer — foreign proper name)",                "ستارمر",   "Starmer");
// Also confirm related forms resolve
test("أنباء    (news/reports — broken plural, direct GLOSS)",    "أنباء",    "news");
test("أخبار    (news — broken plural → خبر)",                   "أخبار",    "news");
test("أسماء    (names — broken plural → اسم)",                  "أسماء",    "name");

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failures.length) {
  console.log("\nFailing cases:");
  for (const f of failures) {
    console.log(`  [${f.label}]  norm="${f.norm}"  got=${f.result ? '"'+f.result+'"' : "null"}  expected includes "${f.expectContains}"`);
  }
  process.exit(1);
} else {
  console.log("\nAll tests passed ✓");
  process.exit(0);
}
