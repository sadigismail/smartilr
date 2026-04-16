// ─────────────────────────────────────────────────────────────────────────────
// engine/wordAnalysisEngine.js
//
// Per-word morphological analysis for the Grammar Analysis view inside
// Linguistic View.  Arabic-focused: POS, voice, measure, tense, subtype,
// gender, number, definiteness, gloss, notes.
// Does NOT affect ILR scoring.
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from "openai";
import { WORD_ANALYSIS_MODEL } from "../config/modelConfig.js";

// Prefer Replit AI Integrations proxy vars; fall back to user-supplied key.
const client = new OpenAI({
  apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL,
});

function buildPrompt(text, language) {
  const langNote = (language && language !== "Auto-detect")
    ? `The text is in ${language}.`
    : "Detect the language automatically.";

  return `You are a linguistic morphology analyzer for SmartILR, a teacher-facing Arabic language tool.
Your task: tokenize the provided text into its natural surface words and annotate each token morphologically.
${langNote}

Return ONLY a valid JSON object with this structure:
{
  "words": [
    {
      "word":            "REQUIRED. Copy the token EXACTLY as it appears in the source text — preserve all diacritics, hamza forms, alef variants, and attached clitics. Do not strip or normalize anything.",
      "pos":             "REQUIRED. The word's CONTEXTUAL grammatical role in this sentence. One of: noun | verb | adjective | adverb | particle | preposition | conjunction | pronoun | numeral | interjection | preposition+noun | conjunction+noun | conjunction+verb | preposition+verb | conjunction+adjective | other. IMPORTANT: for derived forms (active/passive participles, verbal nouns), use 'adjective' if functioning adjectivally, 'noun' if functioning nominally. The morphological origin goes in 'subtype', NOT here. See CONTEXTUAL POS RULES below.",
      "subtype":         "Morphological classification (independent of contextual role). For nouns/adjectives: verbal noun | active participle | passive participle | broken plural | feminine sound plural | masculine sound plural | dual | elative | nisba | demonstrative | relative | proper noun. Omit for plain nouns with no derived-form subtype.",
      "voice":           "For VERBS only: active | passive | context-ambiguous. REQUIRED for every verb. Use 'context-ambiguous' when the surface form is morphologically ambiguous (common in unvocalized Arabic) and the sentence context does not confidently resolve the voice. See VOICE RULES below.",
      "tense":           "For verbs only: past | present | future | imperative | jussive | subjunctive. Use 'future' when the future is expressed analytically with سوف or سـ.",
      "verbType":        "For verbs only: transitive | intransitive | defective | quadriliteral. Do NOT use 'passive' here — passive is expressed via the voice field.",
      "particleType":    "For particles/conjunctions/prepositions: coordinating conjunction | subordinating conjunction | complementizer | preposition | interrogative particle | negation particle | focus particle | conditional particle | discourse marker | response particle",
      "measure":         "Roman numeral I–X for Arabic derived stems. See MEASURE RULES below.",
      "attachedPronoun": "If the token has a SUFFIX PRONOUN (ضمير متصل) attached, describe it in English. Format: 'ني (1st singular)' / 'ه (3rd masc. singular)' / 'ها (3rd fem. singular)' / 'هم (3rd masc. plural)' / 'نا (1st plural)' / 'ك (2nd masc. singular)' etc. Omit if no suffix pronoun.",
      "gender":          "masculine | feminine — omit if not applicable.",
      "number":          "singular | dual | plural — omit if not applicable.",
      "definiteness":    "definite | indefinite | construct state — omit if not applicable.",
      "gloss":           "REQUIRED. Short English translation, 1–4 words. NEVER use Arabic script here.",
      "notes":           "Optional English-only parsing note, e.g. attached clitic preposition بـ, cliticized conjunction وَ, silent alef, irregular root."
    }
  ]
}

══════════════════════════════════════════════════════════════════
MEASURE RULES  (Arabic verb forms / derived stems)
══════════════════════════════════════════════════════════════════
Arabic verbal stems follow up to 10 canonical patterns (measures):
  I   — faʿala / fiʿala / fuʿala — basic trilateral root
  II  — faʿʿala — doubled middle radical (intensification, causation)
  III — fāʿala — lengthened vowel between 1st and 2nd radical (reciprocity)
  IV  — ʾafʿala — prefix أ (causation)
  V   — tafaʿʿala — prefix تـ + Measure II pattern
  VI  — tafāʿala — prefix تـ + Measure III pattern
  VII — infaʿala — prefix انـ (reflexive/passive of I)
  VIII— iftaʿala — infixed ت after 1st radical
  IX  — ifʿalla — for color and defect adjectives (rare)
  X   — istafʿala — prefix استـ (causative-reflexive)

MANDATORY: include "measure" for ALL of the following:
  a) Every VERB (past, present, future, imperative, jussive, subjunctive, active or passive voice)
  b) Every VERBAL NOUN (masdar) — noun derived from a verb
  c) Every ACTIVE PARTICIPLE (اسم الفاعل)
  d) Every PASSIVE PARTICIPLE (اسم المفعول)
  e) Every ELATIVE / comparative-superlative adjective

If you cannot confidently determine the measure, set "measure": "unidentified".
Do NOT omit the measure field entirely for the above categories.

══════════════════════════════════════════════════════════════════
VOICE RULES  (context-sensitive — do not assume from surface form alone)
══════════════════════════════════════════════════════════════════
For EVERY verb token you MUST include a "voice" field. Allowed values:
  "active"             — context confidently supports an active reading
  "passive"            — context confidently supports a passive reading
  "context-ambiguous"  — surface form is ambiguous and context does not resolve it

CRITICAL: In unvocalized Arabic, many verb forms are morphologically ambiguous
between active and passive.  You MUST NOT infer voice from surface form alone.

Forms that are COMMONLY AMBIGUOUS in unvocalized text:
  - Form I past:   فعل — could be faʿala (active) or fuʿila (passive)
  - Form IV past:  أفعل / أعلن / أرسل — could be active or passive
  - Form X past:   استخدم / استُخدم — could be active or passive
  (Any form where the difference is only in diacritics is potentially ambiguous)

DISAMBIGUATION DECISION PROCESS:
Read the FULL sentence (or clause) containing the verb, then evaluate:

  EVIDENCE FOR ACTIVE:
  ✓ An explicit nominal subject (اسم ظاهر) follows the verb and agrees in gender/number
  ✓ A clear agent performs the action (رئيس الوزراء أعلن / قال المسؤول)
  ✓ A direct object follows (verb+subject+object order), verb agrees with subject
  ✓ The verb has an attached subject pronoun matching the agent
  ✓ Subject continuity: preceding clause established an agent who continues acting

  EVIDENCE FOR PASSIVE:
  ✓ No overt agent is present; the patient/theme is promoted to subject position
  ✓ The verb agrees with a following noun that functions as patient, not agent
  ✓ Passive indicators: من قِبَل, من طرف (by whom) in the clause
  ✓ Vocalization is present and confirms passive vowels (damma + kasra pattern)
  ✓ Context is impersonal / institutional (مُنح، صدر، نُشر…)

  USE "context-ambiguous" WHEN:
  ✗ No overt subject or agent is present
  ✗ The verb form is inherently ambiguous and context provides no decisive clue
  ✗ Multiple readings are equally grammatical and semantically coherent
  Example: أعلن وقف إطلاق النار — no agent named, ambiguous whether someone
           declared (active) or it was declared (passive)

EXAMPLES:
  أعلن رئيس الوزراء وقفًا فوريًا
    → voice: "active"  (رئيس الوزراء is the explicit subject agent)

  أعلن وقف إطلاق النار
    → voice: "context-ambiguous"  (no agent, either reading is possible)

  استُخدم الأسلوب في... (with damma on alef)
    → voice: "passive"  (diacritics confirm passive pattern)

  قال المسؤول إن...
    → voice: "active"  (المسؤول is the overt subject)

Never use "passive" in the verbType field — voice is the only place for this.

══════════════════════════════════════════════════════════════════
SUBTYPE RULES
══════════════════════════════════════════════════════════════════
Use "subtype" to classify the MORPHOLOGICAL FORM of derived nouns/adjectives.
This is independent of the contextual POS (see CONTEXTUAL POS RULES below).
  - "verbal noun"        → masdar, a noun derived from a verb; must also have measure
  - "active participle"  → اسم الفاعل (fāʿil pattern and derived-form equivalents); must also have measure
  - "passive participle" → اسم المفعول (mafʿūl pattern and derived-form equivalents); must also have measure
  - "feminine sound plural" → concatenative plural with -āt suffix (ات ending: الجهات، الولايات، المنظمات، الجماعات)
  - "masculine sound plural" → concatenative plural with -ūn/-īn suffix (ون/ين ending: المعلمون، المحتجين)
  - "broken plural"          → non-concatenative plural; internal vowel change, no ات/ون/ين suffix (الدول، الرجال، الأماكن، الأسباب)

PLURAL / DUAL SELECTION RULE (mandatory):
  1. Word ends in ات                        → ALWAYS "feminine sound plural" (no exceptions)
  2. Word ends in ون                        → ALWAYS "masculine sound plural"
  3. Word ends in ان  AND number is dual    → "dual"   (المثنى المرفوع)
  4. Word ends in ين  AND number is dual    → "dual"   (المثنى المنصوب/المجرور)
  5. Word ends in ين  AND number is plural  → "masculine sound plural"
  6. Plural with internal structure change  → "broken plural"
  CRITICAL: DO NOT label ان-ending words as "masculine sound plural" — that ending does NOT exist for masculine plural.
  Never use "sound plural" — always pick one of the specific forms above.
  - "dual"               → المثنى — exactly two referents; separate from masculine sound plural
  - "elative"            → أفعل comparative/superlative; must also have measure
  - "nisba"              → adjective of relation (-iyy)
  - "proper noun"        → for names and place names

══════════════════════════════════════════════════════════════════
أي — NEVER DEMONSTRATIVE
══════════════════════════════════════════════════════════════════
أي is NOT a demonstrative pronoun. It functions as:
  • interrogative determiner ("which?", "what?")
  • relative particle ("any", "whatever")
  • indirect question marker
NEVER use subtype:"demonstrative" for أي.
CORRECT:  أي → pos:"particle"  particleType:"interrogative determiner"

══════════════════════════════════════════════════════════════════
MASDAR + TANWĪN ≠ ADVERB
══════════════════════════════════════════════════════════════════
A masdar (verbal noun) that appears with accusative tanwīn (تنوين النصب, ending -an اً) is
NOT automatically an adverb. It is a noun in the accusative case.

CORRECT:
  تنديداً  → pos:"noun"  subtype:"verbal noun"  measure:"Form II"  notes:"accusative (منصوب), tanwīn al-naṣb"
  تصعيداً  → pos:"noun"  subtype:"verbal noun"  measure:"Form II"  notes:"accusative (منصوب), tanwīn al-naṣb"
  إعلاناً  → pos:"noun"  subtype:"verbal noun"  measure:"Form IV"  notes:"accusative (منصوب), tanwīn al-naṣb"

INCORRECT (do NOT do this):
  تنديداً → pos:"adverb"  ← WRONG

RULE: Only classify as adverb (hāl, circumstantial) when the word is an ADJECTIVE or NOUN
functioning circumstantially (e.g. دولياً from دولي), NOT when it is a masdar with tanwīn.

══════════════════════════════════════════════════════════════════
BROKEN PLURAL DETECTION (جمع التكسير)
══════════════════════════════════════════════════════════════════
Arabic has three plural types. You MUST distinguish them:
  1. Sound feminine plural (جمع مؤنث سالم) — ends ات  e.g. الدعوات, اتفاقيات
  2. Sound masculine plural (جمع مذكر سالم) — ends ون/ين  e.g. المدنيين, المسؤولون
  3. BROKEN PLURAL (جمع تكسير) — irregular; does NOT end ات/ون/ين  e.g. الأعمال, المدن

BROKEN PLURAL: subtype must be "broken plural" (NOT just "noun").
  الأعمال   → pos:"noun"  subtype:"broken plural"  notes:"definite"
  الأحداث   → pos:"noun"  subtype:"broken plural"  notes:"definite"
  الأسباب   → pos:"noun"  subtype:"broken plural"  notes:"definite"
  المدن     → pos:"noun"  subtype:"broken plural"  notes:"definite"
  الأيام    → pos:"noun"  subtype:"broken plural"  notes:"definite"
  حقوق      → pos:"noun"  subtype:"broken plural"
  دول       → pos:"noun"  subtype:"broken plural"
  مناطق     → pos:"noun"  subtype:"broken plural"
  وسائل     → pos:"noun"  subtype:"broken plural"
  علماء     → pos:"noun"  subtype:"broken plural"

COMMON BROKEN PLURAL PATTERNS (for reference):
  أفعال  (أعمال, أسباب, أحداث, أطراف, أفكار, أنواع, أيام)
  فعول   (حقوق, حدود, عقود, شعوب, نصوص, ظروف, حلول)
  فعال   (رجال, جبال, عمال, كبار)
  فعل    (دول, مدن, درر, قوى, فرق)
  مفاعل  (مناطق, مشاكل, مراحل, مراكز, محاور, مجالس, مواقع)
  فعائل  (قبائل, وسائل, رسائل, وقائع, جرائم, حوادث)
  فعلاء  (علماء, وزراء, رؤساء, أمراء, شهداء, خبراء)
  فعلة   (قضاة, طلبة, ساسة, قادة) ← these END in ة but are BROKEN PLURALS, NOT feminine singular
  تفاعيل (تفاصيل, مفاهيم, مشاريع)

CRITICAL: Words like أسلحة, أجهزة, طلبة, قضاة end in ة but are BROKEN PLURALS.
Do NOT classify them as "feminine singular". Use subtype:"broken plural".

══════════════════════════════════════════════════════════════════
PLURAL AND DUAL DETECTION
══════════════════════════════════════════════════════════════════
Always identify number (singular / dual / plural) and case for nouns.

SOUND FEMININE PLURAL (جمع المؤنث السالم): ends ات (with or without ال)
  الدعوات → pos:"noun"  subtype:"sound feminine plural"  notes:"definite"
  اتفاقيات → pos:"noun"  subtype:"sound feminine plural"

SOUND MASCULINE PLURAL (جمع المذكر السالم):
  Nominative: ends ون   e.g. المسؤولون  موظفون
  Acc/gen:    ends ين   e.g. المدنيين  المسؤولين
  → pos:"noun"  subtype:"sound masculine plural"  notes:"accusative/genitive" OR "nominative"

DUAL (المثنى):
  Nominative: ends ان   e.g. البلدان  الطرفان
  Acc/gen:    ends ين   e.g. البلدين  الطرفين  الجارتين
  → pos:"noun"  subtype:"dual"  notes:"nominative" OR "accusative/genitive"

HOW TO DISTINGUISH DUAL-ين FROM PLURAL-ين:
  • Short base (2–3 root letters) + ين → usually DUAL   (e.g. بلد→البلدين, طرف→الطرفين)
  • Longer/derived base + ين → usually PLURAL (e.g. مدني→المدنيين, مسؤول→المسؤولين)
  • If the word has a recognisable dual nominative form (base+ان), the acc/gen is dual.

══════════════════════════════════════════════════════════════════
MEASURE RULES  (أوزان الأفعال والمصادر — Forms I–X)
══════════════════════════════════════════════════════════════════
MANDATORY: Every verb and every verbal noun (masdar) MUST include a "measure" field.
Do NOT omit measure. If you cannot determine it confidently, use "unidentified" (NOT null or empty).

MEASURE REFERENCE TABLE:
  Form I   (فعل)       → 3-letter base; فَعَلَ / فَعِلَ / فَعُلَ
  Form II  (فعّل)      → doubled middle consonant; تفعيل masdar
  Form III (فاعل)      → long vowel after first root letter; مفاعلة masdar
  Form IV  (أفعل)      → hamza prefix; إفعال masdar
  Form V   (تفعّل)     → ت + Form II stem; تفعّل reflexive of II
  Form VI  (تفاعل)     → ت + Form III stem; تفاعل reciprocal
  Form VII (انفعل)     → ان prefix; انفعال masdar
  Form VIII (افتعل)    → ا + root1 + ت + root2 + root3; افتعال masdar
  Form IX  (افعلّ)     → doubled last consonant; rare (colors/defects)
  Form X   (استفعل)    → است prefix; استفعال masdar

REQUIRED EXAMPLES:
  بدأ      → measure:"Form I"
  أثارت    → measure:"Form IV"   (أثار = Form IV of ثور)
  تصاعدت  → measure:"Form VI"   (تصاعد = Form VI تفاعل of صعد)
  إعلان    → measure:"Form IV"   (masdar of أعلن)
  تنديداً  → measure:"Form II"   (masdar of ندّد, Form II of ندد)
  توفير    → measure:"Form II"
  تنفيذ    → measure:"Form II"
  استخدام  → measure:"Form X"
  اتفاق    → measure:"Form VIII"
  انفجار   → measure:"Form VII"
  أعلن     → measure:"Form IV"
  تعاون    → measure:"Form VI"

══════════════════════════════════════════════════════════════════
ADVERB / HĀL RULES  (الحال والظرف)
══════════════════════════════════════════════════════════════════
Words ending in اً (accusative nunation / tanwīn al-naṣb) are ADVERBS or circumstantial (hāl), NOT verbs.
  دولياً  → pos:"adverb"  subtype:"حال"  gloss:"internationally"
  كثيراً  → pos:"adverb"  subtype:"حال"  gloss:"greatly / a lot"
  جديداً  → pos:"adverb"  subtype:"حال"  gloss:"newly / afresh"
  علنياً  → pos:"adverb"  subtype:"حال"  gloss:"publicly"
  رسمياً  → pos:"adverb"  subtype:"حال"  gloss:"officially"
  مؤقتاً  → pos:"adverb"  subtype:"حال"  gloss:"temporarily"
  فوراً   → pos:"adverb"  subtype:"حال"  gloss:"immediately"
  أخيراً  → pos:"adverb"  subtype:"حال"  gloss:"recently / finally"
  عاماً   → Note: could be عام (year) used adverbially — still pos:"adverb" or "noun of time" in context.
NEVER classify an اً-ending word as a verb.

══════════════════════════════════════════════════════════════════
TEMPORAL EXPRESSION RULES  (أسماء الزمان)
══════════════════════════════════════════════════════════════════
Temporal words are NOUNS (noun of time) or PARTICLES, NOT verbs:
  عندما  → pos:"particle"  subtype:"temporal subordinator"  gloss:"when"
  أثناء  → pos:"noun"  subtype:"adverb of time (ظرف زمان)"  gloss:"during"
  خلال   → pos:"noun"  subtype:"adverb of time (ظرف زمان)"  gloss:"during / within"
  أواخر  → pos:"noun"  subtype:"noun of time"  gloss:"end of / late period of"
  بداية  → pos:"noun"  morph:"feminine singular"  gloss:"beginning"
  نهاية  → pos:"noun"  morph:"feminine singular"  gloss:"end"
  مطلع   → pos:"noun"  subtype:"noun of time"  gloss:"beginning of"
  منذ    → pos:"preposition"  gloss:"since"
  حتى    → pos:"preposition / particle"  gloss:"until / even"
NEVER classify these as verbs.

══════════════════════════════════════════════════════════════════
PREPOSITION + NOUN COMPOUND RULES
══════════════════════════════════════════════════════════════════
When a token begins with ب/ل/ك (clitic preposition) followed by a noun or masdar stem, it is NEVER a verb.
  بشكل  → pos:"preposition+noun"  notes:"preposition بـ + noun شكل"  gloss:"in a way / in the form of"
  للإعلان → pos:"preposition+noun"  subtype:"verbal noun"  gloss:"for announcing"
  للنزاع  → pos:"preposition+noun"  gloss:"for the dispute"
  بتنفيذ  → pos:"preposition+noun"  subtype:"verbal noun"  morph:"Form II masdar"  gloss:"by implementing"
  بتوفير  → pos:"preposition+noun"  subtype:"verbal noun"  morph:"Form II masdar"  gloss:"by providing"
  لاستخدام → pos:"preposition+noun"  subtype:"verbal noun"  morph:"Form X masdar"  gloss:"for using"
Pattern: ب/ل/ك + (masdar or noun) → preposition + noun, not a verb.

══════════════════════════════════════════════════════════════════
ADJECTIVE PROTECTION RULES
══════════════════════════════════════════════════════════════════
The following common words are ALWAYS adjectives, NEVER verbs:
  كبير  صغير  مهم  جديد  قديم  بعيد  قريب  طويل  قصير  سريع  بطيء
  جميل  قبيح  نظيف  خطير  عميق  صحيح  واضح  صريح  غريب  عجيب
  عام   خاص   رسمي  شعبي  وطني  دولي  محلي  مدني  عسكري  سياسي
  اقتصادي  اجتماعي  امني  انساني  ديني  تاريخي  قانوني
Also: color adjectives (أبيض، أحمر، أخضر، أزرق، أسود، أصفر) are ALWAYS adjectives.
Elatives (أكبر، أصغر، أكثر، أقل، أفضل، أهم) are ALWAYS adjectives with comparative/superlative function.
CRITICAL: Do NOT classify any of these as verbs, even if they superficially resemble verb patterns.

══════════════════════════════════════════════════════════════════
VERB CLASSIFICATION POLICY — VERB IS THE LAST RESORT
══════════════════════════════════════════════════════════════════
CLASSIFICATION PRIORITY ORDER (high → low):
  1. Named entity (proper noun) — country, city, person name
  2. Particle / conjunction / preposition (including compound prep+noun)
  3. Adverb (حال / ظرف) — اً ending or known adverbial
  4. Noun + masdar — apply all masdar, noun of time, abstract noun patterns
  5. Adjective — nisba, CaCīC quality, elative, participle
  6. Dual / plural noun — ان/ون/ين endings
  7. VERB — only classify as verb when:
     a. The word matches a known verb morphological pattern AND
     b. It does NOT match any of the above categories, AND
     c. You have reasonable confidence from sentence context (subject agreement, tense markers, verb position)

COMMON FALSE-VERB TRAPS — words that look like verbs but are NOT:
  • إعلان, إرسال, إصدار, إلغاء → Form IV masdars (NOUNS), not Form IV past verbs (أعلن differs from إعلان)
  • تنفيذ, توفير, تطوير → Form II masdars (NOUNS), not Form II present verbs
  • دولياً, رسمياً, علنياً → adverbs (NEVER verbs)
  • عندما, خلال, أثناء → temporal particles/nouns (NEVER verbs)
  • كبير, جديد, مهم → adjectives (NEVER verbs)
  • مقرر, مقترح, منتظر → participles (adjective/noun, not main verbs)
  • أمام, خلف, فوق, بين → adverbs of place / ظرف (not verbs)

══════════════════════════════════════════════════════════════════
CONTEXTUAL POS RULES  (critical for derived forms)
══════════════════════════════════════════════════════════════════
For active participles, passive participles, and verbal nouns, set "pos" based
on how the word is actually USED IN THIS SENTENCE, not on its morphological origin.

ACTIVE PARTICIPLES (اسم الفاعل):
  - Functioning as an adjective (modifying a noun, predicate of a sentence)?
      → pos: "adjective", subtype: "active participle"
      Example: المتحالفة (the allied/confederate → adjective), متحد (united → adjective)
  - Functioning as a noun (subject, object, agent)?
      → pos: "noun", subtype: "active participle"
      Example: المتحالفون (the allies → noun, subject of the sentence)

PASSIVE PARTICIPLES (اسم المفعول):
  - Functioning as an adjective (describes or qualifies a noun)?
      → pos: "adjective", subtype: "passive participle"
      Example: مكتوب (written → adjective), مقدس (holy → adjective)
  - Functioning as a noun (object, referent)?
      → pos: "noun", subtype: "passive participle"
      Example: مقترح (proposal → noun), مكتوب (a written thing / a letter → noun)

VERBAL NOUNS (masdar):
  - Always pos: "noun" regardless of context; subtype: "verbal noun"
      Example: اتفاق → noun / subtype: verbal noun / Measure: VIII
               إطلاق → noun / subtype: verbal noun / Measure: IV

RULE: Never use "active participle" or "passive participle" as the value of "pos".
      These belong ONLY in the "subtype" field.
      The "pos" field must always be "noun" or "adjective" for these derived forms.

══════════════════════════════════════════════════════════════════
CLITIC AND SUFFIX PRONOUN RULES  (critical for Arabic)
══════════════════════════════════════════════════════════════════
Arabic prose frequently attaches short clitics to the following word without
a space. These MUST remain as ONE token — do not split them.

PREFIX CLITICS (written without space before the base word):
  Conjunction و  (and)        → pos: conjunction+verb / conjunction+noun / etc.
  Conjunction ف  (so, then)   → pos: conjunction+verb / conjunction+noun / etc.
  Preposition ب  (with, by)   → pos: preposition+noun
  Preposition ك  (like, as)   → pos: preposition+noun
  Preposition ل  (for, to)    → pos: preposition+noun / preposition+verb
  Preposition/prefix سـ (future marker, or preposition على etc.)
  Definite article ال         → part of the noun token (not a separate token)

  When a prefix clitic is present, use compound pos (e.g. "conjunction+verb").
  Describe the clitic briefly in notes (e.g. "prefixed conjunction وَ").

SUFFIX PRONOUNS (ضمائر متصلة — written without space after the base word):
  ني  (1st singular object)
  نا  (1st plural object/subject)
  ه   (3rd masc. singular)
  ها  (3rd fem. singular)
  هما (3rd dual)
  هم  (3rd masc. plural)
  هن  (3rd fem. plural)
  ك   (2nd masc. singular)
  كم  (2nd masc. plural)
  كن  (2nd fem. plural)
  ي   (1st singular possessive, after nouns)

  When a suffix pronoun is present:
    - Keep the whole word as ONE token (e.g. يسعدني, أخبره, كتابها)
    - Set "attachedPronoun" to describe it: e.g. "ني (1st singular object)"
    - The base word's pos/tense/measure/voice apply to the stem, not the pronoun

EXAMPLES of correct single-token treatment:
  وقال   → word:"وقال"  pos:"conjunction+verb"  tense:"past"  voice:"active"  measure:"I"  notes:"prefixed conjunction و"
  يسعدني → word:"يسعدني" pos:"verb"  tense:"present"  voice:"active"  verbType:"transitive"  measure:"I"  attachedPronoun:"ني (1st singular object)"
  بأثره  → word:"بأثره"  pos:"preposition+noun"  attachedPronoun:"ه (3rd masc. singular)"  notes:"preposition بـ + verbal noun أثر + pronoun"
  أعلن   → word:"أعلن"   pos:"verb"  tense:"past"  voice:"active"  verbType:"transitive"  measure:"IV"
  لمقترح → word:"لمقترح" pos:"preposition+noun"  subtype:"passive participle"  measure:"VIII"  notes:"preposition لـ"

══════════════════════════════════════════════════════════════════
DUAL RULES  (المثنى — exactly two referents)
══════════════════════════════════════════════════════════════════
Arabic has a special dual form for nouns, adjectives, and verbs referring to EXACTLY TWO entities.

DUAL NOUN SURFACE FORMS:
  Nominative (المرفوع)          → stem + ان  (البلدان, الطرفان, الجانبان, الجارتان)
  Accusative/Genitive (المنصوب/المجرور) → stem + ين  (البلدين, الطرفين, الجانبين, الجارتين)

IDENTIFICATION RULES:
  a. If a noun ends in ان and refers to exactly two entities → subtype:"dual", number:"dual"
  b. If a noun ends in ين and refers to exactly two entities → subtype:"dual", number:"dual"
  c. If a noun ends in ين and refers to a group (3+) → subtype:"masculine sound plural", number:"plural"

CRITICAL ERRORS TO AVOID:
  ✗ DO NOT label البلدان as "masculine sound plural" — masculine plural ends in ون/ين, NOT ان
  ✗ DO NOT label الطرفين as "broken plural" when the context clearly has two parties
  ✓ Use sentence context to determine if ين refers to exactly two (dual) or many (plural)

FEMININE DUAL:
  Singular nouns ending in ة form feminine duals: الجارة → الجارتان (nom.) / الجارتين (acc./gen.)
  For these: gender:"feminine", subtype:"dual"

EXAMPLES:
  اتفق البلدان على وقف إطلاق النار
    → البلدان: pos:"noun"  subtype:"dual"  number:"dual"  gender:"masculine"  gloss:"the two countries"
  وقّع الطرفان على الاتفاقية
    → الطرفان: pos:"noun"  subtype:"dual"  number:"dual"  gloss:"the two parties"
  بين البلدين
    → البلدين: pos:"noun"  subtype:"dual"  number:"dual"  gloss:"the two countries" [accusative/genitive case]
  المعلمين (in a context about many teachers)
    → المعلمين: pos:"noun"  subtype:"masculine sound plural"  number:"plural"  gloss:"the teachers"

══════════════════════════════════════════════════════════════════
FEMININE PAST VERB RULES  (الفعل الماضي المؤنث)
══════════════════════════════════════════════════════════════════
Arabic past-tense verbs mark 3rd-person feminine singular with a ت suffix attached directly
to the verb stem.  This ت is NOT a separate token — it is fused onto the verb.

SURFACE PATTERN:  verb-stem + ت
Examples:
  تصاعدت   → Form VI past, 3rd feminine singular (escalated / intensified)
  قالت      → Form I past, 3rd feminine singular (she said)
  ازدادت    → Form VIII past, 3rd feminine singular (it/she increased)
  شهدت      → Form I past, 3rd feminine singular (it/she witnessed)
  أعلنت     → Form IV past, 3rd feminine singular (she/it announced)

CLASSIFICATION:
  pos: "verb"
  tense: "past"
  gender: "feminine"
  number: "singular"
  voice: apply VOICE RULES as normal

CRITICAL: Do NOT confuse the past feminine ت suffix with:
  - ات (feminine sound plural suffix — these are NOUNS, not verbs)
  - standalone particle ت
  - verbal noun final ت (e.g. ثبات — this is a NOUN, past-tense verb check doesn't apply)

DISAMBIGUATION: A verb ending in ت is past feminine if:
  ✓ The token, when the final ت is removed, yields a recognizable verb stem
  ✓ Sentence context has a feminine subject (country, organization, group — often feminine in Arabic)
  ✓ The token does NOT end in ات (that is a plural noun suffix)

══════════════════════════════════════════════════════════════════
VERBAL NOUN vs VERB  (المصدر vs الفعل)
══════════════════════════════════════════════════════════════════
CRITICAL: مصادر (verbal nouns / masdars) are NOUNS, not verbs.
They often appear after prepositions (بـ / لـ / في) and must never be mislabelled as verbs.

COMMON MASDAR PATTERNS:
  Form II (تفعيل):  تنفيذ  تصعيد  توفير  تطوير  تحليل  تقديم  تنظيم  تدريب
  Form IV (إفعال):  إعلان  إرسال  إصدار  إلغاء  إقرار
  Form VIII (افتعال): اتفاق  انتشار  استخدام  اعتراض
  Form X (استفعال): استخدام  استقرار  استمرار  استئناف

PREPOSITION + MASDAR (critical pattern):
  بتوفير  → b-tawfīr → pos:"preposition+noun"  subtype:"verbal noun"  measure:"II"  gloss:"by providing"
  بتنفيذ  → pos:"preposition+noun"  subtype:"verbal noun"  measure:"II"  gloss:"by implementing"
  لإعلان  → pos:"preposition+noun"  subtype:"verbal noun"  measure:"IV"  gloss:"for announcing"

DISAMBIGUATION — VERB vs VERBAL NOUN for Form II/IV:
  توفير  → starts ت, ends ير, typical Form II masdar shape → NOUN (verbal noun)
  يوفّر  → starts ي, present prefix → VERB (present tense)
  وفّر   → past Form II verb → VERB (past tense)
  إعلان  → starts إ, ends ان, 5 chars → NOUN (verbal noun Form IV)
  أعلن   → starts أ, 4 chars, past Form IV pattern → VERB (past tense)

══════════════════════════════════════════════════════════════════
PROPER NOUN / NAMED ENTITY RULES
══════════════════════════════════════════════════════════════════
Country names, city names, and multi-word proper nouns must be correctly identified.

COUNTRY NAMES — always pos:"noun", subtype:"proper noun":
  باكستان  أفغانستان  إسرائيل  إيران  تركيا  أمريكا  روسيا
  سوريا  مصر  السودان  الصومال  الصين  الهند  اليمن  العراق  الأردن
  DO NOT classify these as "preposition+noun", "verb", or any other POS.
  Even if the word morphologically resembles a different form, these are PROPER NOUNS.

MULTI-WORD PROPER NOUNS — treat EACH word as its own token but label it as part of a named entity:
  إسلام آباد       → إسلام: proper noun (given name / city component);  آباد: proper noun (city component)
  الولايات المتحدة  → الولايات: proper noun component;  المتحدة: proper noun component
  المملكة العربية السعودية → each token: proper noun component
  DO NOT classify المتحدة as "passive participle used adjectivally" when it is part of the country name.
  DO NOT classify الولايات as "feminine sound plural" when it is part of the country name.

CITY NAMES — always pos:"noun", subtype:"proper noun":
  بغداد  دمشق  طهران  القاهرة  كابول  واشنطن  موسكو  الرياض  القدس
  Do NOT classify بغداد as a verb or broken plural.

══════════════════════════════════════════════════════════════════
ZARF RULES  (ظرف — adverbial nouns of time and place)
══════════════════════════════════════════════════════════════════
Arabic grammar distinguishes TRUE PREPOSITIONS (حروف الجر — particles) from
ADVERBIAL NOUNS (ظرف — nouns functioning as adverbs of time or place).
Mistaking one for the other is a common AI error.  Apply these rules strictly:

TRUE PREPOSITIONS (حروف الجر) — always pos: "preposition":
  في  من  إلى  على  عن  بـ  لـ  كـ
  These are particles. They have no nominal function.

ADVERBIAL NOUNS OF TIME (ظرف زمان) — pos: "noun", subtype: "adverb of time (ظرف زمان)":
  أثناء   during / in the course of
  خلال    during / throughout
  قبل     before
  بعد     after
  عند     at / at the time of
  حين     when / at the time
  These are nouns in the accusative (منصوب) used adverbially as time expressions.
  Set definiteness: "construct state" when followed by a genitive noun phrase.

ADVERBIAL NOUNS OF PLACE (ظرف مكان) — pos: "noun", subtype: "adverb of place (ظرف مكان)":
  بين     between / among
  فوق     above / over
  تحت     below / under
  داخل    inside / within
  خارج    outside / beyond
  أمام    in front of / before
  خلف     behind / after
  وراء    behind / beyond
  حول     around / about
  These are nouns in the accusative (منصوب) used adverbially as place expressions.
  Set definiteness: "construct state" when followed by a genitive noun phrase.

EXAMPLES:
  بين البلدين    → word:"بين"  pos:"noun"  subtype:"adverb of place (ظرف مكان)"  definiteness:"construct state"  gloss:"between"
  أثناء الأزمة  → word:"أثناء" pos:"noun"  subtype:"adverb of time (ظرف زمان)"   definiteness:"construct state"  gloss:"during"
  قبل الاجتماع  → word:"قبل"   pos:"noun"  subtype:"adverb of time (ظرف زمان)"   definiteness:"construct state"  gloss:"before"
  في المدينة    → word:"في"    pos:"preposition"  gloss:"in"   [TRUE PREPOSITION — particle]

══════════════════════════════════════════════════════════════════
GLOSS RULES — Translation line (teacher quick-reference)
══════════════════════════════════════════════════════════════════
gloss is REQUIRED for EVERY token without exception.
If you are uncertain, give a best-effort gloss — never omit it.

GLOSS MUST MATCH THE CONTEXTUAL POS:
  • pos = verb       → gloss is a VERB in base form or conjugated: "escalated", "prompts", "was announced"
  • pos = noun       → gloss is a NOUN or NOUN PHRASE: "actions", "condemnation", "the president"
  • pos = adjective  → gloss is an ADJECTIVE: "international", "civilian", "large"
  • pos = adverb     → gloss is an ADVERB or ADVERB PHRASE: "internationally", "quickly", "in this way"
  • pos = preposition / particle / conjunction → gloss is the function word: "in", "and", "because"

WRONG GLOSS (mismatched POS):
  دفع as Verb → gloss:"pushing"          ← WRONG (gerund, not verb)
  دفع as Verb → gloss:"prompted"         ← CORRECT
  تنديداً as Noun (masdar) → gloss:"condemning" ← WRONG (gloss must be noun)
  تنديداً as Noun (masdar) → gloss:"condemnation" ← CORRECT

LENGTH: 1–5 words maximum. Include article if it aids clarity ("the president", "armed forces").
SCRIPT: English letters ONLY. Never Arabic script in gloss values.

══════════════════════════════════════════════════════════════════
CONTEXTUAL DISAMBIGUATION: VERB vs. MASDAR
══════════════════════════════════════════════════════════════════
A surface form like دفع / أدى / أدت / قاد can be EITHER a verb (past tense) OR a masdar.
Use SENTENCE CONTEXT to choose:

PREFER VERB interpretation when the word:
  • Is the main predicate of a clause
  • Is immediately preceded by: ما | الذي | التي | مما | وهو ما | وهي ما | مما | حيث
    e.g.  ما دفع إسلام آباد  → دفع is VERB (past), gloss:"prompted"
    e.g.  وهو ما أدى إلى    → أدى is VERB (past), gloss:"led"
  • Follows a subject noun phrase (فاعل before verb in VSO or SVO)

PREFER MASDAR / NOUN interpretation when the word:
  • Is preceded by a preposition: من, في, إلى, على, بـ, لـ
  • Is in a noun phrase position (مضاف إليه, subject of كان, etc.)
  • Is followed by an article-less noun in construct (إضافة)
    e.g.  استمرار الأزمة     → استمرار is MASDAR (continuation of), not verb

══════════════════════════════════════════════════════════════════
GENERAL RULES
══════════════════════════════════════════════════════════════════
1. Copy the "word" value EXACTLY from the source text — do NOT normalize, strip diacritics, or change hamza/alef forms.
2. Do NOT split clitics — prefix and suffix clitics stay attached to the base word as ONE token.
3. For prefix clitic tokens, use compound pos: preposition+noun, conjunction+verb, etc.
4. pos and gloss are REQUIRED for every token. voice is REQUIRED for every verb.
5. Omit fields that genuinely do not apply. Do NOT set them to null or "".
6. All text fields (gloss, notes, attachedPronoun, subtype, etc.) must be in English only — no Arabic script in values.
7. Include every word in the original order. Omit punctuation-only tokens.
8. If genuinely uncertain about any field, include best-effort annotation and note uncertainty in the notes field.

Text to analyze (maximum 2500 characters):
"""
${text.slice(0, 2500)}
"""`;
}

export async function computeWordAnalysis(text, language) {
  if (!text || !text.trim()) {
    return { available: false, unavailableReason: "No text provided for Word Analysis." };
  }

  try {
    const completion = await client.chat.completions.create({
      model: WORD_ANALYSIS_MODEL,
      messages: [{ role: "user", content: buildPrompt(text.trim(), language) }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 5000,
    });

    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) throw new Error("Empty response from model");

    const parsed = JSON.parse(raw);
    const words = Array.isArray(parsed.words)
      ? parsed.words.filter(w => w && typeof w.word === "string" && w.word.trim())
      : [];

    return { available: true, words };
  } catch (err) {
    console.error("[word-analysis] failed:", err.message);
    return { available: false, unavailableReason: "Word analysis could not be completed." };
  }
}
