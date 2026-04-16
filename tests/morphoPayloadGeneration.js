#!/usr/bin/env node
/**
 * SmartILR — SmartRoot Morphology Payload Generation (v139)
 *
 * Verifies that _finalCls._morphPayload is correctly built when a token is
 * classified by Arabic morphology, and NOT built when the classification was
 * produced by an English-gloss or context override (_sal set).
 *
 * Payload fields tested:
 *   token, classification, lockReason, measure, pattern, root,
 *   confidence, explanation, source
 *
 * Run:  node tests/morphoPayloadGeneration.js
 * Exit 0 = all pass.  Exit 1 = any failure.
 */

"use strict";

// ── Normalizer (mirrors live _arNormalize) ────────────────────────────────────
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

// ── Payload builder (mirrors live index.html SmartRoot block) ─────────────────
function buildPayload(word, cls, morphoVerb, morphoNoun) {
  if (!morphoVerb && !morphoNoun) return null;
  if (cls._sal) return null;

  const n = _arNormalize(word);

  const _FORM_PAT = {
    "Form I":    "فَعَلَ",    "Form II":   "فَعَّلَ",
    "Form III":  "فَاعَلَ",   "Form IV":   "أَفعَلَ",
    "Form V":    "تَفَعَّلَ", "Form VI":   "تَفَاعَلَ",
    "Form VII":  "اِنفَعَلَ", "Form VIII": "اِفتَعَلَ",
    "Form IX":   "اِفعَلَّ",  "Form X":    "اِستَفعَلَ",
  };

  const _extractRoot = (stem, msr) => {
    if (!stem || !msr) return null;
    // _WK covers all three weak radicals: و ي ا (ا marks hollow roots in past tense)
    const _WK = /[واي]/;
    if (msr === "Form I" && stem.length === 3) return stem;
    if (msr === "Form VII" && stem.length >= 5 && /^ان/.test(stem)) {
      const r = stem.slice(2, 5);
      return (r.length === 3 && !_WK.test(r[1])) ? r : null;
    }
    if (msr === "Form VIII" && stem.length >= 5 && /^ا[^ل]ت/.test(stem)) {
      const r = stem[1] + stem[3] + (stem[4] || "");
      return (r.length === 3 && !_WK.test(r[1]) && !/^[اوي]/.test(r)) ? r : null;
    }
    if (msr === "Form X" && stem.length >= 6 && /^است/.test(stem)) {
      const r = stem.slice(3, 6);
      return (r.length === 3 && !_WK.test(r[1])) ? r : null;
    }
    if (msr === "Form V" && stem.length >= 5 && /^ت/.test(stem)) {
      const r = stem.slice(1, 4);
      return (r.length === 3 && !_WK.test(r[1])) ? r : null;
    }
    return null;
  };

  const _msr  = cls.measure || null;
  const _mm   = (cls.morph || "") + " " + (cls.qualifier || "");
  const _stem = n.startsWith("ال") ? n.slice(2) : n;

  let _lockReason = "measure";
  if (morphoNoun) {
    _lockReason = "definite_article";
  } else if (/Form (IV|V|VI|VII|VIII|X)/.test(_msr || "")) {
    _lockReason = "measure";
  } else if (/present|future|imperfect/.test(_mm)) {
    _lockReason = "prefix";
  } else if (/plural|3rd (feminine|masculine)|1st/.test(_mm)) {
    _lockReason = "suffix";
  }

  let _expl;
  if (morphoNoun) {
    _expl = "Definite noun — ال prefix locks as Noun (Arabic verbs never take ال)";
  } else if (_msr === "Form VIII") {
    _expl = `Form VIII verb — اِفتَعَلَ pattern (prefix ${_stem.slice(0,3)})`;
  } else if (_msr === "Form X")  { _expl = "Form X verb — اِستَفعَلَ pattern (استـ prefix)"; }
  else if (_msr === "Form VII")  { _expl = "Form VII verb — اِنفَعَلَ pattern (انـ prefix)"; }
  else if (_msr === "Form V")    { _expl = "Form V verb — تَفَعَّلَ pattern (تـ prefix)"; }
  else if (_msr === "Form VI")   { _expl = "Form VI verb — تَفَاعَلَ pattern (تـ prefix)"; }
  else if (_msr === "Form IV")   { _expl = "Form IV verb — أَفعَلَ pattern (اـ prefix)"; }
  else if (_msr === "Form I")    { _expl = "Form I verb — فَعَلَ pattern"; }
  else if (_lockReason === "suffix") {
    _expl = /plural/.test(_mm)
      ? "Past 3rd plural masculine — وا suffix is an unambiguous verb marker"
      : /3rd feminine/.test(_mm)
        ? "Past 3rd feminine singular — ت suffix is an unambiguous verb marker"
        : "Conjugation suffix confirms verbal classification";
  } else if (_lockReason === "prefix") {
    const _pn = {"ي":"يـ (3rd masc.)","ت":"تـ (2nd/3rd fem.)","ن":"نـ (1st pl.)","أ":"أـ (1st sg.)","ا":"اـ (1st sg.)","س":"سـ (future)"};
    _expl = `Present/future verb — ${_pn[n[0]] || n[0]} prefix marks imperfect`;
  } else {
    _expl = "Arabic morphological pattern confirms classification";
  }

  return {
    token:          word,
    classification: cls.label,
    lockReason:     _lockReason,
    measure:        _msr ? _msr.replace("Form ", "") : null,
    pattern:        _msr ? (_FORM_PAT[_msr] || null) : null,
    root:           _extractRoot(_stem, _msr),
    confidence:     "high",
    explanation:    _expl,
    source:         "Arabic morphology",
  };
}

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function check(desc, word, cls, morphoVerb, morphoNoun, expected) {
  const p = buildPayload(word, cls, morphoVerb, morphoNoun);

  if (expected === null) {
    // Expect NO payload
    if (p === null) {
      passed++;
      console.log(`  PASS: ${word.padEnd(14)} — no payload (correct)`);
    } else {
      failed++;
      console.log(`  FAIL: ${word.padEnd(14)} — got payload when none expected: ${JSON.stringify(p)}`);
    }
    return;
  }

  // Expect a payload — check each specified field
  if (p === null) {
    failed++;
    console.log(`  FAIL: ${word.padEnd(14)} — payload is null, expected fields: ${JSON.stringify(expected)}`);
    return;
  }

  const errors = [];
  for (const [k, v] of Object.entries(expected)) {
    if (v === "ANY") continue; // skip exact match
    if (p[k] !== v) errors.push(`${k}: got="${p[k]}" want="${v}"`);
  }

  if (errors.length === 0) {
    passed++;
    console.log(`  PASS: ${word.padEnd(14)} → ${p.classification} (${p.lockReason}) measure=${p.measure} root=${p.root}`);
  } else {
    failed++;
    console.log(`  FAIL: ${word.padEnd(14)} — ${errors.join(", ")}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 1 — Form VIII verbs (اِفتَعَلَ pattern)
// classifyBase returns: { label:"Verb", morph:"past", measure:"Form VIII" }
// _morphoVerb = true (via Form VIII measure)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[1] Form VIII (اِفتَعَلَ) — lockReason=measure, root extracted");

check("1a اجتمع",
  "اجتمع",
  { label:"Verb", morph:"past", measure:"Form VIII" },
  true, false,
  { token:"اجتمع", classification:"Verb", lockReason:"measure",
    measure:"VIII", pattern:"اِفتَعَلَ", root:"جمع",
    confidence:"high", source:"Arabic morphology" }
);

check("1b اقترح",
  "اقترح",
  { label:"Verb", morph:"past", measure:"Form VIII" },
  true, false,
  { token:"اقترح", classification:"Verb", lockReason:"measure",
    measure:"VIII", pattern:"اِفتَعَلَ", root:"قرح",
    confidence:"high", source:"Arabic morphology" }
);

check("1c اختار (hollow — root=null)",
  "اختار",
  { label:"Verb", morph:"past", measure:"Form VIII" },
  true, false,
  // اختار: ا-خ-ت-ا-ر → stem[3]="ا" → hollow root → null
  { token:"اختار", classification:"Verb", lockReason:"measure",
    measure:"VIII", pattern:"اِفتَعَلَ", root:null,
    confidence:"high", source:"Arabic morphology" }
);

check("1d استضافتها → Form X (clitic)",
  "استضافتها",
  { label:"Verb", morph:"past, 3rd feminine singular", measure:"Form X" },
  true, false,
  { token:"استضافتها", classification:"Verb", lockReason:"measure",
    measure:"X", pattern:"اِستَفعَلَ",
    confidence:"high", source:"Arabic morphology" }
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 2 — Form VII verbs (اِنفَعَلَ pattern)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] Form VII (اِنفَعَلَ) — lockReason=measure, root extracted");

check("2a انسحب",
  "انسحب",
  { label:"Verb", morph:"past", measure:"Form VII" },
  true, false,
  { token:"انسحب", classification:"Verb", lockReason:"measure",
    measure:"VII", pattern:"اِنفَعَلَ", root:"سحب",
    confidence:"high", source:"Arabic morphology" }
);

check("2b انخرط",
  "انخرط",
  { label:"Verb", morph:"past", measure:"Form VII" },
  true, false,
  { token:"انخرط", classification:"Verb", lockReason:"measure",
    measure:"VII", pattern:"اِنفَعَلَ", root:"خرط",
    confidence:"high", source:"Arabic morphology" }
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 3 — Form X verbs (اِستَفعَلَ pattern)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] Form X (اِستَفعَلَ) — lockReason=measure, root extracted");

check("3a استخدم",
  "استخدم",
  { label:"Verb", morph:"past", measure:"Form X" },
  true, false,
  { token:"استخدم", classification:"Verb", lockReason:"measure",
    measure:"X", pattern:"اِستَفعَلَ", root:"خدم",
    confidence:"high", source:"Arabic morphology" }
);

check("3b استمر (doubled root — shadda stripped → 5 chars → root=null)",
  "استمر",
  { label:"Verb", morph:"past", measure:"Form X" },
  true, false,
  // استمرّ = Form X of م-ر-ر; after diacritic strip → 5 letters, < 6 minimum → root null
  { token:"استمر", classification:"Verb", lockReason:"measure",
    measure:"X", pattern:"اِستَفعَلَ", root:null,
    confidence:"high", source:"Arabic morphology" }
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 4 — وا suffix (past 3rd masculine plural, هم)
// lockReason=suffix, measure from classifyBase (or null for short stems)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] وا suffix (past 3rd plural) — lockReason=suffix");

check("4a صوتوا",
  "صوتوا",
  { label:"Verb", morph:"past, 3rd masculine plural / imperative plural", measure:"Form I" },
  true, false,
  { token:"صوتوا", classification:"Verb", lockReason:"suffix",
    measure:"I", pattern:"فَعَلَ",
    confidence:"high", source:"Arabic morphology" }
);

check("4b قرروا",
  "قرروا",
  { label:"Verb", morph:"past, 3rd masculine plural / imperative plural", measure:"Form I" },
  true, false,
  { token:"قرروا", classification:"Verb", lockReason:"suffix",
    measure:"I", pattern:"فَعَلَ",
    confidence:"high", source:"Arabic morphology" }
);

check("4c اتفقوا (Form VIII of weak root وفق — pattern guard fails → root=null)",
  "اتفقوا",
  { label:"Verb", morph:"past, 3rd masculine plural / imperative plural", measure:"Form VIII" },
  true, false,
  // اتفق = اِتَّفَقَ: root و-ف-ق, initial و merges with ت → ا-ت-ف-ق-وا.
  // Pattern guard /^ا[^ل]ت/ requires char[2]='ت', but here char[2]='ف' → no match → root=null.
  { token:"اتفقوا", classification:"Verb", lockReason:"measure",
    measure:"VIII", pattern:"اِفتَعَلَ", root:null,
    confidence:"high", source:"Arabic morphology" }
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 5 — ت suffix (past 3rd feminine singular, هي)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] ت suffix (past 3rd feminine singular) — lockReason=suffix");

check("5a قالت",
  "قالت",
  { label:"Verb", morph:"past, 3rd feminine singular", measure:"Form I" },
  true, false,
  { token:"قالت", classification:"Verb", lockReason:"suffix",
    measure:"I", pattern:"فَعَلَ",
    confidence:"high", source:"Arabic morphology" }
);

check("5b أكدت",
  "أكدت",
  { label:"Verb", morph:"past, 3rd feminine singular", measure:"Form I" },
  true, false,
  { token:"أكدت", classification:"Verb", lockReason:"suffix",
    confidence:"high", source:"Arabic morphology" }
);

check("5c اعلنت",
  "اعلنت",
  { label:"Verb", morph:"past, 3rd feminine singular", measure:"Form IV" },
  true, false,
  { token:"اعلنت", classification:"Verb", lockReason:"measure",
    measure:"IV", pattern:"أَفعَلَ",
    confidence:"high", source:"Arabic morphology" }
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 6 — Present prefix يـ/تـ/نـ (imperfect)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6] Present/future prefix — lockReason=prefix");

check("6a يتحدث",
  "يتحدث",
  { label:"Verb", morph:"present", measure:"Form V" },
  true, false,
  { token:"يتحدث", classification:"Verb", lockReason:"measure",
    measure:"V", pattern:"تَفَعَّلَ",
    confidence:"high", source:"Arabic morphology" }
);

check("6b يشارك (present, qualifier path)",
  "يشارك",
  { label:"Verb", qualifier:"present, transitive", measure:null },
  true, false,
  { token:"يشارك", classification:"Verb", lockReason:"prefix",
    measure:null, pattern:null,
    confidence:"high", source:"Arabic morphology" }
);

check("6c نشارك",
  "نشارك",
  { label:"Verb", morph:"present", measure:null },
  true, false,
  { token:"نشارك", classification:"Verb", lockReason:"prefix",
    confidence:"high", source:"Arabic morphology" }
);

check("6d سيشارك (future)",
  "سيشارك",
  { label:"Verb", morph:"future", measure:null },
  true, false,
  { token:"سيشارك", classification:"Verb", lockReason:"prefix",
    confidence:"high", source:"Arabic morphology" }
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 7 — ال definite article → lockReason=definite_article
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[7] ال definite article → lockReason=definite_article");

check("7a المجلس",
  "المجلس",
  { label:"Noun", morph:"definite" },
  false, true,
  { token:"المجلس", classification:"Noun", lockReason:"definite_article",
    measure:null, pattern:null, root:null,
    confidence:"high",
    explanation:"Definite noun — ال prefix locks as Noun (Arabic verbs never take ال)",
    source:"Arabic morphology" }
);

check("7b الحكومة",
  "الحكومة",
  { label:"Noun", morph:"feminine singular" },  // D1 fires before D2 for ة-ending
  false, true,
  { token:"الحكومة", classification:"Noun", lockReason:"definite_article",
    measure:null, root:null,
    confidence:"high", source:"Arabic morphology" }
);

check("7c المقررة",
  "المقررة",
  { label:"Noun", morph:"feminine singular" },
  false, true,
  { token:"المقررة", classification:"Noun", lockReason:"definite_article",
    confidence:"high", source:"Arabic morphology" }
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 8 — NO payload when English-gloss override fired (_sal set)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[8] English-gloss override (_sal set) → NO payload");

check("8a Rule NB (RNB) override",
  "يعمل",
  { label:"Noun", _sal:"RNB", gloss:"work" },  // Rule NB fired
  true, false,                                   // _morphoVerb was true before NB
  null                                           // no payload — _sal is set
);

check("8b Rule V (RV) override",
  "شهد",
  { label:"Verb", _sal:"RV" },                   // Rule V fired
  false, false,
  null
);

check("8c Proper name (PN) override",
  "رويترز",
  { label:"Noun", subtype:"proper noun", _sal:"PN", gloss:"Reuters" },
  false, false,
  null
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 9 — NO payload when neither morphoVerb nor morphoNoun
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[9] Neither morphoVerb nor morphoNoun → NO payload");

check("9a Ambiguous Form I (low-confidence)",
  "قتل",
  { label:"Verb", morph:"past, passive", voice:"passive" },
  false, false,
  null
);

check("9b Verbal noun (KNOWN_NOUNS path)",
  "نشر",
  { label:"Noun", subtype:"verbal noun" },
  false, false,
  null
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUP 10 — Payload field integrity check
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[10] All 9 required fields present on every payload");

const _REQ_FIELDS = ["token","classification","lockReason","measure","pattern","root","confidence","explanation","source"];

function checkFields(word, cls, mv, mn) {
  const p = buildPayload(word, cls, mv, mn);
  if (!p) {
    failed++;
    console.log(`  FAIL: ${word.padEnd(14)} — payload is null, expected fields`);
    return;
  }
  const missing = _REQ_FIELDS.filter(f => !(f in p));
  if (missing.length === 0) {
    passed++;
    console.log(`  PASS: ${word.padEnd(14)} — all 9 fields present`);
  } else {
    failed++;
    console.log(`  FAIL: ${word.padEnd(14)} — missing fields: ${missing.join(", ")}`);
  }
}

checkFields("اجتمع",  { label:"Verb", morph:"past", measure:"Form VIII" }, true,  false);
checkFields("انسحب",  { label:"Verb", morph:"past", measure:"Form VII" },  true,  false);
checkFields("صوتوا",  { label:"Verb", morph:"past, 3rd masculine plural / imperative plural", measure:"Form I" }, true, false);
checkFields("قالت",   { label:"Verb", morph:"past, 3rd feminine singular", measure:"Form I" }, true, false);
checkFields("يتحدث", { label:"Verb", morph:"present", measure:"Form V" }, true, false);
checkFields("المجلس", { label:"Noun", morph:"definite" }, false, true);

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(72));
console.log(`TOTAL: ${passed + failed}  PASS: ${passed}  FAIL: ${failed}`);
if (failed === 0) {
  console.log("✅ ALL MORPHO PAYLOAD GENERATION TESTS PASS");
} else {
  console.log("❌ SOME TESTS FAILED");
  process.exit(1);
}
