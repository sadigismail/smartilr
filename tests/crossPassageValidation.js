#!/usr/bin/env node
// ── Cross-Passage Tooltip Generalization Validation (v134) ──────────────────
// Stress-tests _waGloss across 8 domains × 6 token categories.
// Run: node tests/crossPassageValidation.js
// ESM-compatible (package.json has "type":"module").

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── _arNormalize replica ──────────────────────────────────────────────────────
function _arNormalize(s) {
  return String(s)
    .replace(/[\u064B-\u065F\u0670\u0671]/g, "")
    .replace(/[أإآٱ\u0622\u0623\u0625\u0627\u0671]/g, "ا")
    .replace(/\u0640/g, "");
}

// ── Load GLOSS & BROKEN_PL_MAP from live HTML ─────────────────────────────────
const html = readFileSync(join(__dirname, "../public/index.html"), "utf8");

function extractObject(html, marker, startSkip) {
  const start = html.indexOf(marker);
  if (start === -1) return {};
  let depth = 0, end = -1;
  for (let i = start + startSkip; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { if (depth === 0) { end = i; break; } depth--; }
  }
  if (end === -1) return {};
  try { return eval("(" + html.slice(start + startSkip - 1, end + 1) + ")"); }
  catch (e) { return {}; }
}

const _GLOSS = extractObject(html, "const _GLOSS = {", 16);
const _BP    = extractObject(html, "const _BROKEN_PL_MAP = {", 24);

// ── Extract PROPER_NOUNS map from HTML ────────────────────────────────────────
function extractProperNouns(html) {
  const marker = "const PROPER_NOUNS = new Map(Object.entries({";
  const start = html.indexOf(marker);
  if (start === -1) return new Map();
  let depth = 0, end = -1;
  const objStart = start + marker.length - 1; // position of opening {
  for (let i = objStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return new Map();
  try {
    const obj = eval("(" + html.slice(objStart, end + 1) + ")");
    return new Map(Object.entries(obj));
  } catch (e) { return new Map(); }
}
const _PN = extractProperNouns(html);
function _arNormPN(s) {
  return String(s)
    .replace(/[\u064B-\u065F\u0670\u0671]/g, "")
    .replace(/[أإآٱ\u0622\u0623\u0625\u0627\u0671]/g, "ا")
    .replace(/\u0640/g, "");
}
function _lookPN(s) {
  const n = _arNormPN(s);
  // Only return a gloss if the entry explicitly has one — otherwise fall through
  // to GLOSS lookup so that place names get their English name from _GLOSS.
  if (_PN.has(n)) { const e = _PN.get(n); return e.gloss || null; }
  if (n.startsWith("ال") && _PN.has(n.slice(2))) {
    const e = _PN.get(n.slice(2)); return e.gloss || null;
  }
  return null;
}

// ── Lookup helpers (mirror _waGloss T1 tier) ─────────────────────────────────
function _look(s) {
  if (!s || s.length < 2) return null;
  let r = _GLOSS[s]; if (r) return r;
  if (/ة$/.test(s)) { r = _GLOSS[s.slice(0, -1)]; if (r) return r; }
  else {
    r = _GLOSS[s + "ة"]; if (r) return r;
    if (/ت$/.test(s) && s.length > 2) { r = _GLOSS[s.slice(0, -1) + "ة"]; if (r) return r; }
  }
  return null;
}
function _lookP(s) {
  if (!s || s.length < 3) return null;
  if (/ات$/.test(s) && s.length > 4)     { const r = _look(s.slice(0, -2)); if (r) return r; }
  if (/ون$|ين$/.test(s) && s.length > 4) { const r = _look(s.slice(0, -2)); if (r) return r; }
  if (/ان$/.test(s) && s.length > 4)     { const r = _look(s.slice(0, -2)); if (r) return r; }
  return null;
}
function _lookBP(s) {
  const sg = _BP[s]; if (!sg) return null;
  return _look(sg) || _look(sg + "ة") || null;
}

// ── _waGloss replica (Tiers 1-4 + clitic handling) ───────────────────────────
function _waGloss(w) {
  const n = _arNormalize(w);

  // T1: direct / plural / broken-plural
  let g = _look(n) || _lookP(n) || _lookBP(n);
  if (g) return { tier: 1, g };

  // T2: strip definite article ال
  if (n.startsWith("ال") && n.length > 3) {
    const noAl = n.slice(2);
    g = _look(noAl) || _lookP(noAl) || _lookBP(noAl);
    if (g) return { tier: 2, g };
  }

  // T3a: strip single proclitic [وفبكل]
  if (/^[وفبكل]/.test(n) && n.length > 2) {
    const noC = n.slice(1);
    g = _look(noC) || _lookP(noC) || _lookBP(noC);
    if (g) return { tier: "3a", g };
    // T3b: proclitic + ال (بال / فال / وال …)
    if (noC.startsWith("ال") && noC.length > 3) {
      const noCAl = noC.slice(2);
      g = _look(noCAl) || _lookP(noCAl) || _lookBP(noCAl);
      if (g) return { tier: "3b", g };
    }
  }

  // T3-lal: لل contraction (للسلام → سلام)
  if (n.startsWith("لل") && n.length > 3) {
    const noLal = n.slice(2);
    g = _look(noLal) || _lookP(noLal) || _lookBP(noLal);
    if (g) return { tier: "3lal", g };
  }

  // T4: tanwīn accusative — trailing ا
  if (/ا$/.test(n) && n.length > 2) {
    const noAcc = n.slice(0, -1);
    g = _look(noAcc) || _lookP(noAcc) || _lookBP(noAcc);
    if (g) return { tier: 4, g };
  }

  return { tier: null, g: null };
}

// ── Verb pipeline replica (Stages 6, 6b, 6.5) ────────────────────────────────
function _tryImperfectSimple(stem) {
  if (!stem || stem.length < 3) return null;
  if (/^[يتنا]/.test(stem)) {
    const root = stem.slice(1);
    let r = _waGloss(root).g; if (r) return r;
    const rootHN = root.replace(/[ؤئ]/g, "ا");
    if (rootHN !== root) { r = _waGloss(rootHN).g; if (r) return r; }
    // A3. Hollow verb recovery: يزور → زور → زار (middle و/ي → ا)
    if (root.length === 3 && (root[1] === "و" || root[1] === "ي")) {
      const hollowLemma = root[0] + "ا" + root[2];
      r = _waGloss(hollowLemma).g; if (r) return r;
    }
    // A4. Hamzated / Form IV recovery: يسهم → سهم → اسهم
    if (!root.startsWith("ا") && root.length >= 3) {
      r = _waGloss("ا" + root).g; if (r) return r;
    }
    if (root.startsWith("ست") && root.length >= 4) {
      r = _waGloss("ا" + root).g; if (r) return r;
    }
    if (/^[تن]/.test(root) && root.length >= 3) {
      r = _waGloss(root.slice(1)).g; if (r) return r;
    }
  }
  return null;
}

function resolveToken(surface) {
  const n = _arNormalize(surface);
  // PROPER_NOUNS lookup — checked before GLOSS (mirrors classifier priority)
  const pn = _lookPN(n);
  if (pn) return pn;
  let { g } = _waGloss(surface);
  if (g) return g;

  // Stage 6: imperfect prefix strip
  g = _tryImperfectSimple(n); if (g) return g;

  // Stage 6b: future سـ prefix (ستستمر, سيعلن …)
  if (/^س[يتنا]/.test(n) && n.length >= 4) {
    g = _tryImperfectSimple(n.slice(1)); if (g) return g;
  }

  // Stage 6.5: past feminine ت (أعلنت → اعلن)
  if (/ت$/.test(n) && !/ات$/.test(n) && n.length >= 4) {
    const stem = n.slice(0, -1);
    g = _waGloss(stem).g || _tryImperfectSimple(stem); if (g) return g;
    if (/^[وفبكل]/.test(stem)) {
      const stemNC = stem.slice(1);
      g = _waGloss(stemNC).g || _tryImperfectSimple(stemNC); if (g) return g;
    }
  }

  return null;
}

// ── Test-case table ────────────────────────────────────────────────────────────
// [surface, patternOrNull, category, label]
const CA = "A. Common definite nouns";
const CB = "B. Personal names";
const CC = "C. Place names";
const CD = "D. Broken plurals";
const CE = "E. Clitic-attached";
const CF = "F. Verbs & derived forms";

const CASES = [
  // ── A. Common definite nouns ─ 8 domains ────────────────────────────────
  // D1 News / politics
  ["السلام",        /peace/i,                     CA, "D1: السلام → peace"],
  ["الحرب",         /war/i,                        CA, "D1: الحرب → war"],
  ["الحكومة",       /government/i,                 CA, "D1: الحكومة → government"],
  ["المنطقة",       /area|region|zone/i,           CA, "D1: المنطقة → region"],
  // D2 Biography
  ["الحياة",        /life/i,                       CA, "D2: الحياة → life"],
  ["التعليم",       /education/i,                  CA, "D2: التعليم → education"],
  // D3 Religion / culture
  ["الدين",         /religion/i,                   CA, "D3: الدين → religion"],
  ["الثقافة",       /culture/i,                    CA, "D3: الثقافة → culture"],
  ["التاريخ",       /history/i,                    CA, "D3: التاريخ → history"],
  // D4 Geography
  ["الجبل",         /mountain/i,                   CA, "D4: الجبل → mountain"],
  ["النهر",         /river/i,                      CA, "D4: النهر → river"],
  ["الصحراء",       /desert/i,                     CA, "D4: الصحراء → desert"],
  // D5 Education
  ["المدرسة",       /school/i,                     CA, "D5: المدرسة → school"],
  ["الجامعة",       /university/i,                 CA, "D5: الجامعة → university"],
  ["العلم",         /science|knowledge/i,           CA, "D5: العلم → science"],
  // D6 Humanitarian
  ["الغذاء",        /food/i,                       CA, "D6: الغذاء → food"],
  ["الصحة",         /health/i,                     CA, "D6: الصحة → health"],
  ["المساعدة",      /help|aid|assist/i,             CA, "D6: المساعدة → help/aid"],
  // D7 Formal statement
  ["الاتفاق",       /agreement/i,                  CA, "D7: الاتفاق → agreement"],
  ["القرار",        /decision/i,                   CA, "D7: القرار → decision"],
  ["البيان",        /statement/i,                  CA, "D7: البيان → statement"],
  // D8 Narrative
  ["النار",         /fire/i,                       CA, "D8: النار → fire"],
  ["العودة",        /return/i,                     CA, "D8: العودة → return"],
  ["الطريق",        /road|path/i,                  CA, "D8: الطريق → road"],

  // ── B. Personal names ────────────────────────────────────────────────────
  ["محمد",          /Muhammad|personal name/i,     CB, "محمد → Muhammad"],
  ["أحمد",          /Ahmad|personal name/i,        CB, "أحمد → Ahmad"],
  ["خالد",          /Khalid|personal name/i,       CB, "خالد → Khalid"],
  ["عبدالله",       /Abdullah|personal name/i,     CB, "عبدالله → Abdullah"],
  ["إبراهيم",       /Ibrahim|personal name/i,      CB, "إبراهيم → Ibrahim"],
  ["مريم",          /Maryam|Mary|personal name/i,  CB, "مريم → Maryam"],
  ["فاطمة",         /Fatima|personal name/i,       CB, "فاطمة → Fatima"],
  ["عائشة",         /Aisha|personal name/i,        CB, "عائشة → Aisha"],
  ["يوسف",          /Yusuf|Joseph|personal name/i, CB, "يوسف → Yusuf"],
  ["موسى",          /Musa|Moses|personal name/i,   CB, "موسى → Musa"],
  ["خديجة",         /Khadija|personal name/i,      CB, "خديجة → Khadija"],
  ["زينب",          /Zaynab|personal name/i,       CB, "زينب → Zaynab"],
  ["سليمان",        /Suleiman|Solomon|personal name/i, CB, "سليمان → Suleiman"],
  ["داود",          /Daoud|David|personal name/i,  CB, "داود → Daoud"],
  ["حسين",          /Hussein|personal name/i,      CB, "حسين → Hussein"],
  ["ناصر",          /Nasser|personal name/i,       CB, "ناصر → Nasser"],
  ["السيسي",        /al-Sisi|Sisi|personal name/i, CB, "السيسي → al-Sisi"],
  ["مبارك",         /Mubarak|personal name/i,      CB, "مبارك → Mubarak"],

  // ── C. Place names ───────────────────────────────────────────────────────
  ["جدة",           /Jeddah/i,                     CC, "جدة → Jeddah"],
  ["الرياض",        /Riyadh/i,                     CC, "الرياض → Riyadh"],
  ["القاهرة",       /Cairo/i,                      CC, "القاهرة → Cairo"],
  ["الخرطوم",       /Khartoum/i,                   CC, "الخرطوم → Khartoum"],
  ["أبوظبي",        /Abu Dhabi/i,                  CC, "أبوظبي → Abu Dhabi"],
  ["المنامة",       /Manama/i,                     CC, "المنامة → Manama"],
  ["بغداد",         /Baghdad/i,                    CC, "بغداد → Baghdad"],
  ["دمشق",          /Damascus/i,                   CC, "دمشق → Damascus"],
  ["مصر",           /Egypt/i,                      CC, "مصر → Egypt"],
  ["السودان",       /Sudan/i,                      CC, "السودان → Sudan"],
  ["فلسطين",        /Palestine/i,                  CC, "فلسطين → Palestine"],
  ["لندن",          /London/i,                     CC, "لندن → London"],
  ["واشنطن",        /Washington/i,                 CC, "واشنطن → Washington"],

  // ── D. Broken plurals ────────────────────────────────────────────────────
  ["الأنباء",       /news|reports/i,               CD, "الأنباء → news/reports"],
  ["الأخبار",       /news|reports/i,               CD, "الأخبار → news/reports"],
  ["الأسماء",       /name/i,                       CD, "الأسماء → names"],
  ["الأشياء",       /thing|something/i,            CD, "الأشياء → things"],
  ["الأوضاع",       /situation|condition/i,        CD, "الأوضاع → situations"],
  ["الأطراف",       /party|side/i,                 CD, "الأطراف → parties/sides"],
  ["الأحداث",       /event/i,                      CD, "الأحداث → events"],

  // ── E. Clitic-attached forms ─────────────────────────────────────────────
  ["للسلام",        /peace/i,                      CE, "للسلام → peace"],
  ["بالحكومة",      /government/i,                 CE, "بالحكومة → government"],
  ["واتصالات",      /communication|contact/i,      CE, "واتصالات → communications"],
  ["فالمسؤولين",    /official/i,                   CE, "فالمسؤولين → officials"],
  ["والمنطقة",      /area|region/i,                CE, "والمنطقة → region"],
  ["بالسلام",       /peace/i,                      CE, "بالسلام → peace"],
  ["للحكومة",       /government/i,                 CE, "للحكومة → government"],

  // ── F. Verbs and derived forms ───────────────────────────────────────────
  ["استمر",         /continu/i,                    CF, "استمر → continued"],
  ["أشار",          /indicat/i,                    CF, "أشار → indicated"],
  ["إطلاق",         /launch|release|firing/i,      CF, "إطلاق → launch"],
  ["الإدارة",       /administration|management/i,  CF, "الإدارة → administration"],
  ["أعلنت",         /announc/i,                    CF, "أعلنت → announced (f.)"],
  ["اتفق",          /agreed|agree/i,               CF, "اتفق → agreed"],
  ["يراقب",         /watch|monitor|observ/i,       CF, "يراقب → monitors"],
  ["ينشر",          /publish|broadcast|deploy/i,   CF, "ينشر → publishes"],
  ["تعاون",         /cooperat/i,                   CF, "تعاون → cooperated"],
  ["ستستمر",        /continu/i,                    CF, "ستستمر → will continue (future)"],

  // G. Hollow verb imperfect lemma recovery ─────────────────────────────────
  // يزور → زور (و middle) → hollow: زار → "visited" → deconj "visit"
  ["سيزور",         /visit/i,                      "G. Hollow verbs",   "سيزور → visit"],
  ["سيقول",         /say|said/i,                   "G. Hollow verbs",   "سيقول → say"],
  ["سيعود",         /return/i,                     "G. Hollow verbs",   "سيعود → return"],
  ["سيسير",         /walk|travel|mov/i,             "G. Hollow verbs",   "سيسير → walk/travel"],
  ["سينام",         /sleep|slept/i,                "G. Hollow verbs",   "سينام → sleep/slept"],
  // Control case — solid verb, hollow rule must NOT fire incorrectly
  ["سيعمل",         /work/i,                       "G. Hollow verbs",   "سيعمل → work (control)"],

  // H. New proper-noun entries (PROPER_NOUNS lexical additions) ───────────────
  ["إسحاق",         /Isaac|Ishaaq/i,               "H. Proper nouns v135", "إسحاق → Isaac"],
  ["فرحان",         /Farhan/i,                     "H. Proper nouns v135", "فرحان → Farhan"],
  ["عراقجي",        /Araghchi/i,                   "H. Proper nouns v135", "عراقجي → Araghchi"],
  ["ماركو",         /Marco/i,                      "H. Proper nouns v135", "ماركو → Marco"],
  ["روبيو",         /Rubio/i,                      "H. Proper nouns v135", "روبيو → Rubio"],
  ["عباس",          /Abbas/i,                      "H. Proper nouns v135", "عباس → Abbas"],
  ["ترامب",         /Trump/i,                      "H. Proper nouns v135", "ترامب → Trump"],
  ["بوتين",         /Putin/i,                      "H. Proper nouns v135", "بوتين → Putin"],
  ["ماكرون",        /Macron/i,                     "H. Proper nouns v135", "ماكرون → Macron"],
  ["أردوغان",       /Erdogan/i,                    "H. Proper nouns v135", "أردوغان → Erdogan"],

  // I. v135 lexical patch — new GLOSS entries + Form IV recovery ───────────────
  ["يسهم",          /contribut|play a role/i,      "I. v135 patch",  "يسهم → contribute"],
  ["وتيرة",         /pace|tempo|rate/i,             "I. v135 patch",  "وتيرة → pace/rate"],
  ["سبيل",          /way|means|path/i,              "I. v135 patch",  "سبيل → way/means"],
  ["سبل",           /ways|means/i,                  "I. v135 patch",  "سبل → ways/means"],
  ["هاتفي",         /telephone|phone/i,             "I. v135 patch",  "هاتفي → telephone"],
  ["مانويل",        /Manuel/i,                      "I. v135 patch",  "مانويل → Manuel"],
  ["خوسيه",         /José|Jose/i,                   "I. v135 patch",  "خوسيه → José"],
  // Control — solid verb unaffected by A4
  ["يعمل",          /work/i,                        "I. v135 patch",  "يعمل → work (A4 control)"],
];

// ── Execute ───────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failDetails = [];
const rows = [];

for (const [surface, pattern, cat, label] of CASES) {
  const gloss = resolveToken(surface);
  const ok = pattern ? (gloss !== null && pattern.test(gloss)) : gloss !== null;
  if (ok) pass++; else { fail++; failDetails.push({ label, surface, gloss, pattern }); }
  rows.push({ ok, cat, surface: surface.padEnd(15), gloss: gloss || "NULL", label });
}

// Print grouped by category
const cats = [...new Set(CASES.map(c => c[2]))];
for (const cat of cats) {
  const catRows = rows.filter(r => r.cat === cat);
  const catPass = catRows.filter(r => r.ok).length;
  const catTotal = catRows.length;
  const badge = catPass === catTotal ? "✅" : "⚠️ ";
  console.log(`\n${"─".repeat(72)}`);
  console.log(`${badge} ${cat}  (${catPass}/${catTotal})`);
  console.log("─".repeat(72));
  for (const r of catRows) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.surface} → ${r.gloss.slice(0, 55)}`);
  }
}

console.log("\n" + "═".repeat(72));
console.log(`TOTAL: ${pass + fail}  PASS: ${pass}  FAIL: ${fail}`);

if (failDetails.length > 0) {
  console.log("\n── Failing cases ────────────────────────────────────────────────────────");
  for (const { label, surface, gloss, pattern } of failDetails) {
    console.log(`  ✗ [${label}]  got="${gloss}"  expected=${pattern}`);
  }
  console.log("");
  process.exit(1);
} else {
  console.log("\n✅ ALL CROSS-PASSAGE TESTS PASS\n");
}
