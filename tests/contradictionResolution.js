// ── Contradiction Resolution Suite ─────────────────────────────────────────
// Covers the three fixes delivered in v136d:
//   Fix 1 — multi-word entity span splitting (دار in إسحاق دار)
//   Fix 2 — contextual trigger GLOSS+verb guard (الطاقة, الخارجية, يسهم)
//   Fix 3 — post-classification contradiction resolver (Rule B + Rule C)
//
//  W. Entity span splitting — multi-word entity tokens
//  X. Rule A guard — contextual trigger blocked by GLOSS
//  Y. Rule C guard — contextual trigger blocked by verb prefix
//  Z. Rule B safety net — span-confirmed entity overrides wrong verb/verbal-noun label
// ─────────────────────────────────────────────────────────────────────────────

function _arNormalize(s) {
  return String(s || "")
    .replace(/[\u064B-\u065F\u0610-\u061A\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ؤئ]/g, "ء")
    .replace(/ة/g,    "ه")
    .replace(/ى/g,    "ي")
    .trim();
}

// ── Mock _waGloss (subset of the real dictionary) ────────────────────────────
const _GLOSS_DICT = {
  "طاقه":"energy","خارجيه":"foreign affairs / external (fem.)","خارجي":"foreign / external",
  "وزير":"minister","سيد":"master / Mr.","دار":"house / abode / Dar",
  "يسهم":"contribute / play a role","رءيس":"president","اسبوع":"week",
};
function _waGloss(raw) {
  const n = _arNormalize(raw);
  let g = _GLOSS_DICT[n]; if (g) return g;
  const noAl = n.startsWith("ال") ? n.slice(2) : n;
  if (noAl !== n) { g = _GLOSS_DICT[noAl]; if (g) return g; }
  const noClit = n.replace(/^[وفبكل]ال/, "");
  if (noClit !== n) { g = _GLOSS_DICT[noClit]; if (g) return g; }
  const noClitOnly = n.replace(/^[وفبكل]/,"");
  if (noClitOnly !== n && noClitOnly.length >= 2) {
    g = _GLOSS_DICT[noClitOnly]; if (g) return g;
    const nca = noClitOnly.startsWith("ال") ? noClitOnly.slice(2) : noClitOnly;
    if (nca !== noClitOnly) { g = _GLOSS_DICT[nca]; if (g) return g; }
  }
  return null;
}

// ── Mock entity map builder — simplified version of fetchSupportTranslation ─
function buildEntityMaps(entitiesFromAI, passageText) {
  const entityMap = Object.create(null);
  const spanMap   = Object.create(null);

  // Step 1: build raw candidate map — split multi-word spans into tokens
  const rawEntitySet = new Set();
  const rawEntityMap = Object.create(null);
  for (const ent of entitiesFromAI) {
    if (!ent.arabic || !ent.type) continue;
    const tokens = ent.arabic
      .split(/\s+/)
      .map(t => _arNormalize(t.replace(/[،؟.,!:؛]/g, "").trim()))
      .filter(t => t && t.length >= 2);
    for (const norm of tokens) {
      rawEntitySet.add(norm);
      if (!rawEntityMap[norm]) rawEntityMap[norm] = ent.type;
    }
  }

  // Step 2: tokenize passage for adjacency checks
  const passNorms = (passageText || "").split(/\s+/)
    .map(t => _arNormalize(t.replace(/[،؟.,!:؛()]/g, "").trim()))
    .filter(Boolean);

  // Step 3: classify into spanMap / entityMap
  for (const [norm, type] of Object.entries(rawEntityMap)) {
    if (/^[يتنأ].{2,}/.test(norm) || /^(وت|وي|فت|في|وسي|فسي|س[يتن][^اوي])/.test(norm)) continue;
    let isSpanMember = false;
    const idx = passNorms.indexOf(norm);
    if (idx >= 0) {
      const prev = idx > 0 ? passNorms[idx - 1] : null;
      const next = idx < passNorms.length - 1 ? passNorms[idx + 1] : null;
      isSpanMember = (prev && rawEntitySet.has(prev)) || (next && rawEntitySet.has(next));
    }
    const hasGloss = !!_waGloss(norm);
    if (isSpanMember)    spanMap[norm]   = type;
    else if (!hasGloss)  entityMap[norm] = type;
  }

  return { entityMap, spanMap };
}

// ── Rule A / C mock: contextual trigger guard ──────────────────────────────
function ctxTriggerFires(n) {
  const _ctxGloss     = _waGloss(n);
  const _ctxIsVerbPfx = /^[يتنأ].{2,}/.test(n) || /^(وت|وي|فت|في|وسي|فسي|س[يتن][^اوي])/.test(n);
  return !_ctxGloss && !_ctxIsVerbPfx; // true = fires (proper noun), false = blocked (fall-through)
}

// ── Rule B mock: contradiction resolver guard ──────────────────────────────
function ruleB_fires(n, spanMap, fictionalLabel) {
  // fictionalLabel: what classifyBase wrongly returned
  const isVerb     = fictionalLabel === "Verb";
  const isVerbNoun = fictionalLabel === "verbal noun";
  return spanMap[n] && (isVerb || isVerbNoun);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test cases
// ─────────────────────────────────────────────────────────────────────────────
const CASES = [
  // ── W. Multi-word entity span splitting ─────────────────────────────────────
  // AI returns "إسحاق دار" as ONE entity.  After splitting:
  // - "اسحاق" → rawEntitySet ✓
  // - "دار"   → rawEntitySet ✓  (and it's adjacent to "اسحاق" in passage)
  // → "دار" ends up in spanMap (isSpanMember = true, hasGloss = true but span wins)
  ["دار in إسحاق دار — lands in spanMap", () => {
    const { spanMap } = buildEntityMaps(
      [{ arabic: "إسحاق دار", type: "PERSON" }],
      "بحث إسحاق دار مع المسؤولين"
    );
    return !!spanMap["دار"];
  }],
  ["إسحاق in إسحاق دار — also in spanMap", () => {
    const { spanMap } = buildEntityMaps(
      [{ arabic: "إسحاق دار", type: "PERSON" }],
      "بحث إسحاق دار مع المسؤولين"
    );
    return !!spanMap["اسحاق"];
  }],
  ["دار in إسحاق دار — NOT in entityMap (has GLOSS, span route)", () => {
    const { entityMap } = buildEntityMaps(
      [{ arabic: "إسحاق دار", type: "PERSON" }],
      "بحث إسحاق دار مع المسؤولين"
    );
    return !entityMap["دار"];
  }],
  ["ستارمر — no GLOSS → entityMap (single token)", () => {
    const { entityMap } = buildEntityMaps(
      [{ arabic: "ستارمر", type: "PERSON" }],
      "بحث ستارمر مع المسؤولين"
    );
    return !!entityMap["ستارمر"];
  }],
  ["Verb-prefix entity — excluded from both maps", () => {
    const { entityMap, spanMap } = buildEntityMaps(
      [{ arabic: "يلتقي", type: "PERSON" }],
      "كان يلتقي بهم"
    );
    return !entityMap["يلتقي"] && !spanMap["يلتقي"];
  }],

  // ── X. Rule A guard — GLOSS blocks contextual trigger ────────────────────────
  ["الطاقة — ctx trigger BLOCKED (has GLOSS → Rule A)", () => {
    return !ctxTriggerFires(_arNormalize("الطاقة"));
  }],
  ["الخارجية — ctx trigger BLOCKED (has GLOSS → Rule A)", () => {
    return !ctxTriggerFires(_arNormalize("الخارجية"));
  }],
  ["وزير — ctx trigger BLOCKED (has GLOSS → Rule A)", () => {
    return !ctxTriggerFires(_arNormalize("وزير"));
  }],
  ["اسبوع — ctx trigger BLOCKED (has GLOSS → Rule A)", () => {
    return !ctxTriggerFires(_arNormalize("اسبوع"));
  }],
  ["ماركو — ctx trigger FIRES (no GLOSS, no verb prefix)", () => {
    return ctxTriggerFires(_arNormalize("ماركو"));
  }],
  ["ستارمر — ctx trigger FIRES (no GLOSS, no verb prefix)", () => {
    return ctxTriggerFires(_arNormalize("ستارمر"));
  }],

  // ── Y. Rule C guard — verb prefix blocks contextual trigger ──────────────────
  ["يسهم — ctx trigger BLOCKED (verb prefix يـ → Rule C)", () => {
    return !ctxTriggerFires(_arNormalize("يسهم"));
  }],
  ["سيلتقي — ctx trigger BLOCKED (verb prefix سيـ → Rule C)", () => {
    return !ctxTriggerFires(_arNormalize("سيلتقي"));
  }],
  ["وتأتي — ctx trigger BLOCKED (compound verb prefix وتـ → Rule C)", () => {
    return !ctxTriggerFires(_arNormalize("وتأتي"));
  }],
  ["تعود — ctx trigger BLOCKED (verb prefix تـ → Rule C)", () => {
    return !ctxTriggerFires(_arNormalize("تعود"));
  }],
  ["نؤكد — ctx trigger BLOCKED (verb prefix نـ → Rule C)", () => {
    return !ctxTriggerFires(_arNormalize("نؤكد"));
  }],

  // ── Z. Rule B — span-map entity contradicts verb/verbal-noun classification ──
  // Simulates: classifyBase wrongly returned "Verb" for دار (after Fix 1 puts it
  // in spanMap).  Rule B detects the contradiction and triggers correction.
  ["دار — Rule B fires when span-confirmed + classifyBase→Verb", () => {
    const { spanMap } = buildEntityMaps(
      [{ arabic: "إسحاق دار", type: "PERSON" }],
      "بحث إسحاق دار مع المسؤولين"
    );
    return ruleB_fires("دار", spanMap, "Verb");
  }],
  ["دار — Rule B fires when span-confirmed + classifyBase→verbal noun", () => {
    const { spanMap } = buildEntityMaps(
      [{ arabic: "إسحاق دار", type: "PERSON" }],
      "بحث إسحاق دار مع المسؤولين"
    );
    return ruleB_fires("دار", spanMap, "verbal noun");
  }],
  ["ستارمر — Rule B does NOT fire (not in spanMap = single token)", () => {
    const { spanMap } = buildEntityMaps(
      [{ arabic: "ستارمر", type: "PERSON" }],
      "زار ستارمر لندن"
    );
    return !ruleB_fires("ستارمر", spanMap, "Verb");
  }],

  // ── Sanity: contradictory final state (label=proper noun, gloss=common noun) must be blocked
  ["Entity gate blocks الطاقة from entityMap", () => {
    const { entityMap } = buildEntityMaps(
      [{ arabic: "الطاقة", type: "PERSON" }],
      "ناقش الرئيس الطاقة النووية"
    );
    return !entityMap["طاقه"] && !entityMap["الطاقه"];
  }],
  ["Entity gate blocks الخارجية from entityMap", () => {
    const { entityMap } = buildEntityMaps(
      [{ arabic: "الخارجية", type: "PERSON" }],
      "قال وزير الخارجية"
    );
    return !entityMap["خارجيه"] && !entityMap["الخارجيه"];
  }],
];

// ─────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failDetails = [];
for (const [desc, fn] of CASES) {
  let ok = false;
  try { ok = fn(); } catch(e) { ok = false; }
  if (ok) pass++; else { fail++; failDetails.push(`  ✗ ${desc}`); }
}
if (failDetails.length) { console.log("FAILURES:"); failDetails.forEach(l => console.log(l)); }
console.log(`\nTOTAL: ${pass+fail}  PASS: ${pass}  FAIL: ${fail}`);
if (fail === 0) console.log("✅ ALL CONTRADICTION-RESOLUTION TESTS PASS");
else            process.exit(1);
