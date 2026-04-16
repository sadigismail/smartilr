#!/usr/bin/env node
/**
 * SmartILR — tooltipClassifierAudit (14 tokens)
 * ─────────────────────────────────────────────
 * PHASE 3 VALIDATION — post-fix classifier mirror.
 * Mirrors the index.html _buildFallbackTooltip pipeline AFTER Phase 2 patches.
 * All 14 tokens must pass.
 *
 * Run: node tests/tooltipClassifierAudit.js
 * Exit 0 = all pass,  Exit 1 = regression detected.
 */
"use strict";

function N(s){
  return String(s).replace(/[\u064B-\u065F\u0670\u0671]/g,"")
    .replace(/[أإآٱ\u0622\u0623\u0625\u0627\u0671]/g,"ا").replace(/\u0640/g,"");
}
function isPassiveVoweled(s){
  const di=s.search(/\u064F/);
  if(di>=0&&/\u0650/.test(s.slice(di)))return true;
  if(/^[\u064A\u062A\u0646\u0623\u0627]\u064F/.test(s))return true;
  return false;
}

// ── Outer-scope constants ─────────────────────────────────────────────────────
const _ZARF_TIME  = new Set(["اثناء","خلال","قبل","بعد","عند","حين"]);
const _ZARF_PLACE = new Set(["بين","فوق","تحت","داخل","خارج","امام","خلف","وراء","حول"]);
const _GLOSS = { "قطع":"cut / severed","قال":"said" };   // only needed for F3 disambiguation
const _PASSIVE_LEXICON = new Set([
  "تم","جري","قتل","ذكر","نقل","صدر","ورد","سمع","حكم","اعلن","اصيب",
  "اعدم","اوقف","اسقط","افرج","افيد","اعيد","ادين","اطلق","اجري","احتجز",
  "اعتقل","اعتمد","استهدف","استبدل",
]);

// ── PHASE 2 FIX: PM includes prep+pronoun compounds and compound prepositions ─
const PM = {
  "إن":"subordinating conjunction","أن":"complementizer","إذا":"conditional particle",
  "إذ":"discourse marker","إلا":"focus particle","إذن":"discourse marker",
  "ان":"complementizer","اذا":"conditional particle","اذ":"discourse marker",
  "الا":"focus particle","اذن":"discourse marker",
  "قد":"focus particle","لن":"negation particle","لم":"negation particle",
  "سوف":"focus particle","هل":"interrogative particle","لا":"negation particle",
  "ما":"negation particle","لو":"conditional particle","بينما":"subordinating conjunction",
  "ليس":"negation particle","نعم":"response particle","بلى":"response particle",
  "كي":"subordinating conjunction","حتى":"subordinating conjunction",
  "عسى":"focus particle","ربما":"discourse marker","لعل":"focus particle",
  "لكن":"coordinating conjunction","بل":"coordinating conjunction",
  "لانه":"subordinating conjunction","لانها":"subordinating conjunction",
  "عندما":"subordinating conjunction","فيما":"subordinating conjunction",
  "حيثما":"subordinating conjunction","كلما":"subordinating conjunction",
  "طالما":"subordinating conjunction","بمجرد":"subordinating conjunction",
  "حين":"subordinating conjunction","حينما":"subordinating conjunction",
  "أي":"interrogative determiner","اي":"interrogative determiner",
  // ── PM_KEYS (Phase 2 fix) ─────────────────────────────────────────────────
  "منها":"prep+pronoun compound (from it / from her)",
  "منهم":"prep+pronoun compound (from them)",
  "منهن":"prep+pronoun compound (from them f.)",
  "فيها":"prep+pronoun compound (in it / in her)",
  "فيهم":"prep+pronoun compound (in them)",
  "عليها":"prep+pronoun compound (on it / on her)",
  "عليهم":"prep+pronoun compound (on them)",
  "اليها":"prep+pronoun compound (to it / to her)",
  "اليهم":"prep+pronoun compound (to them)",
  "لديها":"prep+pronoun compound (with her / she has)",
  "لديهم":"prep+pronoun compound (with them / they have)",
  "بهم":"prep+pronoun compound (with them)",
  "بها":"prep+pronoun compound (with it / with her)",
  "عنها":"prep+pronoun compound (about it / from her)",
  "عنهم":"prep+pronoun compound (about them)",
  "باسم":"compound preposition (in the name of / on behalf of)",
  "بسبب":"compound preposition (because of)",
  "بشأن":"compound preposition (regarding)",
};

const PREPS = new Set(["في","من","الى","إلى","على","عن","مع","دون","ضد","منذ","حتى","عبر","رغم","نحو","لدى","لدي","عدا","سوى","سوي","بشأن","بشان","باستثناء"]);
const CONJS  = new Set(["و","ف","ثم","او","أو","ام","أم","لكن","بل","واما","فإما"]);
const PRONOUNS = new Set(["هو","هي","هم","هن","هما","انت","أنت","انتم","أنتم","انتن","أنتن","انتما","أنتما","انا","أنا","نحن","ذلك","تلك","هذا","هذه","هؤلاء","اولئك","أولئك","الذي","التي","اللذان","اللتان","الذين","اللواتي","ذا","تا","ذان","تان","هنا","هناك","هنالك","ها"]);
const QUANTS = new Set(["كل","بعض","جميع","اغلب","أغلب","معظم","سائر","كلا","كلتا","بضع"]);

// ── PHASE 2 FIX: Unit numerals added ─────────────────────────────────────────
const _NUMERAL_WORDS = new Map([
  ["واحد",{morph:"cardinal",gloss:"one"}],
  ["واحدة",{morph:"cardinal",gloss:"one (f.)"}],
  ["اثنان",{morph:"cardinal",gloss:"two (nominative)"}],
  ["اثنين",{morph:"cardinal",gloss:"two"}],
  ["ثلاثة",{morph:"cardinal",gloss:"three"}],
  ["ثلاث",{morph:"cardinal",gloss:"three (f.)"}],
  ["اربعة",{morph:"cardinal",gloss:"four"}],
  ["اربع",{morph:"cardinal",gloss:"four (f.)"}],
  ["خمسة",{morph:"cardinal",gloss:"five"}],
  ["خمس",{morph:"cardinal",gloss:"five (f.)"}],
  ["ستة",{morph:"cardinal",gloss:"six"}],
  ["ست",{morph:"cardinal",gloss:"six (f.)"}],
  ["سبعة",{morph:"cardinal",gloss:"seven"}],
  ["سبع",{morph:"cardinal",gloss:"seven (f.)"}],
  ["ثمانية",{morph:"cardinal",gloss:"eight"}],
  ["ثماني",{morph:"cardinal",gloss:"eight (f.)"}],
  ["تسعة",{morph:"cardinal",gloss:"nine"}],
  ["تسع",{morph:"cardinal",gloss:"nine (f.)"}],
  ["عشر",{morph:"cardinal",gloss:"ten (f.)"}],
  ["عشرة",{morph:"cardinal",gloss:"ten"}],
  ["عشرون",{morph:"cardinal",gloss:"twenty (nominative)"}],
  ["عشرين",{morph:"cardinal",gloss:"twenty"}],
  ["ثلاثون",{morph:"cardinal",gloss:"thirty (nominative)"}],
  ["ثلاثين",{morph:"cardinal",gloss:"thirty"}],
  ["اربعون",{morph:"cardinal",gloss:"forty (nominative)"}],
  ["اربعين",{morph:"cardinal",gloss:"forty"}],
  ["خمسون",{morph:"cardinal",gloss:"fifty (nominative)"}],
  ["خمسين",{morph:"cardinal",gloss:"fifty"}],
  ["ستون",{morph:"cardinal",gloss:"sixty (nominative)"}],
  ["ستين",{morph:"cardinal",gloss:"sixty"}],
  ["سبعون",{morph:"cardinal",gloss:"seventy (nominative)"}],
  ["سبعين",{morph:"cardinal",gloss:"seventy"}],
  ["ثمانون",{morph:"cardinal",gloss:"eighty (nominative)"}],
  ["ثمانين",{morph:"cardinal",gloss:"eighty"}],
  ["تسعون",{morph:"cardinal",gloss:"ninety (nominative)"}],
  ["تسعين",{morph:"cardinal",gloss:"ninety"}],
  ["مئة",{morph:"quantity noun",gloss:"hundred"}],
  ["مائة",{morph:"quantity noun",gloss:"hundred"}],
  ["مئات",{morph:"quantity noun",gloss:"hundreds"}],
  ["الف",{morph:"quantity noun",gloss:"thousand"}],
  ["الاف",{morph:"quantity noun",gloss:"thousands"}],
  ["مليون",{morph:"quantity noun",gloss:"million"}],
  ["ملايين",{morph:"quantity noun",gloss:"millions"}],
  ["مليار",{morph:"quantity noun",gloss:"billion"}],
  ["مليارات",{morph:"quantity noun",gloss:"billions"}],
  ["تريليون",{morph:"quantity noun",gloss:"trillion"}],
]);

const KNOWN_NOUNS = new Map([
  ["عقد",{subtype:"verbal noun",measure:"Form I"}],
  ["نشر",{subtype:"verbal noun",measure:"Form I"}],
  ["دعم",{subtype:"verbal noun",measure:"Form I"}],
  ["رفض",{subtype:"verbal noun",measure:"Form I"}],
  ["فتح",{subtype:"verbal noun",measure:"Form I"}],
  ["ضغط",{subtype:"verbal noun",measure:"Form I"}],
  ["قتل",{subtype:"verbal noun",measure:"Form I"}],
  ["شكل",{subtype:null}],["وقت",{subtype:null}],["صوت",{subtype:null}],
  ["بيت",{subtype:null}],["باب",{subtype:null}],["جيش",{subtype:null}],
]);

// ── PHASE 2 FIX: جيوش and قطع added ──────────────────────────────────────────
const KNOWN_BP = new Set([
  "اعمال","اسباب","احداث","اطراف","افكار","انواع","احزاب","اقسام",
  "اعضاء","اهداف","اسماء","ابواب","احكام","امور","ابعاد",
  "حقوق","حدود","عقود","جنود","شعوب","نصوص","اصول","ظروف",
  "مناطق","مشاكل","مراحل","مراكز","محاور","مجالس",
  "قبائل","وسائل","رسائل","علماء","وزراء","رؤساء","امراء",
  "رجال","جبال","عمال","كبار","صغار","تجار","كتاب",
  "جيوش","قطع","شيوخ","ضيوف",    // Phase 2 fix
]);

const PLACE_NOUNS = new Set([
  "مكان","مطار","مكتب","ملعب","مسجد","مصنع",
  "مدرسة","مستشفى","مخيم","ملجا","معسكر","منطقة",
  "مدينة","محطة","منفذ","مدخل","مخرج",
  "موسم","موقع","موضع","مجلس","مجال",
]);

// ── PHASE 2 FIX: ضخمة/ضخم added ──────────────────────────────────────────────
const KNOWN_ADJS = new Map([
  ["اخرى","feminine singular"],["كبرى","feminine singular"],
  ["صغرى","feminine singular"],["اولى","feminine singular"],
  ["كبير","masculine singular"],["كبيرة","feminine singular"],
  ["صغير","masculine singular"],["صغيرة","feminine singular"],
  ["كثير","masculine singular"],["كثيرة","feminine singular"],
  ["جديد","masculine singular"],["جديدة","feminine singular"],
  ["قديم","masculine singular"],["قديمة","feminine singular"],
  ["خطير","masculine singular"],["خطيرة","feminine singular"],
  ["مهم","masculine singular"],["مهمة","feminine singular"],
  ["ضخم","masculine singular"],["ضخمة","feminine singular"],  // Phase 2 fix
  ["هائل","masculine singular"],["هائلة","feminine singular"],
]);

const SFXS = ["هما","كما","هم","هن","كم","كن","ني","نا","ها","ه","ك","ي"];
const hasSfx = s => SFXS.some(x => s.length > x.length+1 && s.endsWith(x));
const getSfx = s => SFXS.find(x => s.length > x.length+1 && s.endsWith(x));
const POSS = {"هما":"3rd dual","كما":"2nd dual","هم":"3rd masc pl","هن":"3rd fem pl",
  "كم":"2nd masc pl","كن":"2nd fem pl","ني":"1st sg","نا":"1st pl",
  "ها":"3rd fem sg","ه":"3rd masc sg","ك":"2nd sg","ي":"1st sg (genitive)"};
const _vm = b => {
  if(/^است/.test(b))return "Form X";
  if(/^ا[^ل]ت/.test(b)&&b.length>=5)return "Form VIII";
  if(/^انف/.test(b))return "Form VII";
  if(/^ت.ا/.test(b)&&b.length>=5)return "Form VI";
  if(/^ت/.test(b)&&b.length>=5)return "Form V";
  if(/^ا[^ل]/.test(b)&&b.length>=4&&b.length<=6)return "Form IV";
  if(b.length<=4)return "Form I";
  return null;
};

function classifyBase(bn){
  if(PM[bn])               return {label:"Particle",qualifier:PM[bn],path:"PM"};
  if(_ZARF_TIME.has(bn))   return {label:"Noun",subtype:"adverb of time",path:"ZARF-T"};
  if(_ZARF_PLACE.has(bn))  return {label:"Noun",subtype:"adverb of place",path:"ZARF-P"};
  if(PREPS.has(bn))        return {label:"Preposition",path:"PREPS"};
  if(CONJS.has(bn))        return {label:"Conjunction",path:"CONJ"};
  if(PRONOUNS.has(bn))     return {label:"Pronoun",path:"PRON"};
  if(QUANTS.has(bn))       return {label:"Noun",morph:"quantifier",path:"QUANTS"};
  if(PLACE_NOUNS.has(bn))  return {label:"Noun",subtype:"noun of place",path:"PLACE"};
  if(KNOWN_ADJS.has(bn))   return {label:"Adjective",morph:KNOWN_ADJS.get(bn),path:"KNOWN_ADJS"};
  if(KNOWN_NOUNS.has(bn)&&!_PASSIVE_LEXICON.has(bn)){
    const kn=KNOWN_NOUNS.get(bn);
    return {label:"Noun",subtype:kn.subtype||undefined,measure:kn.measure||undefined,path:"KNOWN_NOUNS"};
  }
  if(KNOWN_BP.has(bn)) return {label:"Noun",subtype:"broken plural (جمع تكسير)",path:"KNOWN_BP"};
  // Step B: nisba — PHASE 2 FIX: exclude /تي$/
  if(!(/^ال/.test(bn))){
    if(/يون$|يين$/.test(bn)) return {label:"Adjective",subtype:"nisba",morph:"masculine plural",path:"B-nisba"};
    if(/ية$/.test(bn)&&bn.length>=4) return {label:"Adjective",subtype:"nisba",morph:"feminine",path:"B-nisba"};
    if(/ي$/.test(bn)&&!/تي$/.test(bn)&&bn.length>=4&&!/^[يتن]/.test(bn))
      return {label:"Adjective",subtype:"nisba",path:"B-nisba"};
  }
  if(/^ا/.test(bn)&&/ى$/.test(bn)&&bn.length>=4&&!/^ال/.test(bn))
    return {label:"Adjective",morph:"feminine singular",path:"StepC"};
  // D0: م-prefix participle — BEFORE D1 (PHASE 2 FIX: was originally D6 after D1)
  if(/^م/.test(bn)&&bn.length>=5){
    const _g=/ة$|ات$/.test(bn)?"feminine":"masculine";
    return {label:"Adjective",subtype:"participle",morph:_g,path:"D0"};
  }
  if(/ة$/.test(bn)&&bn.length>=3) return {label:"Noun",morph:"feminine singular",path:"D1"};
  if(/^ال/.test(bn)){
    const d=bn.slice(2);
    if(/ات$/.test(d)&&d.length>=2) return {label:"Noun",subtype:"feminine sound plural",morph:"definite",path:"D2"};
    if(/ون$/.test(d)&&d.length>=3) return {label:"Noun",subtype:"masculine sound plural",morph:"nominative (ون), definite",path:"D2"};
    if(/ين$/.test(d)&&d.length>=2){
      const st=d.slice(0,-2);
      return st.length<=3
        ?{label:"Noun",subtype:"dual",morph:"accusative/genitive (ين), definite",path:"D2"}
        :{label:"Noun",subtype:"masculine sound plural",morph:"accusative/genitive (ين), definite",path:"D2"};
    }
    if(/ان$/.test(d)&&d.length>=4&&!/^ا/.test(d)) return {label:"Noun",subtype:"dual",morph:"nominative (ان), definite",path:"D2"};
    if(KNOWN_BP.has(d)) return {label:"Noun",subtype:"broken plural (جمع تكسير)",morph:"definite",path:"D2-BP"};
    return {label:"Noun",morph:"definite",path:"D2"};
  }
  if(/ات$/.test(bn)&&bn.length>=4) return {label:"Noun",subtype:"feminine sound plural",path:"D3"};
  if(/ان$/.test(bn)&&bn.length>=5&&!/^ا/.test(bn)) return {label:"Noun",subtype:"dual",morph:"nominative",path:"D4"};
  // D4.5: Numeral inside classifyBase (PHASE 2 FIX: enables وثمانين to classify as Numeral)
  if(_NUMERAL_WORDS.has(bn)){
    const _nw=_NUMERAL_WORDS.get(bn);
    return {label:"Numeral",morph:_nw.morph,gloss:_nw.gloss,path:"D4.5-NW"};
  }
  if(/ون$/.test(bn)&&bn.length>=4) return {label:"Noun",subtype:"masculine sound plural",morph:"nominative (ون)",path:"D5"};
  if(/ين$/.test(bn)&&bn.length>=4){
    const s5=bn.slice(0,-2);
    return s5.length<=3&&!/^ا/.test(bn)
      ?{label:"Noun",subtype:"dual",morph:"accusative/genitive (ين)",path:"D5-dual"}
      :{label:"Noun",subtype:"masculine sound plural",morph:"accusative/genitive (ين)",path:"D5"};
  }
  const ep=hasSfx(bn)?getSfx(bn):null;
  if(ep) return {label:"Noun",subtype:"idafa",possessor:POSS[ep]||ep,path:"D7"};
  if(_PASSIVE_LEXICON.has(bn)&&bn.length>=2)
    return {label:"Verb",voice:"passive",morph:"past, passive",measure:_vm(bn)||"Form I",path:"E0"};
  if(/^ت/.test(bn)&&/(يل|ير|يق|يذ|يم|يب|يد|يف|يح|يز|يع|يط|يت|يش)$/.test(bn)&&bn.length>=5&&bn.length<=7)
    return {label:"Noun",subtype:"verbal noun",measure:"Form II",path:"E1"};
  if(/^است/.test(bn)&&bn.length>=7)
    return {label:"Noun",subtype:"verbal noun",measure:"Form X",path:"E2"};
  if(/^ا[^لتز]ت/.test(bn)&&bn.length>=6&&bn.length<=8)
    return {label:"Noun",subtype:"verbal noun",measure:"Form VIII",path:"E3"};
  // F0: Future verb — PHASE 2 FIX
  if(/^س[يتنأا]/.test(bn)&&bn.length>=5&&!/^ال/.test(bn))
    return {label:"Verb",morph:"future",measure:_vm(bn),path:"F0-future"};
  if(/ت$/.test(bn)&&!/ات$/.test(bn)&&bn.length>=4&&!/^ال/.test(bn))
    return {label:"Verb",morph:"past, 3rd feminine singular",measure:_vm(bn.slice(0,-1))||_vm(bn),path:"F1"};
  if(/^[يتن]/.test(bn)&&bn.length>=3&&!/^ال/.test(bn))
    return {label:"Verb",morph:"present",measure:_vm(bn),path:"F2"};
  if(bn.length===3&&!/^ال/.test(bn)&&!/ة$/.test(bn)){
    if(_GLOSS[bn]) return {label:"Verb",morph:"past",measure:"Form I",path:"F3-verb"};
    return {label:"Noun",subtype:"verbal noun",measure:"Form I",path:"F3-noun"};
  }
  return {label:"Noun",path:"G"};
}

function classify(word){
  const n=N(word);
  if(isPassiveVoweled(word)) return {label:"Verb",voice:"passive",path:"P0"};
  if(PM[word]||PM[n]) return {label:"Particle",qualifier:PM[word]||PM[n],path:"main-PM"};
  if(_ZARF_TIME.has(n))  return {label:"Noun",subtype:"adverb of time",path:"main-ZT"};
  if(_ZARF_PLACE.has(n)) return {label:"Noun",subtype:"adverb of place",path:"main-ZP"};
  if(PREPS.has(n))       return {label:"Preposition",path:"main-PREPS"};
  if(CONJS.has(n))       return {label:"Conjunction",path:"main-CONJ"};
  if(PRONOUNS.has(n))    return {label:"Pronoun",path:"main-PRON"};
  if(QUANTS.has(n))      return {label:"Noun",morph:"quantifier",path:"main-QUANTS"};
  if(_NUMERAL_WORDS.has(n)){const nw=_NUMERAL_WORDS.get(n);return {label:"Numeral",morph:nw.morph,gloss:nw.gloss,path:"main-NW"};}
  if(/اً$/.test(word))  {const cls=classifyBase(N(word.slice(0,-2)));return {...cls,morphRole:"tanwin-nasb",path:"main-TAN"};}
  if(KNOWN_ADJS.has(n)) return {label:"Adjective",morph:KNOWN_ADJS.get(n)||undefined,path:"main-ADJS"};
  if(/يون$|يين$/.test(n)) return {label:"Adjective",subtype:"nisba",morph:"masculine plural",path:"main-nisba"};
  if(/ية$/.test(n)&&n.length>=4&&!/^[يتن]/.test(n)) return {label:"Adjective",subtype:"nisba",morph:"feminine",path:"main-nisba"};
  // PHASE 2 FIX: exclude /تي$/ from nisba check
  if(/ي$/.test(n)&&!/تي$/.test(n)&&n.length>=4&&n.length<=8&&!/^[يتن]/.test(n))
    return {label:"Adjective",subtype:"nisba",path:"main-nisba"};
  if(/^ا/.test(n)&&/ى$/.test(n)&&n.length>=4&&!/^ال/.test(n))
    return {label:"Adjective",morph:"feminine singular",path:"main-elative"};
  if(/^[وف]/.test(n)&&n.length>2){
    const base=classifyBase(n.slice(1));
    return {label:"Conjunction+"+base.label,compound:base,compoundPath:base.path,path:"main-CONJ+base"};
  }
  if(/^[بكل]/.test(n)&&n.length>2){
    const base=classifyBase(n.slice(1));
    return {label:"Preposition+"+base.label,compound:base,compoundPath:base.path,path:"main-PREP+base"};
  }
  return classifyBase(n);
}

// ── PHASE 2 FIX: _MULTIWORD_NE_MAP includes الولايات المتحدة / جوش آرنست ────
const _MWNE = new Map([
  ["الامم المتحدة",     {label:"Noun",subtype:"proper noun",morph:"organization name",gloss:"the United Nations"}],
  ["الولايات المتحدة",  {label:"Noun",subtype:"proper noun",morph:"country name",     gloss:"the United States"}],
  ["مجلس الامن",        {label:"Noun",subtype:"proper noun",morph:"organization name",gloss:"Security Council"}],
  ["كوريا الشمالية",   {label:"Noun",subtype:"proper noun",morph:"country name",     gloss:"North Korea"}],
  ["جوش ارنست",         {label:"Noun",subtype:"proper noun",morph:"person name",      gloss:"Josh Earnest"}],
  ["جوش آرنست",         {label:"Noun",subtype:"proper noun",morph:"person name",      gloss:"Josh Earnest"}],
]);

function checkMWNE(phrase){
  const nP=phrase.split(/\s+/).map(w=>N(w)).join(" ");
  return _MWNE.has(nP)?_MWNE.get(nP):null;
}

// ── Audit cases ───────────────────────────────────────────────────────────────
const CASES = [
  // A: adjective fixes
  {id:"A1",token:"ضخمة",  chk:c=>c.label==="Adjective",                       desc:"ضخمة → Adjective (KNOWN_ADJS)"},
  {id:"A2",token:"متقدمة",chk:c=>c.label==="Adjective"&&c.subtype==="participle",desc:"متقدمة → Adjective participle (D0 before D1)"},
  // B: compound numerals
  {id:"B1",token:"خمسة",  chk:c=>c.label==="Numeral",                          desc:"خمسة → Numeral (unit numeral in _NW)"},
  {id:"B2",token:"عشر",   chk:c=>c.label==="Numeral",                          desc:"عشر → Numeral (unit numeral in _NW)"},
  {id:"B3",token:"أربعة", chk:c=>c.label==="Numeral",                          desc:"أربعة → Numeral (unit numeral in _NW)"},
  {id:"B4",token:"وثمانين",chk:c=>c.label==="Conjunction+Numeral"||
                                   (c.label.startsWith("Conjunction+")&&c.compound&&c.compound.label==="Numeral"),
                                                                                 desc:"وثمانين → Conjunction+Numeral (D4.5 in classifyBase)"},
  // C: lexical broken plurals
  {id:"C1",token:"جيوش",  chk:c=>c.label==="Noun"&&c.subtype&&c.subtype.includes("broken plural"),
                                                                                 desc:"جيوش → Noun (broken plural) via KNOWN_BP"},
  {id:"C2",token:"قطع",   chk:c=>c.label==="Noun"&&c.subtype&&c.subtype.includes("broken plural"),
                                                                                 desc:"قطع → Noun (broken plural) via KNOWN_BP (not F3-verb)"},
  // D: PM compounds
  {id:"D1",token:"منها",  chk:c=>c.label==="Particle",                         desc:"منها → Particle (prep+pronoun compound in PM)"},
  {id:"D2",token:"باسم",  chk:c=>c.label==="Particle",                         desc:"باسم → Particle (compound prep in PM)"},
  // E: multiword NEs
  {id:"E1",multiword:"الولايات المتحدة",
           chk:m=>!!m&&m.label==="Noun"&&m.subtype==="proper noun",             desc:"الولايات المتحدة → merged proper noun"},
  {id:"E2",multiword:"جوش آرنست",
           chk:m=>!!m&&m.label==="Noun"&&m.subtype==="proper noun",             desc:"جوش آرنست → merged proper noun"},
  // F: dual/possessive (not nisba)
  {id:"F1",token:"حكومتي",chk:c=>c.label==="Noun",                             desc:"حكومتي → Noun (possessive/dual), NOT Adjective nisba"},
  // G: future verb
  {id:"G1",token:"ستتضمن",chk:c=>c.label==="Verb"&&c.morph==="future",         desc:"ستتضمن → Verb (future) via F0"},
];

// ── Run ───────────────────────────────────────────────────────────────────────
let pass=0,fail=0;
console.log("SmartILR — tooltipClassifierAudit Phase 3 (post-fix validation)");
console.log("=".repeat(72));

for(const t of CASES){
  let actual,ok,lbl;
  if(t.multiword){
    actual=checkMWNE(t.multiword);
    ok=t.chk(actual);
    lbl=actual?`${actual.label} — ${actual.subtype}`:"NOT-MERGED";
  } else {
    actual=classify(t.token);
    ok=t.chk(actual);
    lbl=actual.label+(actual.subtype?" — "+actual.subtype:"")+(actual.morph?" ("+actual.morph+")":"");
  }
  if(ok){ pass++; console.log(`✓ | ${t.id} | ${t.desc}`); }
  else  { fail++; console.log(`✗ | ${t.id} | ${t.desc}\n    Actual: ${lbl} [path:${actual&&actual.path||"?"}]`); }
}

console.log("=".repeat(72));
console.log(`\n${fail===0?"✅ ALL "+pass+" PASS":"⚠ "+fail+" FAIL / "+pass+" pass"}\n`);
process.exit(fail>0?1:0);
