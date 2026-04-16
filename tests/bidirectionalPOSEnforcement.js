#!/usr/bin/env node
/**
 * SmartILR — Bidirectional English POS Enforcement (v138)
 * Tests Translation-POS as a hard constraint above Arabic morphology.
 *
 * Two directions:
 *   VERB-FORCE  — English gloss clearly indicates verb   → force Verb
 *   NOUN-BLOCK  — English gloss clearly indicates noun   → block Verb
 *
 * Priority order enforced:
 *   English POS hard constraint → Arabic morphology → Pattern → Fallback
 *
 * Key notes on live pipeline behaviour (reflected in expected labels):
 *   • When _waGloss(n) returns a result via Tier-3 proclitic stripping (و+X),
 *     the conjunction-split (Step 3) is BLOCKED.  The full token then goes
 *     through classifyBase + SAL.  So "وجاء" is NOT split; it becomes Verb
 *     via SAL Rule V ("come" → VERB_IRR).
 *   • "وصوتوا"/"واخرجوا" ARE split (no GLOSS entry for the stripped forms
 *     صوتوا / اخرجوا) → Conjunction+Verb via F2.5.
 *   • "صوت" is in KNOWN_NOUNS but NOT in the live GLOSS dictionary; so
 *     صوتوا gets F2.5 → Verb without any SAL interference.
 *
 * Run:  node tests/bidirectionalPOSEnforcement.js
 * Exit 0 = all pass.  Exit 1 = any failure.
 */

"use strict";

// ── Normalizer (matches live _arNormalize: strips diacritics, normalises hamza) ──
function _arNormalize(s) {
  return String(s || "")
    .replace(/[\u064B-\u065F\u0610-\u061A\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, "")
    .replace(/[أإآ]/g, "ا")
    .trim();
}

// ── Measure helper (_vm stub) ──────────────────────────────────────────────
function _vm(bn) {
  if (!bn) return null;
  if (/^است/.test(bn) && bn.length >= 7) return "Form X";
  if (/^ا[^ل]ت/.test(bn) && bn.length >= 5) return "Form VIII";
  if (/^انف/.test(bn)) return "Form VII";
  if (/^ت.ا/.test(bn) && bn.length >= 5) return "Form VI";
  if (/^ت/.test(bn) && bn.length >= 5) return "Form V";
  if (/^ا[^ل]/.test(bn) && bn.length >= 4 && bn.length <= 6) return "Form IV";
  if (bn.length <= 4) return "Form I";
  return null;
}

// ── Suffix helpers ─────────────────────────────────────────────────────────
const _PRON_SFXS = ["هما","كما","هم","هن","كم","كن","ني","نا","ها","ه","ك","ي"];
function hasSfx(bn) { return _PRON_SFXS.some(s => bn.endsWith(s) && bn.length > s.length + 1); }
function getSfx(bn) { return _PRON_SFXS.find(s => bn.endsWith(s) && bn.length > s.length + 1) || null; }

// ── KNOWN_NOUNS (subset — includes new ي-initial nouns added in v138) ──────
const KNOWN_NOUNS = new Map([
  ["عقد",{subtype:"verbal noun"}], ["صدر",{subtype:"verbal noun"}],
  ["نشر",{subtype:"verbal noun"}], ["نقل",{subtype:"verbal noun"}],
  ["قتل",{subtype:"verbal noun"}], ["حكم",{subtype:null}],
  ["فرض",{subtype:"verbal noun"}], ["نقد",{subtype:null}],
  ["قبض",{subtype:"verbal noun"}], ["ضرب",{subtype:"verbal noun"}],
  ["دفع",{subtype:"verbal noun"}], ["سحب",{subtype:"verbal noun"}],
  ["شكل",{subtype:null}], ["نور",{subtype:null}], ["وقت",{subtype:null}],
  // صوت is in KNOWN_NOUNS but NOT in the live GLOSS; so صوتوا (F2.5) stays Verb
  ["صوت",{subtype:null}], ["بيت",{subtype:null}], ["باب",{subtype:null}],
  ["دور",{subtype:null}], ["خبر",{subtype:null}], ["حرب",{subtype:null}],
  ["امر",{subtype:null}],
  // v138 additions — ي-initial nouns blocked from F2 imperfect-prefix heuristic
  ["يوم",{subtype:null}],   // day
  ["يمين",{subtype:null}],  // right (direction) / oath
  ["يسار",{subtype:null}],  // left (direction)
  ["يقين",{subtype:null}],  // certainty
  ["ياس",{subtype:null}],   // despair (normalised form of يأس after hamza-drop)
  ["يد",{subtype:null}],    // hand
]);

const PASSIVE_LEXICON = new Set([
  "تم","جري","قتل","ذكر","نقل","صدر","ورد","سمع","حكم",
  "اعلن","اصيب","اعدم","اوقف","اسقط","افرج","افيد","اعيد","ادين","اطلق","اجري",
]);

const PREPS = new Set([
  "في","من","الى","على","عن","مع","دون","ضد","منذ","حتى","حتي","سوى","سوي","بشأن","بشان",
]);

const PM = new Set([
  "فيه","فيها","فيهم","بهم","لهم","منهم","منها","باسم",
  "عليه","عليها","عليهم","عنه","عنها","عنهم",
  "وهو","وهي","وهم","وقال","وقالت",
]);

// ── classifyBase (mirrors live code with all v138 changes) ─────────────────
function classifyBase(word) {
  const bn = _arNormalize(word);
  if (!bn) return { label:"Unknown" };

  if (PM.has(bn)) return { label:"Particle" };
  if (PREPS.has(bn)) return { label:"Preposition" };

  if (KNOWN_NOUNS.has(bn) && !PASSIVE_LEXICON.has(bn)) {
    const kn = KNOWN_NOUNS.get(bn);
    return { label:"Noun", subtype: kn.subtype, voiceAmbiguous: bn.length === 3 };
  }

  if (PASSIVE_LEXICON.has(bn)) {
    return { label:"Verb", voice:"passive", morph:"past, passive" };
  }

  // D1.5  Form VIII ل-root past verbs — before D2 (definite catch-all)
  const _CB_F8L = new Set([
    "التقى","التقي","التمس","التمسي","التزم","التزمي",
    "التحق","التحقي","الجأ","الجا",
    "التقت","التزمت","التحقت",
  ]);
  if (_CB_F8L.has(bn)) {
    return { label:"Verb",
             morph: /ت$/.test(bn) ? "past, 3rd feminine singular" : "past",
             measure: "Form VIII" };
  }

  // D1 Feminine ة
  if (/ة$/.test(bn) && bn.length >= 3) return { label:"Noun", morph:"feminine singular" };

  // D2 Definite ال
  if (/^ال/.test(bn)) return { label:"Noun", morph:"definite" };

  // D3 Feminine sound plural ات
  if (/ات$/.test(bn) && bn.length >= 4) return { label:"Noun", subtype:"feminine sound plural" };

  // D4 Dual ان
  if (/ان$/.test(bn) && bn.length >= 5 && !/^ا/.test(bn))
    return { label:"Noun", subtype:"dual" };

  // D5 Masculine sound plural
  if (/ون$/.test(bn) && bn.length >= 4) return { label:"Noun", subtype:"masculine sound plural" };
  if (/ين$/.test(bn) && bn.length >= 4) return { label:"Noun", subtype:"masculine sound plural" };

  // F0 Future سـ
  if (/^س[يتنأا]/.test(bn) && bn.length >= 5) return { label:"Verb", morph:"future", measure:_vm(bn) };

  // F1 Past 3fs ت-ending
  if (/ت$/.test(bn) && !/ات$/.test(bn) && bn.length >= 4 && !/^ال/.test(bn)) {
    return { label:"Verb", morph:"past, 3rd feminine singular", measure:_vm(bn.slice(0,-1)) || _vm(bn) };
  }

  // F2 Imperfect ي/ت/ن
  if (/^[يتن]/.test(bn) && bn.length >= 3 && !/^ال/.test(bn)) {
    const sfx = hasSfx(bn) ? getSfx(bn) : null;
    const m = _vm(bn);
    if (sfx) return { label:"Verb", qualifier:"present, transitive", pronoun:sfx, measure:m };
    return { label:"Verb", morph:"present", measure:m };
  }

  // F2.5  وا-ending — past 3mp / imperative plural (v138)
  // No Arabic noun ends in وا.  Guards: length ≥ 4, not definite (ال handled above).
  if (/وا$/.test(bn) && bn.length >= 4 && !/^ال/.test(bn)) {
    const stem = bn.slice(0,-2);
    return { label:"Verb",
             morph:"past, 3rd masculine plural / imperative plural",
             measure: _vm(stem) || _vm(bn) };
  }

  // F3 3-char root
  const _VERB3_PAST = new Set([
    "قال","ذهب","جاء","كان","عاد","رفض","قبل","وصل","سقط",
    "دخل","خرج","صرح","حذر","قام","منع","سمح","زار","شتت",
    "درس","اكد","دعا","افاد","نفي","اتى","اخذ","بات",
    "صار","ظل","ظهر","جلس","عاش","مات","نام","ضرب",
    "بدا","اشار","اراد","اعلن","ناقش","نقل","نشر","عقد",
    "فرض","فتح","دفع","سحب","قصف","شن","اسهم",
    // v138 expanded
    "كتب","نجح","فاز","هزم","حضر","وجد","حصل","شهد",
    "سعى","مضى","مشى","رمى","بكى","نسى","جرى","لقي","لقى",
    "حكى","تلا","شكا","رجا","ابى","غدا",
  ]);
  if (bn.length === 3 && !/^ال/.test(bn) && !/ة$/.test(bn)) {
    if (_VERB3_PAST.has(bn)) return { label:"Verb", morph:"past", measure:"Form I" };
    return { label:"Noun", subtype:"verbal noun", measure:"Form I", voiceAmbiguous:true };
  }

  // F3.5  Doubled-root 2-char verbs (v138)
  // "جد" excluded — ambiguous with noun "grandfather" (جَدّ)
  const _VERB2_DBL = new Set(["حث","مد","شد","ضم","غض"]);
  if (_VERB2_DBL.has(bn)) {
    return { label:"Verb", morph:"past", measure:"Form I (doubled root)", voiceAmbiguous:true };
  }

  // STEP G generic noun fallback
  return { label:"Noun" };
}

// ── Mini GLOSS — mirrors live _GLOSS for test cases ───────────────────────
// IMPORTANT: only add words that are DIRECT keys in the live _GLOSS.
// Do NOT add "صوت" (not in live GLOSS), "اخرج" (not in live GLOSS).
// "وجد" IS a direct key in live GLOSS (line 9174).
// "جاء" key → live code has "come" at line 9563 (later entry wins over "came" at 9135).
const _GLOSS = {
  "يوم":"day",
  "جاء":"come",        // live GLOSS: "come" (line 9563 wins)
  "كتب":"wrote",
  "حضر":"attended",
  "هزم":"defeated",
  "نجح":"succeeded",
  "فاز":"won",
  "شهد":"witnessed",
  "حث":"urged / prodded / pressed",
  "التقي":"met",
  "التقى":"met",
  "وجد":"found",       // direct GLOSS key (line 9174)
};

function _look(s) {
  if (!s || s.length < 2) return null;
  let r = _GLOSS[s]; if (r) return r;
  if (/ى/.test(s)) { r = _GLOSS[s.replace(/ى/g,"ي")]; if (r) return r; }
  if (/ة$/.test(s)) { r = _GLOSS[s.slice(0,-1)]; if (r) return r; }
  return null;
}

function _waGloss(w) {
  if (!w) return null;
  const n = _arNormalize(w);
  let g = _look(n); if (g) return g;                         // Tier 1 direct
  if (n.startsWith("ال")) { g = _look(n.slice(2)); if (g) return g; }  // Tier 2
  const nc = n.replace(/^[وفبكل]/,"");                       // Tier 3 proclitic
  if (nc !== n && nc.length >= 2) {
    g = _look(nc); if (g) return g;
    if (nc.startsWith("ال")) { g = _look(nc.slice(2)); if (g) return g; }
  }
  if (n.endsWith("وا") && n.length >= 4) {                   // Tier 7d past-3mp
    const stem = n.slice(0,-2);
    g = _look(stem); if (g) return g;
    const sc = stem.replace(/^[وفبكل]/,"");
    if (sc !== stem) { g = _look(sc); if (g) return g; }
  }
  if (/^[يتنأا]/.test(n) && n.length >= 3) {                // Tier imperfect
    g = _look(n.slice(1)); if (g) return g;
  }
  return null;
}

// ── _salEnPOS classifier (mirrors live shared classifier, v138) ────────────
function _salEnPOS(gloss) {
  if (!gloss) return null;
  const first = gloss.split(/[\s\/,;]/)[0].trim().toLowerCase();
  if (!first || first.length < 2) return null;

  const NOUN_EN = new Set([
    "day","night","morning","evening","week","month","year","hour","era",
    "right","left","hand","arm","side","direction",
    "certainty","despair","hope","power","force","victory","peace",
    "fire","oil","gas","light","war","army","people","news","opinion",
    "form","shape","role","voice","house","door","time",
    "age","condition","situation","state","support","campaign",
    "initiative","resolution","statement","authority","leadership",
  ]);
  if (NOUN_EN.has(first)) return "noun";

  const VERB_IRR = new Set([
    // Irregular past forms
    "said","went","came","saw","took","gave","found","told","knew",
    "thought","brought","kept","met","ran","stood","fell","sent",
    "built","paid","lost","led","bore","rose","spoke","wrote",
    "heard","fled","struck","sank","won","became","chose","drew",
    "grew","held","sought","laid","caught","fought","bought","taught",
    "read","cut","let","put","set","hit","beat","cast","cost","hurt",
    "split","spread","upset","forbade","arose","awoke",
    // Infinitive / base / imperative forms that appear in live GLOSS lookups
    "come","go","leave","return","enter","exit","vote","depart","flee",
    "attend","join","resign","confirm","sign","launch","condemn","impose",
    "reject","refuse","protest","urge","press","demand","warn",
    "praise","criticize","accuse","announce","declare","deny",
    "propose","succeed","fail","participate","discuss","agree",
    "decide","continue","resume","see","find","take","give","tell",
    "write","speak","run","fall","send","build","pay","lose","lead",
    "rise","hear","win","choose","draw","grow","hold","seek",
    "lay","catch","fight","buy","teach","meet",
  ]);
  if (VERB_IRR.has(first)) return "verb";

  const NOT_ED = new Set([
    "stressed","blessed","tired","annoyed","interested","surprised",
    "pleased","excited","disappointed","worried","embarrassed",
    "alleged","advanced","supposed","estimated",
  ]);
  if (/ed$/.test(first) && first.length >= 5 && !NOT_ED.has(first)) return "verb";

  return null;
}

// ── Main classify — mirrors live Step 3/4/5 + SAL Rules NB+V ──────────────
function classify(surface) {
  const n = _arNormalize(surface);

  // ── Strict constraint gloss (mirrors live _constraintGloss):
  //    Tier 1 direct + Tier 2 strip-ال + Tier 3 strip-proclitic.
  //    No Tier-7d (strip وا) — preserves verb integrity of وا-ending forms.
  const _constraintGloss = (() => {
    let _cg = _look(n);                         if (_cg) return _cg;
    if (n.startsWith("ال")) {
      _cg = _look(n.slice(2));                  if (_cg) return _cg;
    }
    const _cnc = n.replace(/^[وفبكل]/, "");
    if (_cnc !== n && _cnc.length >= 2) {
      _cg = _look(_cnc);                        if (_cg) return _cg;
      if (_cnc.startsWith("ال")) {
        _cg = _look(_cnc.slice(2));             if (_cg) return _cg;
      }
    }
    return null;
  })();
  const _constraintEnPOS = _salEnPOS(_constraintGloss);

  // Step 3: Conjunction و/ف — only split when no constraint-gloss exists for full token
  // (live code uses _waGloss(n) for this guard; we use _constraintGloss for consistency)
  if (/^[وف]/.test(n) && n.length > 2 && !_constraintGloss) {
    const base = n.slice(1);
    const cls  = classifyBase(base);
    // Apply hard constraint to the base form as well
    const baseCG  = (() => {
      let g = _look(base); if (g) return g;
      if (base.startsWith("ال")) { g = _look(base.slice(2)); if (g) return g; }
      return null;
    })();
    const basePOS = _salEnPOS(baseCG);
    let cla = cls;
    if (cla.label === "Verb" && basePOS === "noun" && !cla._sal) {
      cla = { label:"Noun", _sal:"RNB" };
    }
    if (cla.label === "Noun" && !cla.subtype && !cla._sal && basePOS === "verb") {
      cla = { label:"Verb", morph:"past", _sal:"RV" };
    }
    return { label: `Conjunction+${cla.label}`, _base: base, _cls: cla };
  }

  // Step 4: Preposition ب/ك/ل
  if (/^[بكل]/.test(n) && n.length > 2 && !_constraintGloss) {
    const base = n.slice(1);
    const cls  = classifyBase(base);
    return { label: `Preposition+${cls.label}`, _base: base, _cls: cls };
  }

  // Step 5: full-word classification
  let cls = classifyBase(n);

  // ── Rule NB — Hard NOUN Constraint (v138+) ──────────────────────────────
  // English says "noun" → reject ANY Verb candidate (no morph restriction).
  // Safe: _constraintGloss (Tier 1-3 only) never returns a noun signal for
  // surface-verb forms (صوتوا has no direct GLOSS entry).
  if (cls.label === "Verb" && _constraintEnPOS === "noun" && !cls._sal) {
    cls = { label:"Noun", _sal:"RNB", _glossSignal: _constraintGloss };
  }

  // ── Rule V — Hard VERB Constraint (v138+) ───────────────────────────────
  // English says "verb" → reject Noun candidates EXCEPT high-confidence ones.
  // Keeps: subtype:"verbal noun", subtype:"feminine singular", plural subtypes.
  // Overrides: D2 definite, STEP G bare noun.
  if (cls.label === "Noun" && !cls.subtype && !cls._sal && _constraintEnPOS === "verb") {
    cls = { label:"Verb", morph:"past", _sal:"RV", _glossSignal: _constraintGloss };
  }

  return cls;
}

// ── Test cases ─────────────────────────────────────────────────────────────
const TESTS = [
  // ── NOUN-BLOCK: KNOWN_NOUNS guard for ي-initial tokens ─────────────────
  {
    surface:"يوم",   expect:"Noun",  via:"KNOWN_NOUNS",
    desc:"يوم → Noun (day; KNOWN_NOUNS blocks F2 imperfect-prefix heuristic)",
  },
  {
    surface:"يقين",  expect:"Noun",  via:"KNOWN_NOUNS",
    desc:"يقين → Noun (certainty; starts ي; KNOWN_NOUNS)",
  },
  {
    surface:"يمين",  expect:"Noun",  via:"KNOWN_NOUNS",
    desc:"يمين → Noun (right/direction; starts ي; KNOWN_NOUNS)",
  },
  {
    surface:"يسار",  expect:"Noun",  via:"KNOWN_NOUNS",
    desc:"يسار → Noun (left/direction; starts ي; KNOWN_NOUNS)",
  },

  // ── F2.5 وا-ending: past 3mp / imperative plural ───────────────────────
  {
    surface:"اخرجوا", expect:"Verb", via:"F2.5",
    desc:"اخرجوا → Verb (exit! imperative pl; F2.5 وا-ending)",
  },
  {
    surface:"صوتوا",  expect:"Verb", via:"F2.5",
    desc:"صوتوا → Verb (they voted; F2.5; صوت not in live GLOSS → no SAL interference)",
  },
  {
    surface:"ذهبوا",  expect:"Verb", via:"F2.5",
    desc:"ذهبوا → Verb (they went; F2.5 وا-ending)",
  },
  {
    surface:"قالوا",  expect:"Verb", via:"F2.5",
    desc:"قالوا → Verb (they said; F2.5 وا-ending)",
  },
  {
    surface:"اعلنوا", expect:"Verb", via:"F2.5",
    desc:"اعلنوا → Verb (they announced; F2.5 وا-ending)",
  },

  // ── Conjunction + وا-ending: Step 3 fires (no gloss for full token) ────
  {
    surface:"وصوتوا", expect:"Conjunction+Verb", via:"Step3+F2.5",
    desc:"وصوتوا → Conjunction+Verb (Step 3 fires: صوت not in live GLOSS)",
  },
  {
    surface:"واخرجوا", expect:"Conjunction+Verb", via:"Step3+F2.5",
    desc:"واخرجوا → Conjunction+Verb (Step 3 fires: اخرج not in live GLOSS)",
  },

  // ── SAL Rule V: Step 3 BLOCKED by gloss, full-word Noun → overridden ───
  // "وجاء": _waGloss strips و → جاء → "come" → Step 3 blocked.
  // classifyBase("وجاء") → STEP G → Noun.  SAL Rule V: "come" → verb → Verb.
  {
    surface:"وجاء",  expect:"Verb",  via:"SAL-RV",
    desc:"وجاء → Verb (Step 3 blocked; GLOSS: come → SAL Rule V overrides Noun→Verb)",
  },
  // "وكتب": GLOSS strips و → كتب → "wrote" → Step 3 blocked.
  // classifyBase("وكتب") → STEP G → Noun.  SAL Rule V: "wrote" → verb → Verb.
  {
    surface:"وكتب",  expect:"Verb",  via:"SAL-RV",
    desc:"وكتب → Verb (Step 3 blocked; GLOSS: wrote → SAL Rule V overrides Noun→Verb)",
  },
  // "وجد" is a DIRECT GLOSS key (found) → Tier 1 → Step 3 blocked.
  // classifyBase("وجد") (full token, 3 chars) → VERB3_PAST → Verb.
  {
    surface:"وجد",   expect:"Verb",  via:"VERB3_PAST",
    desc:"وجد → Verb (direct GLOSS key found; Step 3 blocked; classifyBase→VERB3_PAST)",
  },

  // ── VERB3_PAST expanded (v138) ──────────────────────────────────────────
  {
    surface:"نجح",  expect:"Verb", via:"VERB3_PAST",
    desc:"نجح → Verb (succeeded; added to VERB3_PAST)",
  },
  {
    surface:"فاز",  expect:"Verb", via:"VERB3_PAST",
    desc:"فاز → Verb (won; added to VERB3_PAST)",
  },
  {
    surface:"هزم",  expect:"Verb", via:"VERB3_PAST",
    desc:"هزم → Verb (defeated; added to VERB3_PAST)",
  },
  {
    surface:"حضر",  expect:"Verb", via:"VERB3_PAST",
    desc:"حضر → Verb (attended; added to VERB3_PAST)",
  },
  {
    surface:"شهد",  expect:"Verb", via:"VERB3_PAST",
    desc:"شهد → Verb (witnessed; added to VERB3_PAST)",
  },
  {
    surface:"حصل",  expect:"Verb", via:"VERB3_PAST",
    desc:"حصل → Verb (obtained; added to VERB3_PAST)",
  },

  // ── VERB2_DBL — unambiguous doubled-root 2-char verbs (v138) ───────────
  {
    surface:"حث",  expect:"Verb", via:"VERB2_DBL",
    desc:"حث → Verb (urged; حثّ→حث; VERB2_DBL)",
  },
  {
    surface:"مد",  expect:"Verb", via:"VERB2_DBL",
    desc:"مد → Verb (extended; مدّ→مد; VERB2_DBL)",
  },
  {
    surface:"شد",  expect:"Verb", via:"VERB2_DBL",
    desc:"شد → Verb (tightened; شدّ→شد; VERB2_DBL)",
  },

  // ── Form VIII ل-root verbs: D1.5 before D2 definite catch-all ──────────
  {
    surface:"التقى",  expect:"Verb", via:"D1.5",
    desc:"التقى → Verb (met; Form VIII ل-root; D1.5 before D2)",
  },
  {
    surface:"التزم",  expect:"Verb", via:"D1.5",
    desc:"التزم → Verb (committed; Form VIII ل-root; D1.5)",
  },
  {
    surface:"التحق",  expect:"Verb", via:"D1.5",
    desc:"التحق → Verb (joined; Form VIII ل-root; D1.5)",
  },
  {
    surface:"التمس",  expect:"Verb", via:"D1.5",
    desc:"التمس → Verb (sought/appealed; Form VIII ل-root; D1.5)",
  },

  // ── Regression guards (must NOT change) ─────────────────────────────────
  {
    surface:"قال",  expect:"Verb", via:"VERB3_PAST",
    desc:"قال → Verb (original VERB3_PAST — regression guard)",
  },
  {
    surface:"دخل",  expect:"Verb", via:"VERB3_PAST",
    desc:"دخل → Verb (original VERB3_PAST — regression guard)",
  },
  {
    surface:"نشر",  expect:"Noun", via:"KNOWN_NOUNS",
    desc:"نشر → Noun (verbal noun; KNOWN_NOUNS outranks VERB3_PAST — regression guard)",
  },
  {
    surface:"صوت",  expect:"Noun", via:"KNOWN_NOUNS",
    desc:"صوت → Noun (voice; KNOWN_NOUNS; صوتوا is Verb via F2.5 — no confusion)",
  },
  {
    surface:"يعمل", expect:"Verb", via:"F2",
    desc:"يعمل → Verb (he works; F2 imperfect; 'worked' → verb in VERB_IRR not noun)",
  },
  {
    surface:"الكتاب", expect:"Noun", via:"D2",
    desc:"الكتاب → Noun (the book; D2 definite; not affected by F8L or Rule V)",
  },
];

// ── Runner ────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
console.log("\nSmartILR — Bidirectional English POS Enforcement (v138)");
console.log("=".repeat(72));

for (const t of TESTS) {
  const result = classify(t.surface);
  const got    = result.label;
  const ok     = got === t.expect;

  if (ok) {
    console.log(`✓ | ${String(t.surface).padEnd(10)} | ${t.via.padEnd(18)} | ${t.desc}`);
    pass++;
  } else {
    console.log(`✗ | ${String(t.surface).padEnd(10)} | EXPECTED "${t.expect}" GOT "${got}"`);
    console.log(`  | ${t.desc}`);
    fail++;
  }
}

console.log("=".repeat(72));
console.log(`\nTOTAL: ${pass+fail}  PASS: ${pass}  FAIL: ${fail}`);
if (fail === 0) {
  console.log("✅ ALL BIDIRECTIONAL POS ENFORCEMENT TESTS PASS\n");
  process.exit(0);
} else {
  console.log(`❌ ${fail} FAILURE(S)\n`);
  process.exit(1);
}
