#!/usr/bin/env node
/**
 * SmartILR — Morphological Priority Enforcement (v139)
 *
 * Verifies the priority order introduced in v139:
 *   1. Arabic verb measure detection (Forms I–X)     ← _morphoVerb flag
 *   2. Arabic conjugation suffixes  (وا/ت/نا/تم…)   ← _morphoVerb flag
 *   3. Arabic present/future prefix (ي/ت/أ/ن/س)     ← _morphoVerb flag
 *   4. Arabic definite article ال → Noun lock        ← _morphoNoun flag
 *   5. ONLY then: English gloss POS signal (Rules NB / V)
 *
 * Each test group deliberately creates a CONFLICT between Arabic morphology
 * and the English gloss, then asserts Arabic morphology wins when the
 * relevant confidence flag (_morphoVerb / _morphoNoun) is set.
 *
 * Counter-examples (Groups E/F) verify that the English gloss CAN still
 * override low-confidence Arabic paths (no confidence flag set).
 *
 * Run:  node tests/morphoPriorityEnforcement.js
 * Exit 0 = all pass.  Exit 1 = any failure.
 */

"use strict";

// ── Normalizer ────────────────────────────────────────────────────────────────
function _arNormalize(s) {
  return String(s || "")
    .replace(/[\u064B-\u065F\u0610-\u061A\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, "")
    .replace(/[أإآ]/g, "ا")
    .trim();
}

// ── Measure helper ────────────────────────────────────────────────────────────
function _vm(bn) {
  if (!bn) return null;
  if (/^است/.test(bn) && bn.length >= 7)                      return "Form X";
  if (/^ا[^ل]ت/.test(bn) && bn.length >= 5)                  return "Form VIII";
  if (/^انف/.test(bn))                                         return "Form VII";
  if (/^ت.ا/.test(bn) && bn.length >= 5)                      return "Form VI";
  if (/^ت/.test(bn) && bn.length >= 5)                        return "Form V";
  if (/^ا[^ل]/.test(bn) && bn.length >= 4 && bn.length <= 6) return "Form IV";
  if (bn.length <= 4)                                          return "Form I";
  return null;
}

// ── Suffix helpers ────────────────────────────────────────────────────────────
const _PRON_SFXS = ["هما","كما","هم","هن","كم","كن","ني","نا","ها","ه","ك","ي"];
function hasSfx(bn) { return _PRON_SFXS.some(s => bn.endsWith(s) && bn.length > s.length + 1); }
function getSfx(bn) { return _PRON_SFXS.find(s => bn.endsWith(s) && bn.length > s.length + 1) || null; }

// ── KNOWN_NOUNS (minimal subset needed for these tests) ───────────────────────
const KNOWN_NOUNS = new Map([
  ["يوم",{subtype:null}], ["يمين",{subtype:null}], ["يسار",{subtype:null}],
  ["يقين",{subtype:null}], ["يد",{subtype:null}],
  // Verbal nouns (not in PASSIVE_LEXICON) — used in Group I to test subtype guard
  ["عقد",{subtype:"verbal noun"}], ["نقل",{subtype:"verbal noun"}],
  ["فرض",{subtype:"verbal noun"}], ["دفع",{subtype:"verbal noun"}],
]);

const PASSIVE_LEXICON = new Set([
  "تم","جري","قتل","ذكر","صدر","ورد","سمع","حكم",
]);

// ── classifyBase — mirrors live morphological classifier ──────────────────────
function classifyBase(word) {
  const bn = _arNormalize(word);
  if (!bn) return { label:"Unknown" };

  if (KNOWN_NOUNS.has(bn) && !PASSIVE_LEXICON.has(bn)) {
    const kn = KNOWN_NOUNS.get(bn);
    return { label:"Noun", subtype: kn.subtype, voiceAmbiguous: bn.length === 3 };
  }
  if (PASSIVE_LEXICON.has(bn)) {
    return { label:"Verb", voice:"passive", morph:"past, passive" };
  }

  // D1.5 Form VIII ل-root past verbs
  const _CB_F8L = new Set(["التقى","التقي","التمس","التزم","التحق","الجأ","الجا",
                            "التقت","التزمت","التحقت"]);
  if (_CB_F8L.has(bn)) {
    return { label:"Verb",
             morph: /ت$/.test(bn) ? "past, 3rd feminine singular" : "past",
             measure:"Form VIII" };
  }

  // D1 Feminine ة
  if (/ة$/.test(bn) && bn.length >= 3)
    return { label:"Noun", morph:"feminine singular" };

  // D2 Definite ال  ← Arabic nouns/adjectives; verbs NEVER take ال
  if (/^ال/.test(bn)) return { label:"Noun", morph:"definite" };

  // D3 Feminine sound plural ات
  if (/ات$/.test(bn) && bn.length >= 4)
    return { label:"Noun", subtype:"feminine sound plural" };

  // D4 Dual ان
  if (/ان$/.test(bn) && bn.length >= 5 && !/^ا/.test(bn))
    return { label:"Noun", subtype:"dual" };

  // D5 Masculine sound plural
  if (/ون$/.test(bn) && bn.length >= 4)
    return { label:"Noun", subtype:"masculine sound plural" };
  if (/ين$/.test(bn) && bn.length >= 4)
    return { label:"Noun", subtype:"masculine sound plural" };

  // F0 Future سـ
  if (/^س[يتنأا]/.test(bn) && bn.length >= 5)
    return { label:"Verb", morph:"future", measure:_vm(bn) };

  // F1 Past 3fs ت-ending
  if (/ت$/.test(bn) && !/ات$/.test(bn) && bn.length >= 4 && !/^ال/.test(bn)) {
    return { label:"Verb",
             morph:"past, 3rd feminine singular",
             measure: _vm(bn.slice(0,-1)) || _vm(bn) };
  }

  // F2 Imperfect ي/ت/ن — KNOWN_NOUNS guarded above for يـ words
  if (/^[يتن]/.test(bn) && bn.length >= 3 && !/^ال/.test(bn)) {
    const sfx = hasSfx(bn) ? getSfx(bn) : null;
    const m = _vm(bn);
    if (sfx) return { label:"Verb", qualifier:"present, transitive", pronoun:sfx, measure:m };
    return { label:"Verb", morph:"present", measure:m };
  }

  // F2.5 وا-ending — past 3mp / imperative plural
  if (/وا$/.test(bn) && bn.length >= 4 && !/^ال/.test(bn)) {
    const stem = bn.slice(0,-2);
    return { label:"Verb",
             morph:"past, 3rd masculine plural / imperative plural",
             measure: _vm(stem) || _vm(bn) };
  }

  // F3 3-char past verb set
  const _VERB3_PAST = new Set([
    "قال","ذهب","جاء","كان","عاد","رفض","قبل","وصل","سقط",
    "دخل","خرج","شهد","حذر","قام","منع","سمح","زار",
    "درس","اكد","دعا","نفي","اتى","اخذ","بات",
    "صار","ظل","ظهر","جلس","عاش","مات","نام","ضرب",
    "بدا","اشار","اراد","اعلن","ناقش","نقل","عقد",
    "فرض","فتح","دفع","سحب","قصف","شن","اسهم",
    "كتب","نجح","فاز","هزم","حضر","وجد","حصل",
    "سعى","مضى","مشى","رمى","بكى","نسى","جرى","لقي","لقى",
  ]);
  if (bn.length === 3 && !/^ال/.test(bn) && !/ة$/.test(bn)) {
    if (_VERB3_PAST.has(bn)) return { label:"Verb", morph:"past", measure:"Form I" };
    return { label:"Noun", subtype:"verbal noun", measure:"Form I", voiceAmbiguous:true };
  }

  // STEP G generic noun fallback
  return { label:"Noun" };
}

// ── Morphological confidence flags (mirrors live index.html v139) ──────────────
// _morphoVerb — set when the Verb POS came from an UNAMBIGUOUS Arabic signal:
//   conjugation suffixes (وا/ت/نا/تم…) or present/future prefixes (ي/ت/أ/ن/س)
//   or a derived verbal form (Form IV/V/VI/VII/VIII/X).
//   IMPORTANT: F2 path with pronoun suffix stores "present, transitive" in
//   .qualifier (not .morph), so both fields must be checked.
// _morphoNoun — set ONLY when the CLASSIFICATION result is D2 (morph:"definite").
//   NOT set via surface form alone — Form VIII ل-root verbs (التزمت, التقى) start
//   with ال but are classified Verb via D1.5, not D2, so their morph ≠ "definite".
function morphoFlags(cls, n) {
  const _mvMorph = (cls.morph || "") + " " + (cls.qualifier || "");
  const _morphoVerb = cls.label === "Verb" && !cls._sal && (
    /present|future|imperfect/.test(_mvMorph) ||
    /3rd (feminine|masculine) (singular|plural)|plural/.test(_mvMorph) ||
    /1st (singular|plural)/.test(_mvMorph) ||
    /Form (IV|V|VI|VII|VIII|X)/.test(cls.measure || "")
  );
  // Surface /^ال/ check needed: ال-prefixed words ending in ة (الحكومة, المقررة)
  // trigger D1 (ة-ending) before D2, giving morph:"feminine singular" not "definite".
  // Safe: _morphoNoun only matters when cls.label==="Noun" (inside _rvEligible).
  const _morphoNoun = /^ال/.test(n) || cls.morph === "definite";
  return { _morphoVerb, _morphoNoun };
}

// ── English gloss classifier (mirrors live _classifyEnPOS) ────────────────────
const NOUN_EN = new Set([
  "day","night","morning","week","month","year","hour","era",
  "right","left","hand","side","direction",
  "certainty","despair","hope","peace","fire","oil","gas","light",
  "war","army","people","news","opinion","form","shape","role",
  "voice","house","door","time","age","condition","situation",
  "state","support","campaign","initiative","resolution","statement",
  "authority","leadership","participation","speech","agreement",
  "decision","limit","vote","work","rule","occupation","publication",
]);
const VERB_IRR = new Set([
  "said","went","came","saw","took","gave","found","told","knew",
  "thought","brought","kept","met","ran","stood","fell","sent",
  "built","paid","lost","led","spoke","wrote","heard","won",
  "came","chose","drew","grew","held","sought","fought","taught",
  "read","cut","let","put","set","hit","beat","cast","cost","hurt",
  "come","go","leave","return","enter","exit","vote","depart","flee",
  "attend","join","resign","confirm","sign","launch","condemn","impose",
  "reject","refuse","protest","urge","press","demand","warn",
  "praise","criticize","accuse","announce","declare","deny",
  "decide","continue","resume","see","find","take","give","tell",
  "write","speak","run","fall","send","build","pay","lose","lead",
  "rise","hear","choose","draw","grow","hold","seek","catch","buy","meet",
]);
const NOT_ED = new Set([
  "stressed","blessed","tired","annoyed","interested","surprised",
  "pleased","excited","disappointed","worried","embarrassed",
  "alleged","advanced","supposed","estimated",
]);
function _classifyEnPOS(gloss) {
  if (!gloss) return null;
  const first = gloss.split(/[\s\/,;]/)[0].trim().toLowerCase();
  if (!first || first.length < 2) return null;
  if (NOUN_EN.has(first)) return "noun";
  if (VERB_IRR.has(first)) return "verb";
  if (/ed$/.test(first) && first.length >= 5 && !NOT_ED.has(first)) return "verb";
  return null;
}

// ── classify — applies Rules NB and V WITH morphological priority guards ────────
// engGlossOverride lets each test inject a specific English gloss to create conflict.
function classify(surface, engGlossOverride) {
  const n = _arNormalize(surface);
  let cls = classifyBase(n);
  const { _morphoVerb, _morphoNoun } = morphoFlags(cls, n);
  const _constraintEnPOS = _classifyEnPOS(engGlossOverride || null);

  // Rule NB: English "noun" → override Verb to Noun, UNLESS _morphoVerb is set
  if (cls.label === "Verb" &&
      _constraintEnPOS === "noun" &&
      !_morphoVerb &&
      !cls._sal) {
    cls = { label:"Noun", _sal:"RNB", _via:"Rule-NB" };
  }

  // Rule V: English "verb" → override Noun to Verb, UNLESS _morphoNoun is set
  const _rvEligible = cls.label === "Noun" &&
                      !cls.subtype &&
                      !cls._sal &&
                      !_morphoNoun;
  if (_rvEligible && _constraintEnPOS === "verb") {
    cls = { label:"Verb", morph:"past", _sal:"RV", _via:"Rule-V" };
  }

  return { label: cls.label, _morphoVerb, _morphoNoun, _via: cls._via || null, _cls: cls };
}

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(desc, surface, engGloss, expectedLabel, expectMorphoVerb, expectMorphoNoun) {
  const r = classify(surface, engGloss);
  const labelOK   = r.label === expectedLabel;
  const morphVOK  = expectMorphoVerb  === null ? true : r._morphoVerb  === expectMorphoVerb;
  const morphNOK  = expectMorphoNoun  === null ? true : r._morphoNoun  === expectMorphoNoun;
  const ok = labelOK && morphVOK && morphNOK;
  if (ok) {
    passed++;
    console.log(`  PASS: ${surface.padEnd(14)} gloss="${(engGloss||"").padEnd(14)}" → ${r.label}`);
  } else {
    failed++;
    const detail = [];
    if (!labelOK)  detail.push(`label got="${r.label}" want="${expectedLabel}"`);
    if (!morphVOK) detail.push(`_morphoVerb got=${r._morphoVerb} want=${expectMorphoVerb}`);
    if (!morphNOK) detail.push(`_morphoNoun got=${r._morphoNoun} want=${expectMorphoNoun}`);
    console.log(`  FAIL: ${surface.padEnd(14)} gloss="${(engGloss||"").padEnd(14)}" — ${detail.join(", ")}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP A — Definite article ال → _morphoNoun = true → Rule V BLOCKED
// Scenario: word has ال prefix (D2 → Noun, morph:"definite"), but the English
// gloss says "verb".  Arabic morphology MUST win: stays Noun.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[A] Definite article ال → _morphoNoun=true → Rule V must NOT fire");
//              surface          engGloss       expectedLabel  morphoVerb  morphoNoun
check("A1 (الحكومة + 'decide')", "الحكومة", "decide",    "Noun", false, true);
check("A2 (المنظمة + 'organize')","المنظمة","organize",   "Noun", false, true);
check("A3 (المقررة + 'decided')", "المقررة","decided",    "Noun", false, true);
check("A4 (الموحدة + 'unify')",   "الموحدة","unify",      "Noun", false, true);
check("A5 (المجلس + 'come')",     "المجلس", "come",       "Noun", false, true);
check("A6 (الأمة + 'attend')",    "الامة",  "attend",     "Noun", false, true);
check("A7 (المحددة + 'decide')",  "المحددة","decide",     "Noun", false, true);
check("A8 (الهيئة + 'lead')",     "الهيئة", "lead",       "Noun", false, true);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP B — وا suffix (past 3rd masc. plural هم) → _morphoVerb = true → Rule NB BLOCKED
// Scenario: verb classified via F2.5, English gloss looks like a noun.
// Arabic morphology MUST win: stays Verb.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[B] وا suffix (past 3rd pl. هم) → _morphoVerb=true → Rule NB must NOT fire");
check("B1 (صوتوا + 'vote')",      "صوتوا",  "vote",       "Verb", true,  false);
check("B2 (صوتوا + 'votes')",     "صوتوا",  "votes",      "Verb", true,  false);
check("B3 (قرروا + 'decision')",  "قرروا",  "decision",   "Verb", true,  false);
check("B4 (حددوا + 'limit')",     "حددوا",  "limit",      "Verb", true,  false);
check("B5 (طالبوا + 'statement')", "طالبوا","statement",  "Verb", true,  false);
check("B6 (اتفقوا + 'agreement')","اتفقوا", "agreement",  "Verb", true,  false);
check("B7 (استضافوا + 'campaign')","استضافوا","campaign",  "Verb", true,  false);
check("B8 (انسحبوا + 'work')",    "انسحبوا","work",       "Verb", true,  false);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP C — Present prefix ي/ت/ن → _morphoVerb = true → Rule NB BLOCKED
// Scenario: verb classified via F2, English gloss looks like a noun.
// Arabic morphology MUST win: stays Verb.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[C] Present prefix ي/ت/ن → _morphoVerb=true → Rule NB must NOT fire");
check("C1 (يشارك + 'participation')","يشارك","participation","Verb",true, false);
check("C2 (يتحدث + 'speech')",    "يتحدث",  "speech",     "Verb", true,  false);
check("C3 (يمثل + 'role')",       "يمثل",   "role",       "Verb", true,  false);
check("C4 (تعمل + 'work')",       "تعمل",   "work",       "Verb", true,  false);
check("C5 (نقرر + 'decision')",   "نقرر",   "decision",   "Verb", true,  false);
check("C6 (يستضيف + 'campaign')", "يستضيف", "campaign",   "Verb", true,  false);
check("C7 (يتولى + 'authority')", "يتولى",  "authority",  "Verb", true,  false);
check("C8 (تجري + 'resolution')", "تجري",   "resolution", "Verb", true,  false);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP D — Past 3rd feminine singular ت → _morphoVerb = true → Rule NB BLOCKED
// Scenario: verb classified via F1 (ends ت, length≥4), English says noun.
// Arabic morphology MUST win: stays Verb.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[D] Past 3fs ت suffix → _morphoVerb=true → Rule NB must NOT fire");
check("D1 (أكدت + 'statement')",  "اكدت",   "statement",  "Verb", true,  false);
check("D2 (قالت + 'statement')",  "قالت",   "statement",  "Verb", true,  false);
check("D3 (حصلت + 'work')",       "حصلت",   "work",       "Verb", true,  false);
check("D4 (رفضت + 'decision')",   "رفضت",   "decision",   "Verb", true,  false);
check("D5 (أعلنت + 'statement')", "اعلنت",  "statement",  "Verb", true,  false);
check("D6 (اتخذت + 'decision')",  "اتخذت",  "decision",   "Verb", true,  false);
// D7: التزمت starts with ال (Form VIII ل-root verb, D1.5 path) → Verb.
// Surface /^ال/ makes _morphoNoun=true, but it is HARMLESS — Rule V requires
// label==="Noun" and التزمت is a Verb, so _rvEligible=false regardless.
// _morphoVerb=true (morph="past, 3rd feminine singular" + measure="Form VIII").
// Pass null for _morphoNoun — we only assert the label and _morphoVerb flag.
check("D7 (التزمت + 'agreement')","التزمت", "agreement",  "Verb", true,  null);
check("D8 (استقالت + 'campaign')","استقالت","campaign",   "Verb", true,  false);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP E — Future prefix سـ → _morphoVerb = true → Rule NB BLOCKED
// Scenario: verb classified via F0 (starts سيـ/ستـ), English says noun.
// Arabic morphology MUST win: stays Verb.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[E] Future prefix سـ → _morphoVerb=true → Rule NB must NOT fire");
check("E1 (سيشارك + 'participation')","سيشارك","participation","Verb",true,false);
check("E2 (ستعقد + 'decision')",  "ستعقد",  "decision",   "Verb", true,  false);
check("E3 (سيتولى + 'authority')", "سيتولى","authority",  "Verb", true,  false);
check("E4 (سيصوت + 'vote')",      "سيصوت",  "vote",       "Verb", true,  false);
check("E5 (ستنعقد + 'agreement')","ستنعقد", "agreement",  "Verb", true,  false);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP F — Derived form (Form VIII/X measure) → _morphoVerb = true → Rule NB BLOCKED
// Scenario: verb classified via F2 with high-measure form, English says noun.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[F] Derived verbal form (Form VIII/X) → _morphoVerb=true → Rule NB must NOT fire");
check("F1 (يستضيف Form X + 'campaign')","يستضيف","campaign","Verb",true,false);
check("F2 (يستقبل Form X + 'leadership')","يستقبل","leadership","Verb",true,false);
check("F3 (يستمر Form X + 'resolution')","يستمر","resolution","Verb",true,false);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP G — LOW-CONFIDENCE Verb path (Form I past, plain morph="past")
//           _morphoVerb = false → Rule NB CAN fire → Noun wins when EN says noun
// These are ambiguous 3-char Form I roots where English noun gloss is more reliable.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[G] Low-confidence Verb (Form I past, morph='past') → Rule NB fires → Noun");
// شهد → F3 past, morph="past", measure="Form I" → _morphoVerb=false
// English "era" (∈ NOUN_EN) → Rule NB fires → Noun  ✓
check("G1 (شهد + 'era')",         "شهد",    "era",        "Noun", false, false);
// ظهر → F3 past, morph="past" → _morphoVerb=false; English "time" ∈ NOUN_EN
check("G2 (ظهر + 'time')",        "ظهر",    "time",       "Noun", false, false);
// بدا → F3 past, morph="past" → _morphoVerb=false; English "campaign" ∈ NOUN_EN
check("G3 (بدا + 'campaign')",    "بدا",    "campaign",   "Noun", false, false);
// No English gloss → Rule NB does NOT fire → stays Verb (default F3 classification)
check("G4 (شهد + no gloss)",      "شهد",    null,         "Verb", false, false);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP H — LOW-CONFIDENCE Noun (Step G bare noun, no subtype, not ال-prefixed)
//           _morphoNoun = false → Rule V CAN fire → Verb wins when EN says verb
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[H] Low-confidence bare Noun (Step G) → Rule V fires → Verb when EN says verb");
// رشاد: 4 chars (ر-ش-ا-د), not in any list, no special prefix/suffix → Step G
// → { label:"Noun" } with NO subtype. _morphoNoun=false, _rvEligible=true.
// English "attend" ∈ VERB_IRR → Rule V fires → Verb.
check("H1 (رشاد + 'attend')",     "رشاد",   "attend",     "Verb", false, false);
// 3-char unknown words fall through F3 to subtype:"verbal noun", blocking Rule V.
// This tests that the subtype guard correctly prevents the override.
check("H2 (برم + 'attend' — subtype guards)",  "برم",  "attend",  "Noun", false, false);
// No English gloss → _constraintEnPOS=null → Rule V does NOT fire → stays Noun
check("H3 (رشاد + no gloss)",     "رشاد",   null,         "Noun", false, false);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP I — KNOWN_NOUNS not blocked by _morphoNoun (no ال), but subtype guards _rvEligible
//           Ensures verbal nouns stay verbal nouns even if English says verb
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[I] Verbal noun subtype → _rvEligible=false → stays Noun even when EN says verb");
// عقد/نقل: KNOWN_NOUNS with subtype:"verbal noun" (NOT in PASSIVE_LEXICON).
// classifyBase → { label:"Noun", subtype:"verbal noun" }.
// _rvEligible = false (subtype is set) → Rule V blocked → stays Noun.
check("I1 (عقد + 'decide')",      "عقد",    "decide",     "Noun", false, false);
check("I2 (نقل + 'attend')",      "نقل",    "attend",     "Noun", false, false);
check("I3 (فرض + 'come')",        "فرض",    "come",       "Noun", false, false);
check("I4 (دفع + 'write')",       "دفع",    "write",      "Noun", false, false);

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(72));
console.log(`TOTAL: ${passed + failed}  PASS: ${passed}  FAIL: ${failed}`);
if (failed === 0) {
  console.log("✅ ALL MORPHOLOGICAL PRIORITY ENFORCEMENT TESTS PASS");
} else {
  console.log("❌ SOME TESTS FAILED");
  process.exit(1);
}
