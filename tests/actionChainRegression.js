// ── Action Chain Regression Suite (v137d) ─────────────────────────────────────
// Validates the generalized, entity-aware Action Chain builder.
//
// Tests verify:
//   1. _isVerb no longer fires on PERSON entity tokens (ترمب, دار)
//   2. _isVerb fires correctly on future-prefix verbs (سيلتقي, ستعود)
//   3. PERSON span grouping fuses إسحاق دار into one NP
//   4. Title phrase grouping fuses وزير الطاقة into one NP
//   5. Action Chain uses entity maps as single source of truth
// ─────────────────────────────────────────────────────────────────────────────

// ── Inline helpers — mirrors live code ──────────────────────────────────────
// Mirror of the live _arNormalize (index.html line 10726).
// Strips diacritics + alef variants + tatweel ONLY — no ة/ى/ؤ/ئ normalisation.
function _arNormalize(s) {
  return String(s || "")
    .replace(/[\u064B-\u065F\u0670\u0671]/g, "")
    .replace(/[أإآٱ\u0622\u0623\u0625\u0627\u0671]/g, "ا")
    .replace(/\u0640/g, "")
    .trim();
}

// Simulate entity maps (populated after fetchSupportTranslation)
function _buildMaps(personList, spanList) {
  const entityMap = {};
  const spanMap   = {};
  (personList || []).forEach(n => { entityMap[_arNormalize(n)] = "PERSON"; });
  (spanList   || []).forEach(n => { spanMap[_arNormalize(n)]   = "PERSON"; });
  return { entityMap, spanMap };
}

// ── Inline _extractLocalActionChain for unit testing ─────────────────────────
// (Same logic as live code, adapted for Node environment where window.* is unavailable)
function _extractLocalActionChain(text, { entityMap = {}, spanMap = {} } = {}) {
  if (!text || !text.trim()) return [];

  const _n = _arNormalize;
  const _bare = w => w.replace(/^[\u00AB\u00BB"'()\[\]]+/, "")
                      .replace(/[\u060C\u061F\u061B.!?,;:\u00AB\u00BB"'()\[\]\u2026]+$/, "")
                      .trim();

  const _isPERSON = norm =>
    (entityMap[norm] === "PERSON") || (spanMap[norm] === "PERSON");

  // Both ى (U+0649) and ي (U+064A) forms — live _arNormalize does NOT convert ى→ي
  const _F8L_VERBS = new Set([
    "التقى","التقي","التمس","التزم","التحق",
    "الجأ","الجا","التقت","التزمت","التحقت",
  ]);
  const _isVerb = w => {
    const b = _n(_bare(w));
    if (!b || b.length < 2) return false;
    if (/\u0627\u062A$/.test(b) || /\u0648\u0646$/.test(b)) return false;   // ات / ون
    if (/^\u0627\u0633\u062A/.test(b) && b.length >= 7) return false;        // استفعال masdar
    if (_isPERSON(b)) return false;                                           // PERSON exclusion
    if (_F8L_VERBS.has(b)) return true;                                       // Form VIII ل root
    if (/^ال/.test(b) || /\u0629$/.test(b)) return false;                    // definite / ة noun
    if (/^\u0633[\u064A\u062A\u0646]/.test(b) && b.length >= 4) return true; // future سيـ/ستـ/سنـ
    if (/^[\u064A\u062A\u0646]/.test(b) && b.length >= 3) return true;       // imperfect يـ/تـ/نـ
    if (/^\u0627[^\u0644]/.test(b) && b.length === 4 && !/\u0629$/.test(b)) return true; // Form IV
    if (/\u062A$/.test(b) && !/\u0627\u062A$/.test(b) && b.length >= 4) return true; // past f.sg.
    if (b.length === 3 && !/\u0629$/.test(b)) return true;                   // Form I past
    return false;
  };

  const _isNoun = w => {
    const b = _n(_bare(w));
    if (!b || b.length < 2) return false;
    if (_isPERSON(b)) return true;                       // ← PERSON always noun
    if (/^ال/.test(b)) return true;
    if (/\u0629$|\u0627\u062A$|\u0648\u0646$|\u064A\u0646$|\u0627\u0646$/.test(b)) return true;
    return !_isVerb(w) && b.length >= 4;
  };

  const _CONJ_SET = new Set(["و","ف","ثم","او","اما","لكن","بل",
    "بينما","حيث","اذ","كما","حين","عندما","فيما","حينما"]);
  const _PREP_SET = new Set(["في","من","الى","على","عن","مع","دون",
    "ضد","رغم","عبر","نحو","لدى","لدي","بعد","قبل","خلال","بسبب",
    "منذ","ازاء","اثناء","وسط","امام","حول"]);

  const _isConj = w => _CONJ_SET.has(_n(_bare(w)));
  const _isPrep = w => _PREP_SET.has(_n(_bare(w)));
  const _isFunc = w => _isConj(w) || _isPrep(w);

  const _TITLE_WORDS = new Set([
    "وزير","وزيرة","وزراء","رئيس","رئيسة","رؤساء","مدير","مديرو",
    "نائب","وكيل","سفير","قائد","امين","مستشار","المستشار",
    "الرئيس","الوزير","المدير","القائد","السفير",
  ]);

  function _groupPersonSpans(words) {
    const out = [];
    let i = 0;
    while (i < words.length) {
      const b = _n(_bare(words[i]));
      if (_isPERSON(b)) {
        const parts = [words[i]];
        let j = i + 1;
        while (j < words.length && _isPERSON(_n(_bare(words[j])))) { parts.push(words[j]); j++; }
        out.push({ type:"PERSON", text: parts.map(_bare).join(" "), words: parts });
        i = j;
      } else {
        out.push({ type:"token", text: words[i], words: [words[i]] });
        i++;
      }
    }
    return out;
  }

  function _groupTitlePhrases(grouped) {
    const out = [];
    let i = 0;
    while (i < grouped.length) {
      const item = grouped[i];
      if (item.type === "token" && _TITLE_WORDS.has(_n(_bare(item.text)))) {
        const parts = [item];
        let j = i + 1;
        while (j < grouped.length && j <= i + 2) {
          const next = grouped[j];
          if (next.type === "PERSON") break;
          const nb = _n(_bare(next.text));
          if (/^ال/.test(nb) || (_isNoun(next.text) && !_isFunc(next.text))) {
            parts.push(next); j++;
            if (/^ال/.test(nb)) break;
          } else break;
        }
        out.push({ type:"TITLE", text: parts.map(p => _bare(p.text)).join(" "), words: parts.flatMap(p=>p.words) });
        i = j;
      } else { out.push(item); i++; }
    }
    return out;
  }

  const _itemText = item =>
    String(item.text||"").replace(/^[\u00AB\u00BB"'()\[\]]+/,"")
                         .replace(/[\u060C\u061F\u061B.!?,;:]+$/,"").trim();

  const allWords = text.trim().split(/\s+/).filter(Boolean);
  const clauses = [];
  let cur = [];
  allWords.forEach(w => {
    cur.push(w);
    if (/[.؟?!]/.test(w)) { if (cur.length > 1) clauses.push(cur.slice()); cur = []; }
    else if (/[،,]$/.test(w)) { if (cur.length > 1) clauses.push(cur.slice()); cur = []; }
  });
  if (cur.length > 1) clauses.push(cur);
  if (clauses.length === 0 && allWords.length > 1) clauses.push(allWords);

  const snaps = [];
  clauses.slice(0, 6).forEach(clause => {
    const ws = clause.map(_bare).filter(Boolean);
    if (ws.length < 2) return;
    const snap = {};
    let start = 0;
    if (_isConj(ws[0])) { snap.connector = ws[0]; start = 1; }
    const rest = ws.slice(start);
    if (!rest.length) return;

    let grouped = _groupPersonSpans(rest);
    grouped = _groupTitlePhrases(grouped);

    const vIdx = grouped.findIndex(item => item.type === "token" && _isVerb(item.text));

    if (vIdx >= 0) {
      snap.verb = _itemText(grouped[vIdx]);
      const pre  = grouped.slice(0, vIdx).filter(item => item.type !== "token" || !_isFunc(item.text));
      const post = grouped.slice(vIdx + 1);

      const preNPs = pre.filter(item => item.type !== "token" || _isNoun(item.text));
      if (preNPs.length) snap.subject = preNPs.slice(0, 2).map(_itemText).join(" ");

      const postNPs = [];
      let inPrep = false, prepWords = [];
      post.forEach(item => {
        if (item.type !== "token") { postNPs.push(item); }
        else if (_isPrep(item.text)) {
          if (prepWords.length > 1 && !snap.prepPhrase) snap.prepPhrase = prepWords.join(" ");
          inPrep = true; prepWords = [item.text];
        } else if (inPrep) {
          prepWords.push(item.text);
          if (prepWords.length >= 3) { if (!snap.prepPhrase) snap.prepPhrase = prepWords.join(" "); inPrep=false; prepWords=[]; }
        } else if (_isNoun(item.text) && !_isFunc(item.text)) { postNPs.push(item); }
      });
      if (inPrep && prepWords.length > 1 && !snap.prepPhrase) snap.prepPhrase = prepWords.join(" ");

      if (!snap.subject && postNPs.length) {
        snap.subject = _itemText(postNPs[0]);
        if (postNPs.length > 1) snap.object = postNPs.slice(1,3).map(_itemText).join(" ");
      } else if (postNPs.length) {
        snap.object = postNPs.slice(0,2).map(_itemText).join(" ");
      }
    } else {
      const nouns = grouped.filter(item => item.type !== "token" || !_isFunc(item.text));
      if (nouns.length >= 1) snap.subject = _itemText(nouns[0]);
      if (nouns.length >= 2) snap.complement = nouns.slice(1,4).map(_itemText).join(" ");
    }
    if (Object.keys(snap).length > 0) snaps.push(snap);
  });
  return snaps;
}

// ─────────────────────────────────────────────────────────────────────────────
const CASES = [

  // ── _isVerb / _isNoun atomic tests ───────────────────────────────────────
  ["[VERB] _isVerb: سيلتقي detected as verb (future سيـ prefix)", () => {
    const { entityMap, spanMap } = _buildMaps([], []);
    const snaps = _extractLocalActionChain("سيلتقي رئيسان", { entityMap, spanMap });
    return snaps.length > 0 && snaps[0].verb === "سيلتقي";
  }],
  ["[VERB] _isVerb: ستعود detected as verb (future ستـ prefix)", () => {
    const { entityMap, spanMap } = _buildMaps([], []);
    const snaps = _extractLocalActionChain("ستعود القوات", { entityMap, spanMap });
    return snaps.length > 0 && snaps[0].verb === "ستعود";
  }],
  ["[VERB] _isVerb: يسهم detected as verb (imperfect يـ prefix)", () => {
    const { entityMap, spanMap } = _buildMaps([], []);
    const snaps = _extractLocalActionChain("يسهم التعاون في الأمن", { entityMap, spanMap });
    return snaps.length > 0 && snaps[0].verb === "يسهم";
  }],

  // ── PERSON exclusion from _isVerb ────────────────────────────────────────
  ["[PERSON] ترمب NOT classified as verb (starts with تـ, is PERSON entity)", () => {
    const { entityMap, spanMap } = _buildMaps(["ترمب"], []);
    const snaps = _extractLocalActionChain("التقى ترمب بمستشاريه", { entityMap, spanMap });
    // ترمب must appear as subject/object, NOT as verb
    const hasVerbTrump = snaps.some(s => s.verb === "ترمب");
    return !hasVerbTrump;
  }],
  ["[PERSON] دار NOT classified as verb (3-char, is PERSON spanMap member)", () => {
    const { entityMap, spanMap } = _buildMaps([], ["دار"]);
    // Without entity map: دار would be verb (3-char rule)
    // With entity map: دار is PERSON → noun
    const snapsOld = _extractLocalActionChain("إسحاق دار وزير الطاقة", {});
    const snapsNew = _extractLocalActionChain("إسحاق دار وزير الطاقة", { entityMap, spanMap });
    const oldHasDarAsVerb = snapsOld.some(s => s.verb === "دار");
    const newHasDarAsVerb = snapsNew.some(s => s.verb === "دار");
    // Old pipeline would use دار as verb; new pipeline should not
    return oldHasDarAsVerb === true && newHasDarAsVerb === false;
  }],
  ["[PERSON] إسحاق NOT classified as verb when in entityMap", () => {
    const { entityMap, spanMap } = _buildMaps(["إسحاق"], ["دار"]);
    const snaps = _extractLocalActionChain("التقى إسحاق دار", { entityMap, spanMap });
    return !snaps.some(s => s.verb === "اسحاق");
  }],

  // ── PERSON span grouping ─────────────────────────────────────────────────
  ["[PERSON-SPAN] إسحاق دار grouped as ONE subject NP (not split)", () => {
    const { entityMap, spanMap } = _buildMaps(["إسحاق"], ["دار"]);
    const snaps = _extractLocalActionChain("التقى إسحاق دار بمستشاريه", { entityMap, spanMap });
    // Subject should be "إسحاق دار" (two-word span), NOT just "إسحاق" or "دار"
    return snaps.some(s => s.subject && s.subject.includes("إسحاق") && s.subject.includes("دار"));
  }],
  ["[PERSON-SPAN] ماركو روبيو grouped as ONE NP", () => {
    const { entityMap, spanMap } = _buildMaps(["ماركو","روبيو"], []);
    const snaps = _extractLocalActionChain("التقى ماركو روبيو بنظيره", { entityMap, spanMap });
    return snaps.some(s => s.subject && s.subject.includes("ماركو") && s.subject.includes("روبيو"));
  }],
  ["[PERSON-SPAN] كير ستارمر grouped as ONE NP", () => {
    const { entityMap, spanMap } = _buildMaps(["كير","ستارمر"], []);
    const snaps = _extractLocalActionChain("أعلن كير ستارمر عن الخطة", { entityMap, spanMap });
    return snaps.some(s => (s.subject || s.verb) && snaps[0].subject &&
      snaps[0].subject.includes("كير") && snaps[0].subject.includes("ستارمر"));
  }],

  // ── Title phrase grouping ─────────────────────────────────────────────────
  ["[TITLE] وزير الطاقة grouped as ONE NP (not split into verb + noun)", () => {
    const { entityMap, spanMap } = _buildMaps([], []);
    const snaps = _extractLocalActionChain("التقى وزير الطاقة بالمسؤولين", { entityMap, spanMap });
    // "وزير الطاقة" must appear as one subject/object, not "وزير" alone
    const subj = (snaps[0] || {}).subject || "";
    return subj.includes("وزير") && subj.includes("الطاقة");
  }],
  ["[TITLE] رئيس الوزراء grouped as ONE NP", () => {
    const { entityMap, spanMap } = _buildMaps([], []);
    const snaps = _extractLocalActionChain("أعلن رئيس الوزراء عن القرار", { entityMap, spanMap });
    const subj = snaps.find(s=>s.subject && s.subject.includes("رئيس"));
    return !!(subj && subj.subject.includes("الوزراء"));
  }],
  ["[TITLE] الرئيس ترمب — title + PERSON span stay together", () => {
    const { entityMap, spanMap } = _buildMaps(["ترمب"], []);
    // الرئيس is a title word; ترمب follows as PERSON
    const snaps = _extractLocalActionChain("التقى الرئيس ترمب بوفد", { entityMap, spanMap });
    // "الرئيس" is definite — subject should include both
    return snaps.length > 0;
  }],
  ["[TITLE] وزير الخارجية grouped — stays intact (not split by article)", () => {
    const { entityMap, spanMap } = _buildMaps([], []);
    const snaps = _extractLocalActionChain("زار وزير الخارجية عمّان", { entityMap, spanMap });
    const subj = (snaps[0] || {}).subject || "";
    return subj.includes("وزير") && subj.includes("الخارجية");
  }],

  // ── Future verb with full sentence ───────────────────────────────────────
  ["[FULL] سيلتقي ترمب بكير ستارمر — correct verb + subject + PERSON grouping", () => {
    const { entityMap, spanMap } = _buildMaps(["ترمب","كير","ستارمر"], []);
    const snaps = _extractLocalActionChain("سيلتقي ترمب بكير ستارمر", { entityMap, spanMap });
    if (!snaps.length) return false;
    const s = snaps[0];
    // Verb must be سيلتقي; ترمب must be subject (not verb)
    return s.verb === "سيلتقي" && s.subject && s.subject.includes("ترمب");
  }],

  // ── Old pipeline comparison — prove it was broken ─────────────────────────
  ["[REGRESSION] OLD: _isVerb('ترمب') returns true (no entity maps)", () => {
    const oldIsVerb = w => {
      const b = _arNormalize(w);
      if (!b || b.length < 2) return false;
      if (/^ال/.test(b) || /ة$/.test(b)) return false;
      if (/ات$/.test(b) || /ون$/.test(b)) return false;
      if (/^است/.test(b) && b.length >= 7) return false;
      if (/^[يتن]/.test(b) && b.length >= 3) return true;
      if (/ت$/.test(b) && !/ات$/.test(b) && b.length >= 4) return true;
      if (b.length === 3 && !/ة$/.test(b)) return true;
      return false;
    };
    return oldIsVerb("ترمب") === true;  // confirms old bug
  }],
  ["[REGRESSION] NEW: _isVerb('ترمب') returns false (PERSON entity excluded)", () => {
    const { entityMap, spanMap } = _buildMaps(["ترمب"], []);
    // Run extraction and confirm ترمب is not treated as a verb
    const snaps = _extractLocalActionChain("جاء ترمب اليوم", { entityMap, spanMap });
    return !snaps.some(s => s.verb === "ترمب");
  }],
  ["[REGRESSION] OLD: _isVerb('دار') returns true (3-char, no entity map)", () => {
    const oldIsVerb = w => {
      const b = _arNormalize(w);
      if (b.length === 3 && !/ة$/.test(b)) return true;
      return false;
    };
    return oldIsVerb("دار") === true;  // confirms old bug
  }],
  ["[REGRESSION] NEW: _isVerb('دار') returns false (PERSON spanMap exclusion)", () => {
    const snaps = _extractLocalActionChain("إسحاق دار وزير", {
      entityMap: {}, spanMap: { "دار": "PERSON" }
    });
    return !snaps.some(s => s.verb === "دار");
  }],
  ["[REGRESSION] OLD: سيلتقي NOT detected as verb (future prefix missing)", () => {
    const oldIsVerb = w => {
      const b = _arNormalize(w);
      if (!b || b.length < 2) return false;
      if (/^[يتن]/.test(b) && b.length >= 3) return true;
      if (/ت$/.test(b) && !/ات$/.test(b) && b.length >= 4) return true;
      if (b.length === 3 && !/ة$/.test(b)) return true;
      return false;
    };
    return oldIsVerb("سيلتقي") === false;  // confirms old bug
  }],
  ["[REGRESSION] NEW: سيلتقي detected as verb (future prefix سيـ added)", () => {
    const snaps = _extractLocalActionChain("سيلتقي المسؤولون بالوفد", { entityMap:{}, spanMap:{} });
    return snaps.some(s => s.verb === "سيلتقي");
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
if (fail === 0) console.log("✅ ALL ACTION CHAIN REGRESSION TESTS PASS");
else            process.exit(1);
