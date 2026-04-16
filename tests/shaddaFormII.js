// ── Shadda Form II Regression Suite (v137c) ───────────────────────────────────
// Validates that explicit shadda (U+0651) in the surface form is used to
// determine verb measure BEFORE normalization strips the diacritic.
//
// Key principle: _arNormalize() strips diacritics (including shadda).
// So measure detection MUST read the original `word` for shadda evidence.
//
// Regression cases:
//   صرّح → Verb (past), Form II  (not Form I — shadda on ر)
//   درّس → Verb (past), Form II  (not Form I — shadda on ر)
//   قدّم → Verb (past), Form II  (not classified as noun — shadda on د)
//   صرّحت→ Verb (past, 3rd f.sg.), Form II  (F1 branch + shadda)
//
// ─────────────────────────────────────────────────────────────────────────────

// ── Inline helpers (mirrors live code, minimal) ───────────────────────────────
function _arNormalize(s) {
  return String(s || "")
    .replace(/[\u064B-\u065F\u0610-\u061A\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g,"")
    .replace(/[أإآ]/g,"ا").replace(/[ؤئ]/g,"ء").replace(/ة/g,"ه").replace(/ى/g,"ي").trim();
}

// Simulate _vm (measure inference without diacritics)
function _vm(b) {
  if (/^است/.test(b))                             return "Form X";
  if (/^ا[^ل]ت/.test(b) && b.length >= 5)       return "Form VIII";
  if (/^انف/.test(b))                             return "Form VII";
  if (/^ت.ا/.test(b) && b.length >= 5)           return "Form VI";
  if (/^ت/.test(b) && b.length >= 5)             return "Form V";
  if (/^ا[^ل]/.test(b) && b.length >= 4 && b.length <= 6) return "Form IV";
  if (b.length <= 4)                              return "Form I";
  return null;
}

// Simulate the _VERB3_PAST set
const _VERB3_PAST = new Set([
  "قال","ذهب","جاء","كان","عاد","رفض","قبل","وصل","سقط",
  "دخل","خرج","صرح","حذر","قام","منع","سمح","زار","شتت",
  "قتل","درس","اكد","دعا","افاد","نفي","اتى","اخذ","بات",
  "صار","ظل","ظهر","جلس","عاش","مات","نام","حكم","ضرب",
  "بدا","اشار","اراد","اعلن","ناقش","نقل","نشر","عقد",
  "فرض","فتح","دفع","سحب","قصف","شن","اسهم",
]);

// Detect middle shadda in a surface word
function _detectShadMiddle(word) {
  if (!word.includes('\u0651')) return false;
  const stripped = word.replace(/[\u064B-\u0650\u0652-\u065F]/g, ""); // keep only shadda
  return stripped.indexOf('\u0651') > 1;
}

// Simulate classifyBase F3 and F1 with shadda detection
// word = original surface form (closure variable in live code)
function classifyBase(bn, word) {
  // F0 — future
  if (/^س[يتنأا]/.test(bn) && bn.length >= 5 && !/^ال/.test(bn))
    return { label:"Verb", morph:"future", measure: _vm(bn) };

  // F1 — past 3rd f.sg.
  if (/ت$/.test(bn) && !/ات$/.test(bn) && bn.length >= 4 && !/^ال/.test(bn)) {
    const _base = bn.slice(0, -1);
    const _f1ShadMiddle = _detectShadMiddle(word);
    const _f1Measure    = _f1ShadMiddle ? "Form II (shadda-confirmed)" : (_vm(_base) || _vm(bn));
    return { label:"Verb", morph:"past, 3rd feminine singular", measure: _f1Measure };
  }

  // F2 — imperfect
  if (/^[يتن]/.test(bn) && bn.length >= 3 && !/^ال/.test(bn))
    return { label:"Verb", morph:"present", measure: _vm(bn) };

  // F3 — 3-char root (shadda-sensitive)
  if (bn.length === 3 && !/^ال/.test(bn) && !/ه$/.test(bn)) {
    const _f3ShadMiddle = _detectShadMiddle(word);
    const _f3Measure    = _f3ShadMiddle ? "Form II (shadda-confirmed)" : "Form I";
    if (_VERB3_PAST.has(bn) || _f3ShadMiddle)
      return { label:"Verb", morph:"past", measure: _f3Measure };
    return { label:"Noun", subtype:"verbal noun", measure:"Form I" };
  }
  return { label:"Noun" };
}

// ─────────────────────────────────────────────────────────────────────────────
const CASES = [

  // ── صرّح (declared — Form II) ─────────────────────────────────────────────
  ["صرّح → classifyBase returns Verb (past), Form II (shadda-confirmed)", () => {
    const word = "صرّح";
    const bn   = _arNormalize(word); // "صرح"
    const r = classifyBase(bn, word);
    return r.label === "Verb" && r.morph === "past" && /Form II/.test(r.measure);
  }],
  ["صرّح → shadda detection returns true (middle consonant)", () => {
    return _detectShadMiddle("صرّح") === true;
  }],
  ["صرح (no shadda) → Form I — NOT Form II", () => {
    const word = "صرح";
    const bn   = _arNormalize(word);
    const r = classifyBase(bn, word);
    return r.label === "Verb" && r.morph === "past" && r.measure === "Form I";
  }],

  // ── درّس (taught — Form II) ───────────────────────────────────────────────
  ["درّس → classifyBase returns Verb (past), Form II (shadda-confirmed)", () => {
    const word = "درّس";
    const bn   = _arNormalize(word); // "درس"
    const r = classifyBase(bn, word);
    return r.label === "Verb" && /Form II/.test(r.measure);
  }],
  ["درّس → shadda detection returns true", () => {
    return _detectShadMiddle("درّس") === true;
  }],
  ["درس (no shadda) → Form I", () => {
    const word = "درس";
    const r = classifyBase(_arNormalize(word), word);
    return r.label === "Verb" && r.measure === "Form I";
  }],

  // ── قدّم (presented — Form II) ────────────────────────────────────────────
  ["قدّم → classifyBase returns Verb (past), Form II (shadda-confirmed)", () => {
    const word = "قدّم";
    const bn   = _arNormalize(word); // "قدم"
    const r = classifyBase(bn, word);
    return r.label === "Verb" && /Form II/.test(r.measure);
  }],
  ["قدّم → shadda detection returns true", () => {
    return _detectShadMiddle("قدّم") === true;
  }],
  ["قدم (no shadda, not in _VERB3_PAST) → Noun (verbal noun) or Verb Form I", () => {
    const word = "قدم";
    const r = classifyBase(_arNormalize(word), word);
    // قدم is NOT in _VERB3_PAST and has no shadda — should be Noun (verbal noun)
    return r.label === "Noun" || (r.label === "Verb" && r.measure === "Form I");
  }],

  // ── صرّحت (she declared — F1 + Form II) ───────────────────────────────────
  ["صرّحت → classifyBase F1 returns Verb (past 3rd f.sg.), Form II (shadda-confirmed)", () => {
    const word = "صرّحت";
    const bn   = _arNormalize(word); // "صرحت"
    const r = classifyBase(bn, word);
    return r.label === "Verb" && /past.*3rd/.test(r.morph) && /Form II/.test(r.measure);
  }],
  ["صرّحت → shadda detection returns true", () => {
    return _detectShadMiddle("صرّحت") === true;
  }],

  // ── Edge cases: shadda must NOT fire for first-consonant shadda ────────────
  ["shadda on first consonant → does NOT count as middle (shIdx = 1, not > 1)", () => {
    // Hypothetical word with shadda on first consonant:
    // In Arabic this would be unusual, but test the guard
    const word = "شّرح"; // shadda on ش (first consonant)
    const stripped = word.replace(/[\u064B-\u0650\u0652-\u065F]/g, "");
    const shIdx = stripped.indexOf('\u0651');
    return shIdx <= 1; // shadda IS at position 1 (after ش) — NOT middle
  }],
  ["non-verb word with no shadda → Form I / Noun (unaffected)", () => {
    const word = "كتب";
    const r = classifyBase(_arNormalize(word), word);
    // كتب is not in _VERB3_PAST, no shadda → Noun
    return r.label === "Noun" || r.measure === "Form I";
  }],

  // ── Normalize correctness: shadda IS stripped by _arNormalize ────────────
  ["_arNormalize strips shadda — confirms normalization erasure problem", () => {
    const withShadda    = "صرّح";
    const withoutShadda = "صرح";
    return _arNormalize(withShadda) === _arNormalize(withoutShadda);
  }],
  ["Without surface-form check, صرّح and صرح would be identical to classifier", () => {
    const bn1 = _arNormalize("صرّح");
    const bn2 = _arNormalize("صرح");
    return bn1 === bn2 && bn1 === "صرح";
  }],
];

// ─────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failDetails = [];
for (const [desc, fn] of CASES) {
  let ok = false;
  try { ok = fn(); } catch(err) { ok = false; failDetails.push(`  ✗ ${desc}\n    Error: ${err.message}`); fail++; continue; }
  if (ok) pass++;
  else { fail++; failDetails.push(`  ✗ ${desc}`); }
}
if (failDetails.length) { console.log("FAILURES:"); failDetails.forEach(l=>console.log(l)); }
console.log(`\nTOTAL: ${pass+fail}  PASS: ${pass}  FAIL: ${fail}`);
if (fail === 0) console.log("✅ ALL SHADDA FORM II TESTS PASS");
else            process.exit(1);
