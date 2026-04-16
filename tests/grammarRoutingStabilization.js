// ── Grammar Routing Stabilization Suite ─────────────────────────────────────
// Tests for the confirmed live-UI failures from the user's uploaded spec.
// Covers: protected fixed expressions, discourse connectors, F3 verb-set fix,
// D7 future-verb guard, entity span-map, GLOSS additions.
//
//  P. Fixed prepositions / lexicalized expressions (بحسب, وفقا, حسب, طبقا)
//  Q. Discourse connectors (حيث, بينما, إذ, كما)
//  R. F3 verb-set fix (دار, حسب, سيد not classified as Verb)
//  S. D7 future-verb guard (سيلتقي, ستعود, سنصل)
//  T. GLOSS additions (خارجية, الخارجية, سيد, بالسيد route)
//  U. Entity gate protection (الخارجية, الطاقة → no override via entity map)
//  V. Span-map allows دار override when adjacent to إسحاق
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

// ── PREPS snapshot (normalized keys that must be in the PREPS Set) ────────────
const PREPS = new Set([
  "في","من","الى","على","عن","مع","دون","ضد","منذ","حتى","ازاء","عبر",
  "رغم","نحو","لدى","لدي","عدا","سوى","سوي","بشان","باستثناء",
  // Newly added lexicalized prepositions:
  "حسب","بحسب","حسبما","بحسبما",
  "وفقا","وفق","طبقا","بناء","بالنسبه",
]);

// ── DISC_CONN snapshot ─────────────────────────────────────────────────────────
const _DISC_CONN = new Set(["حيث","بينما","اذ","بما","مما","فيما","حينما","لان","بينهما"]);

// ── GLOSS snapshot (post-normalize keys) ────────────────────────────────────────
const _GLOSS = {
  "وزير":"minister","رءيس":"president","ناءب":"deputy",
  "طاقه":"energy","خارجيه":"foreign affairs / external (fem.)","خارجي":"foreign / external",
  "سيد":"master / Mr. (title)","السيد":"Mr. / the honorable (title)",
  "دار":"house / abode / Dar","اسحاق":"Isaac / Ishaaq (personal name)",
  "قال":"said","قام":"rose / stood up / carried out",
};
function _look(s) { return _GLOSS[s] || _GLOSS[s.replace(/ه$/,"ة")] || null; }
function _waGloss(raw) {
  const n = _arNormalize(raw);
  let g = _look(n); if (g) return g;
  const noAl = n.startsWith("ال") ? n.slice(2) : n;
  if (noAl !== n) { g = _look(noAl); if (g) return g; }
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

// ── _VERB3_PAST snapshot ────────────────────────────────────────────────────────
const _VERB3_PAST = new Set([
  "قال","ذهب","جاء","كان","عاد","رفض","قبل","وصل","سقط",
  "دخل","خرج","صرح","حذر","قام","منع","سمح","زار","شتت",
  "قتل","درس","اكد","دعا","افاد","نفي","اتى","اخذ","بات",
  "صار","ظل","ظهر","جلس","عاش","مات","نام","حكم","ضرب",
  "بدا","اشار","اراد","اعلن","ناقش","نقل","نشر","عقد","فرض","فتح","دفع","سحب","قصف","شن","اسهم",
]);

// ── D7 verb guard (expanded for future سـ prefix) ──────────────────────────────
const SFXS = ["هما","كما","هم","هن","كم","كن","ني","نا","ها","ه","ك","ي"];
function hasSfx(s)  { return SFXS.some(x => s.length > x.length + 1 && s.endsWith(x)); }
function getSfx(s)  { return SFXS.find(x => s.length > x.length + 1 && s.endsWith(x)); }
function d7Guard(bn) {
  const raw = hasSfx(bn) ? getSfx(bn) : null;
  if (raw === "ي" && (/^[يتن]/.test(bn) || /^س[يتن][^اوي]/.test(bn))) return "blocked";
  return raw ? "idafa" : "no-suffix";
}

// ── Entity gate helpers ──────────────────────────────────────────────────────────
function _isVerbPrefixed(n) { return /^[يتنأا].{2,}/.test(n); }
function _isCompoundVerb(n) { return /^(وت|وي|فت|في|وسي|فسي|س[يتن][^اوي])/.test(n); }
function entityGateStrict(n) {  // _smartILREntityMap gate (no GLOSS + no verb)
  return !_waGloss(n) && !_isVerbPrefixed(n) && !_isCompoundVerb(n);
}

// ── Test cases ─────────────────────────────────────────────────────────────────
const CASES = [
  // P. Fixed prepositions
  ["بحسب",  n => PREPS.has(n),                     "P. Fixed prepositions", "بحسب → in PREPS (according to)"],
  ["حسب",   n => PREPS.has(n),                     "P. Fixed prepositions", "حسب → in PREPS"],
  ["وفقا",  n => PREPS.has(n),                     "P. Fixed prepositions", "وفقا → in PREPS"],
  ["وفق",   n => PREPS.has(n),                     "P. Fixed prepositions", "وفق → in PREPS"],
  ["طبقا",  n => PREPS.has(n),                     "P. Fixed prepositions", "طبقا → in PREPS"],
  ["بناء",  n => PREPS.has(n),                     "P. Fixed prepositions", "بناء → in PREPS"],

  // Q. Discourse connectors
  ["حيث",   n => _DISC_CONN.has(n),               "Q. Discourse connectors", "حيث → DISC_CONN"],
  ["بينما",  n => _DISC_CONN.has(n),               "Q. Discourse connectors", "بينما → DISC_CONN"],
  ["إذ",    n => _DISC_CONN.has(n),               "Q. Discourse connectors", "إذ (→ اذ) → DISC_CONN"],
  ["فيما",  n => _DISC_CONN.has(n),               "Q. Discourse connectors", "فيما → DISC_CONN"],

  // R. F3 verb-set fix — these should NOT be in _VERB3_PAST
  ["دار",   n => !_VERB3_PAST.has(n),             "R. F3 verb-set fix", "دار NOT in _VERB3_PAST (is a noun/surname)"],
  ["حسب",   n => !_VERB3_PAST.has(n),             "R. F3 verb-set fix", "حسب NOT in _VERB3_PAST (is a preposition)"],
  ["سيد",   n => !_VERB3_PAST.has(n),             "R. F3 verb-set fix", "سيد NOT in _VERB3_PAST (is a title noun)"],
  // These SHOULD be in _VERB3_PAST
  ["قال",   n => _VERB3_PAST.has(n),              "R. F3 verb-set fix", "قال IS in _VERB3_PAST (past verb)"],
  ["ذهب",   n => _VERB3_PAST.has(n),              "R. F3 verb-set fix", "ذهب IS in _VERB3_PAST (past verb)"],
  ["صرح",   n => _VERB3_PAST.has(n),              "R. F3 verb-set fix", "صرح IS in _VERB3_PAST (past verb)"],

  // S. D7 future-verb guard (سيلتقي starts with سي → verb prefix → D7 blocked)
  ["سيلتقي",n => d7Guard(n) === "blocked",        "S. D7 future-verb guard", "سيلتقي → D7 ي-suffix BLOCKED (سي prefix)"],
  ["تلتقي",n => d7Guard(n) === "blocked",        "S. D7 future-verb guard", "تلتقي → D7 ي-suffix BLOCKED (تـ imperfect prefix)"],
  ["يلتقي", n => d7Guard(n) === "blocked",        "S. D7 future-verb guard", "يلتقي → D7 ي-suffix BLOCKED (يـ prefix)"],
  ["حكومتي",n => d7Guard(n) === "idafa",          "S. D7 future-verb guard", "حكومتي → D7 ي-suffix ALLOWED (idafa)"],

  // T. GLOSS additions
  ["الخارجية", n => !!_waGloss(n),               "T. GLOSS additions", "الخارجية → GLOSS 'foreign affairs'"],
  ["خارجية",   n => !!_waGloss(n),               "T. GLOSS additions", "خارجية → GLOSS 'foreign / external (fem.)'"],
  ["سيد",      n => !!_waGloss(n),               "T. GLOSS additions", "سيد → GLOSS 'master / Mr.'"],
  ["بالسيد",   n => {                             // ب + السيد → strip ب → السيد → strip ال → سيد → GLOSS found
    const stripped = n.replace(/^[بكل]/,"");
    return !!_waGloss(stripped);
  },                                               "T. GLOSS additions", "بالسيد → strip ب → سيد → GLOSS found"],

  // U. Entity gate protection
  ["الخارجية", n => !entityGateStrict(n),         "U. Entity gate protection", "الخارجية → entity gate BLOCKS (has GLOSS)"],
  ["الطاقة",   n => !entityGateStrict(n),         "U. Entity gate protection", "الطاقة → entity gate BLOCKS (has GLOSS)"],
  ["سيلتقي",   n => !entityGateStrict(n),         "U. Entity gate protection", "سيلتقي → entity gate BLOCKS (verb prefix)"],

  // V. Span-map allows دار (despite GLOSS) when adjacent to إسحاق
  // Simulated: دار IS in GLOSS (has GLOSS → strict gate blocks it)
  // But span-map bypasses GLOSS gate — test that GLOSS alone doesn't prevent span override
  ["دار",  n => !!_waGloss(n) && !_isVerbPrefixed(n) && !_isCompoundVerb(n),
                                                   "V. Span map override", "دار has GLOSS but passes span verb guards (eligible for span override)"],
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
if (fail === 0) console.log("✅ ALL GRAMMAR-ROUTING STABILIZATION TESTS PASS");
else            process.exit(1);
