// ── Semantic Anchor Layer Regression Suite (v137 hard-lock revision) ────────
//
//  Tests the Stage 3 SAL rules and the Step 2c-A hard PERSON lock.
//  Covers all six live-failure regression cases:
//    ترمب, إسحاق, دار, روبيو, ستارمر, سيلتقي, يسهم, صرح, وتأتي
//
//  Rule 1 — Proper Name Override  (span + verb/VN → surname)
//  Rule 2 — Common Noun Override  (personal name label + GLOSS; PERSON guard)
//  Rule 3 — Verb Override         (imperfect prefix + Noun; entity guard)
//  Rule 4 — Title Chain Protection(afterTitle + GLOSS → title component)
//  Rule 5 — Multi-token Span Lock (span member + non-verb Noun)
//  Rule 6 — Contradiction Blocker (catch-all)
//  Step 2c-A Hard PERSON Lock     (entity map bypass of verb-prefix guard)
//  Entity Map Builder             (PERSON verb-guard exception; GLOSS exception)
// ─────────────────────────────────────────────────────────────────────────────

function _arNormalize(s) {
  return String(s || "")
    .replace(/[\u064B-\u065F\u0610-\u061A\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g,"")
    .replace(/[أإآ]/g,"ا").replace(/[ؤئ]/g,"ء").replace(/ة/g,"ه").replace(/ى/g,"ي").trim();
}

// ── Mini _waGloss ─────────────────────────────────────────────────────────────
const _GDICT = {
  "طاقه":"energy","خارجيه":"foreign affairs / external","خارجي":"foreign / external",
  "وزير":"minister","رءيس":"president","دوله":"state","اسبوع":"week",
  "سلام":"peace","حكومه":"government","يسهم":"contribute / play a role",
  "سياسه":"policy","دار":"house / abode","اسحاق":"crushing / grinding down",
};
function _waGloss(raw) {
  const n = _arNormalize(raw);
  let g = _GDICT[n]; if (g) return g;
  const noAl = n.startsWith("ال") ? n.slice(2) : n;
  if (noAl !== n) { g = _GDICT[noAl]; if (g) return g; }
  const nc = n.replace(/^[وفبكل]ال/,"");
  if (nc !== n) { g = _GDICT[nc]; if (g) return g; }
  const nc2 = n.replace(/^[وفبكل]/,"");
  if (nc2 !== n && nc2.length >= 2) {
    g = _GDICT[nc2]; if (g) return g;
    const nca = nc2.startsWith("ال") ? nc2.slice(2) : nc2;
    if (nca !== nc2) { g = _GDICT[nca]; if (g) return g; }
  }
  return null;
}

// ── Updated entity map builder (mirrors live code after v137 hard-lock fix) ──
// Key differences from old version:
//   1. Verb guard EXEMPTS PERSON entities (ترمب starts with تـ but IS a person)
//   2. PERSON entities always go to entityMap regardless of hasGloss
//      (إسحاق has GLOSS "crushing" but IS a personal name)
function buildMaps(entities, passage) {
  const spanMap = Object.create(null), entityMap = Object.create(null);
  const rawSet = new Set(), rawMap = Object.create(null);
  for (const ent of entities) {
    if (!ent.arabic || !ent.type) continue;
    for (const tok of ent.arabic.split(/\s+/)
        .map(t => _arNormalize(t.replace(/[،؟.,!:؛]/g,"").trim()))
        .filter(t => t && t.length >= 2)) {
      rawSet.add(tok);
      if (!rawMap[tok]) rawMap[tok] = ent.type;
    }
  }
  const passNorms = (passage||"").split(/\s+/)
    .map(t => _arNormalize(t.replace(/[،؟.,!:؛()]/g,"").trim()))
    .filter(Boolean);

  for (const [norm, type] of Object.entries(rawMap)) {
    // VERB GUARD — PERSON exception: names like ترمب (تـ prefix), إسحاق (اـ prefix)
    // are NOT verbs and must not be skipped.  Guard applies only to non-PERSON.
    if (type !== "PERSON" &&
        (/^[يتنأ].{2,}/.test(norm) ||
         /^(وت|وي|فت|في|وسي|فسي|س[يتن][^اوي])/.test(norm))) continue;

    const idx = passNorms.indexOf(norm);
    let isSpan = false;
    if (idx >= 0) {
      const p  = idx > 0                  ? passNorms[idx - 1] : null;
      const nx = idx < passNorms.length-1 ? passNorms[idx + 1] : null;
      isSpan = (p && rawSet.has(p)) || (nx && rawSet.has(nx));
    }
    const hasG = !!_waGloss(norm);

    if (isSpan) {
      spanMap[norm] = type;
    } else if (!hasG || type === "PERSON") {
      // PERSON always stored; non-PERSON only if no GLOSS
      entityMap[norm] = type;
    }
  }
  return { spanMap, entityMap };
}

// ── Step 2c-A simulator (hard PERSON lock) ────────────────────────────────────
// Mirrors the new Step 2c-A in _buildFallbackTooltip.
// Returns { fired:true, morph } if the hard lock fires; { fired:false } otherwise.
function simulateStep2cA(n, spanMap, entityMap) {
  const inSpan = !!(spanMap[n]   === "PERSON");
  const inEnt  = !!(entityMap[n] === "PERSON");
  if (!inSpan && !inEnt) return { fired: false };
  const morph = inSpan
    ? "name component (translation-confirmed)"
    : "personal name (translation-confirmed)";
  return { fired: true, label:"Noun", subtype:"proper noun", morph };
}

// ── SAL rule simulator ────────────────────────────────────────────────────────
function simulateSAL(n, currentLabel, currentSubtype, spanMap, entityMap, afterTitle=false) {
  const _salGloss  = _waGloss(n);
  const _salInSpan = !!spanMap[n];
  const _salInEnt  = !!entityMap[n];
  const _salType   = _salInSpan ? spanMap[n] : _salInEnt ? entityMap[n] : null;
  const _salIsPN   = currentLabel === "Noun" &&
                     /^(proper|given|personal|name|surname|title)/.test((currentSubtype||"").toLowerCase());
  const _salIsVerb = currentLabel === "Verb";
  const _salIsVN   = currentLabel === "Noun" && currentSubtype === "verbal noun";

  // Rule 1
  if (_salInSpan && _salType === "PERSON" && (_salIsVerb || _salIsVN))
    return { rule:"R1", label:"Noun", subtype:"proper noun", morph:"surname (translation-confirmed)" };

  // Rule 2 — PERSON guard: do NOT fire for confirmed PERSON entities
  if (_salIsPN && _salGloss && _salType !== "PERSON") {
    const isNisba = /(?:يه|ية|ي)$/.test(n) && n.length > 3 && !n.startsWith("ال");
    if (isNisba)    return { rule:"R2", label:"Adjective", subtype:"nisba (context confirmed)" };
    if (afterTitle) return { rule:"R4", label:"Noun", subtype:"title component (context confirmed)" };
    return { rule:"R2", label:"Noun", subtype:"common noun (context confirmed)" };
  }

  // Rule 3 — also guard against entity map membership
  if (currentLabel === "Noun" && !_salIsPN && !_salInSpan && !_salInEnt &&
      (/^[يتن].{2,}/.test(n) || /^س[يتن][^اوي]/.test(n)))
    return { rule:"R3", label:"Verb", morph:"imperfect (context confirmed)" };

  // Rule 5
  if (_salInSpan && _salType === "PERSON" && !_salIsPN && !_salIsVerb && !_salIsVN)
    return { rule:"R5", label:"Noun", subtype:"proper noun", morph:"name component (translation-confirmed)" };

  // Rule 6
  if (_salIsPN && _salGloss && _salType !== "PERSON")
    return { rule:"R6", label:"Noun", subtype:"common noun (context confirmed)" };

  return { rule:null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test cases
// ─────────────────────────────────────────────────────────────────────────────
const CASES = [

  // ══ Entity Map Builder — PERSON verb-guard exception ══════════════════════
  ["Builder: ترمب (PERSON, تـ prefix) → entityMap despite verb-guard", () => {
    // Old code: verb guard excluded ترمب because it starts with تـ → never in any map
    // New code: type===PERSON exempts it from the verb guard
    const { entityMap } = buildMaps([{arabic:"ترمب", type:"PERSON"}], "صرح ترمب اليوم");
    return entityMap[_arNormalize("ترمب")] === "PERSON";
  }],
  ["Builder: إسحاق (PERSON, GLOSS 'crushing') → entityMap despite hasGloss", () => {
    // Old code: hasGloss excluded إسحاق → never in entityMap when standalone
    // New code: type===PERSON always goes to entityMap
    const { entityMap } = buildMaps([{arabic:"إسحاق", type:"PERSON"}], "التقى إسحاق بالوفد");
    return entityMap[_arNormalize("إسحاق")] === "PERSON";
  }],
  ["Builder: دار (PERSON span, GLOSS 'house') → spanMap when adjacent", () => {
    const { spanMap } = buildMaps([{arabic:"إسحاق دار", type:"PERSON"}], "ناقش إسحاق دار الوضع");
    return spanMap[_arNormalize("دار")] === "PERSON";
  }],
  ["Builder: روبيو (PERSON, no GLOSS, no verb prefix) → entityMap", () => {
    const { entityMap } = buildMaps([{arabic:"روبيو", type:"PERSON"}], "التقى روبيو بنظيره");
    return entityMap[_arNormalize("روبيو")] === "PERSON";
  }],
  ["Builder: ستارمر (PERSON, no GLOSS) → entityMap — NOT blocked by verb pattern", () => {
    // ستارمر starts with "ستا" — /^س[يتن][^اوي]/ tests ستا → 'ا' IS in [اوي] → pattern fails → NOT excluded
    const n = _arNormalize("ستارمر"); // "ستارمر"
    const verbPat = /^س[يتن][^اوي]/.test(n);
    const { entityMap } = buildMaps([{arabic:"ستارمر", type:"PERSON"}], "سياسة ستارمر الخارجية");
    return !verbPat && entityMap[n] === "PERSON";
  }],
  ["Builder: يسهم (non-PERSON, verb prefix) → excluded (correct)", () => {
    // يسهم is a verb, not a name; verb guard SHOULD exclude it
    const { entityMap, spanMap } = buildMaps([{arabic:"يسهم", type:"ORG"}], "يسهم القطاع في النمو");
    return !entityMap[_arNormalize("يسهم")] && !spanMap[_arNormalize("يسهم")];
  }],

  // ══ Step 2c-A — Hard PERSON lock ══════════════════════════════════════════
  ["Step 2c-A: ترمب in entityMap → hard lock fires → proper noun", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"ترمب", type:"PERSON"}], "صرح ترمب اليوم");
    const r = simulateStep2cA(_arNormalize("ترمب"), spanMap, entityMap);
    return r.fired && r.label === "Noun" && r.subtype === "proper noun" &&
           /personal name/.test(r.morph);
  }],
  ["Step 2c-A: إسحاق alone in passage → hard lock fires via entityMap", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"إسحاق", type:"PERSON"}], "التقى إسحاق بالوفد");
    const r = simulateStep2cA(_arNormalize("إسحاق"), spanMap, entityMap);
    return r.fired && r.label === "Noun";
  }],
  ["Step 2c-A: دار in span → hard lock fires → name component", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"إسحاق دار", type:"PERSON"}], "ناقش إسحاق دار الوضع");
    const r = simulateStep2cA(_arNormalize("دار"), spanMap, entityMap);
    return r.fired && /name component/.test(r.morph);
  }],
  ["Step 2c-A: الطاقة (PERSON not in maps) → does NOT fire", () => {
    // الطاقة is energy, never a person name; not in entity map
    const { spanMap, entityMap } = buildMaps([{arabic:"ترمب", type:"PERSON"}], "ترمب والطاقة");
    const r = simulateStep2cA(_arNormalize("الطاقة"), spanMap, entityMap);
    return !r.fired;
  }],

  // ══ Rule 1 — Proper Name Override ════════════════════════════════════════
  ["R1: دار (span+PERSON+Verb) → proper noun — surname", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"إسحاق دار", type:"PERSON"}], "بحث إسحاق دار مع الوفد");
    const r = simulateSAL("دار","Verb","",spanMap,entityMap);
    return r.rule === "R1" && r.label === "Noun" && /surname/.test(r.morph);
  }],
  ["R1: دار (span+PERSON+verbal noun) → proper noun — surname", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"إسحاق دار", type:"PERSON"}], "بحث إسحاق دار مع الوفد");
    const r = simulateSAL("دار","Noun","verbal noun",spanMap,entityMap);
    return r.rule === "R1" && r.label === "Noun" && /surname/.test(r.morph);
  }],

  // ══ Rule 2 — Common Noun Override (with PERSON guard) ════════════════════
  ["R2: الطاقة (personal name label + GLOSS, not PERSON) → common noun", () => {
    const r = simulateSAL(_arNormalize("الطاقة"),"Noun","proper noun",Object.create(null),Object.create(null));
    return r.rule === "R2" && r.label === "Noun" && /common noun/.test(r.subtype);
  }],
  ["R2: خارجية (personal name + GLOSS, nisba) → Adjective", () => {
    const r = simulateSAL(_arNormalize("خارجية"),"Noun","personal name",Object.create(null),Object.create(null));
    return r.rule === "R2" && r.label === "Adjective";
  }],
  ["R2-GUARD: إسحاق (PERSON in entityMap + GLOSS 'crushing') → Rule 2 blocked", () => {
    // Rule 2 must NOT fire for PERSON entities — translation wins over GLOSS
    const { spanMap, entityMap } = buildMaps([{arabic:"إسحاق", type:"PERSON"}], "التقى إسحاق بالوفد");
    const r = simulateSAL(_arNormalize("إسحاق"),"Noun","personal name",spanMap,entityMap);
    return r.rule !== "R2";  // either no rule or R5, but never R2
  }],
  ["R2-GUARD: ترمب (PERSON in entityMap, personal name label) → Rule 2 blocked", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"ترمب", type:"PERSON"}], "صرح ترمب اليوم");
    const r = simulateSAL(_arNormalize("ترمب"),"Noun","personal name (contextual)",spanMap,entityMap);
    return r.rule !== "R2";
  }],

  // ══ Rule 3 — Verb Override (with entity guard) ════════════════════════════
  ["R3: يسهم (Noun label, not in any map) → Verb", () => {
    const r = simulateSAL(_arNormalize("يسهم"),"Noun","",Object.create(null),Object.create(null));
    return r.rule === "R3" && r.label === "Verb";
  }],
  ["R3: سيلتقي (Noun label, not in any map) → Verb", () => {
    const r = simulateSAL(_arNormalize("سيلتقي"),"Noun","",Object.create(null),Object.create(null));
    return r.rule === "R3" && r.label === "Verb";
  }],
  ["R3-GUARD: ترمب (PERSON entityMap, verb prefix تـ) → Rule 3 blocked", () => {
    // ترمب starts with تـ — without the entity guard, Rule 3 would misclassify it
    const { spanMap, entityMap } = buildMaps([{arabic:"ترمب", type:"PERSON"}], "صرح ترمب اليوم");
    const r = simulateSAL(_arNormalize("ترمب"),"Noun","",spanMap,entityMap);
    return r.rule !== "R3";
  }],
  ["R3: does NOT fire for ستارمر (ستا → 'ا' in [اوي], verb pattern fails)", () => {
    const r = simulateSAL(_arNormalize("ستارمر"),"Noun","",Object.create(null),Object.create(null));
    return r.rule !== "R3";
  }],

  // ══ Rule 4 — Title Chain Protection ══════════════════════════════════════
  ["R4 (via R2+afterTitle): الطاقة after وزير → title component", () => {
    const r = simulateSAL(_arNormalize("الطاقة"),"Noun","proper noun",Object.create(null),Object.create(null), true);
    return r.rule === "R4" && r.label === "Noun" && /title component/.test(r.subtype);
  }],

  // ══ Rule 5 — Multi-token Span Lock ═══════════════════════════════════════
  ["R5: إسحاق (span member, common Noun, not verb) → proper noun — name component", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"إسحاق دار", type:"PERSON"}], "بحث إسحاق دار مع الوفد");
    const r = simulateSAL(_arNormalize("إسحاق"),"Noun","",spanMap,entityMap);
    // Step 2c-A fires first in real code; in SAL simulator it's R5
    return (r.rule === "R5" || r.rule === null) && r.label !== "Verb";
  }],

  // ══ Spec Regression Cases ════════════════════════════════════════════════
  ["Spec: ترمب — entity map present → hard lock (Step 2c-A); Rule 3 blocked", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"دونالد ترمب", type:"PERSON"}], "صرح دونالد ترمب اليوم");
    const lock = simulateStep2cA(_arNormalize("ترمب"), spanMap, entityMap);
    return lock.fired && lock.label === "Noun";
  }],
  ["Spec: إسحاق — entity map present (even with GLOSS) → hard lock", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"إسحاق دار", type:"PERSON"}], "التقى إسحاق دار بالوفد");
    const lock = simulateStep2cA(_arNormalize("إسحاق"), spanMap, entityMap);
    return lock.fired;
  }],
  ["Spec: دار — span map → hard lock as name component", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"إسحاق دار", type:"PERSON"}], "التقى إسحاق دار بالوفد");
    const lock = simulateStep2cA(_arNormalize("دار"), spanMap, entityMap);
    return lock.fired && /name component/.test(lock.morph);
  }],
  ["Spec: روبيو — entity map → hard lock fires", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"ماركو روبيو", type:"PERSON"}], "التقى روبيو بوزير الخارجية");
    const lock = simulateStep2cA(_arNormalize("روبيو"), spanMap, entityMap);
    return lock.fired;
  }],
  ["Spec: ستارمر — entity map → hard lock fires; ستا NOT a verb prefix", () => {
    const { spanMap, entityMap } = buildMaps([{arabic:"كير ستارمر", type:"PERSON"}], "أعلن كير ستارمر موقفه");
    const lock = simulateStep2cA(_arNormalize("ستارمر"), spanMap, entityMap);
    return lock.fired;
  }],
  ["Spec: سيلتقي — not in entity map, verb prefix → R3 fires → Verb", () => {
    const r = simulateSAL(_arNormalize("سيلتقي"),"Noun","",Object.create(null),Object.create(null));
    return r.rule === "R3" && r.label === "Verb";
  }],
  ["Spec: يسهم — not in entity map, verb prefix → R3 fires → Verb", () => {
    const r = simulateSAL(_arNormalize("يسهم"),"Noun","",Object.create(null),Object.create(null));
    return r.rule === "R3" && r.label === "Verb";
  }],
  ["Spec: وتأتي — Step 3 (و prefix) handles it; SAL leaves Conjunction+ alone", () => {
    const r = simulateSAL(_arNormalize("وتأتي"),"Conjunction+","",Object.create(null),Object.create(null));
    return r.rule === null;
  }],
  ["Spec: بحسب — Preposition label; SAL does not touch it", () => {
    const r = simulateSAL(_arNormalize("بحسب"),"Preposition","",Object.create(null),Object.create(null));
    return r.rule === null;
  }],
  ["Spec: حيث — Discourse connector; SAL does not touch it", () => {
    const r = simulateSAL(_arNormalize("حيث"),"Discourse connector","",Object.create(null),Object.create(null));
    return r.rule === null;
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
if (fail === 0) console.log("✅ ALL SEMANTIC ANCHOR LAYER TESTS PASS");
else            process.exit(1);
