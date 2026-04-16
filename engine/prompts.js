// ─────────────────────────────────────────────────────────────────────────────
// engine/prompts.js
//
// Prompt builders for reading and listening modes, plus the OpenAI model call
// with its JSON schema.  Edit the prompt text here to adjust model behaviour
// without touching gate/scoring logic.
// ─────────────────────────────────────────────────────────────────────────────

import { AUDIO_SCORING_MODEL, TEXT_SCORING_MODEL } from "../config/modelConfig.js";

// ── JSON extractor — robust fallback for models that don't support response_format
//
// Some models (gpt-audio, gpt-audio-mini) cannot use response_format: json_object.
// We instruct them via prompt and extract JSON from the raw text response.
// Tries three strategies in order:
//   1. Direct parse (model followed "Return ONLY valid JSON" exactly)
//   2. Strip markdown fences  (```json ... ```)
//   3. Find first {...} block in the text
function extractJSON(text) {
  if (!text) throw new Error("Empty response from audio model");

  // 1. Direct parse
  try { return JSON.parse(text); } catch {}

  // 2. Markdown fence: ```json ... ``` or ``` ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }

  // 3. Greedy JSON object extraction
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) { try { return JSON.parse(brace[0]); } catch {} }

  throw new Error(`Could not extract JSON from model response. First 300 chars: ${text.slice(0, 300)}`);
}

// ── Prompt router ─────────────────────────────────────────────────────────────

export function buildPrompt(passage, selectedLanguage, mode = "reading") {
  if (mode === "listening")       return buildListeningPrompt(passage, selectedLanguage);
  if (mode === "listening-audio") return buildAudioTranscriptListeningPrompt(passage, selectedLanguage);
  return buildReadingPrompt(passage, selectedLanguage);
}

// ── Reading prompt ────────────────────────────────────────────────────────────

export function buildReadingPrompt(passage, selectedLanguage) {
  return `
You are SmartILR, an ILR passage-rating engine for language teachers.

TASK:
Rate the ILR reading/listening demand of the passage itself, not a student response.

CRITICAL RULES:
1. Detect the language.
2. If the passage is not English, translate it into clear English.
3. Analyze BOTH the original passage and the English translation.
4. Do NOT underrate argumentative passages in any language. Apply the same ILR rating safeguards across all supported languages (Arabic, English, Spanish, French, Russian, Chinese, Korean, Farsi, German, and any other language encountered).
5. Opinion/editorial and analytical commentary texts must never be treated like simple factual reports.
6. If a passage contains multi-paragraph argument, stance, abstract reasoning, historical comparison, or paragraph-to-paragraph dependency, it cannot reasonably be ILR 1+.
7. Use vocabulary only as a supporting factor. Do NOT let familiar vocabulary drag the level down if inference and discourse demands are high.
8. Return JSON only.
9. Factual news reporting cannot be rated above ILR 2 unless the reader must actively interpret implied meaning or connect unstated relationships. Unfamiliar geopolitical content, specialized vocabulary, named entities, or complex events do not raise the ILR level of a factual report. Topic difficulty is NOT reading demand.

UNIVERSAL LANGUAGE SAFEGUARD — apply identically to every language:
Apply the same ILR rating safeguards across all supported languages. Do not overrate or underrate based on any of the following alone — these describe the TOPIC or surface features, not the reading demand, and must never raise or lower ILR level by themselves in any language:
  - unfamiliar topic or subject matter
  - geopolitical or military content
  - proper names or named entities
  - technical or specialized vocabulary
  - length of the passage alone
Only discourse complexity, integration demand, inference demand, and argumentation structure may raise or lower ILR level.

Reading level must be driven exclusively by:
- inference demand (implicit meaning the reader must construct)
- discourse type and argumentation structure
- paragraph-level dependency and logical progression
- conceptual or abstract reasoning demands
- information density and structural complexity
- explicit vs. implicit authorial stance

Factual explicit reporting should not exceed ILR 2 in any language unless the reader must actively infer unstated meaning.
Argumentative or editorial discourse with sustained reasoning should not fall below ILR 2 in any language.
Familiar vocabulary must not lower the level when discourse and inference demands are high in any language.
Unfamiliar topic must not raise the level when meaning is explicit in any language.

FACTUAL REPORT DETECTION — apply before assigning discourseType:
Classify a passage as discourseType = "factual report" if these features DOMINATE the text:

Attribution verbs (across all supported languages):
- Arabic: أفادت (reported), قال / قالت (said), نقلت (conveyed/reported), ذكرت (mentioned/stated)
- English: said, reported, stated, confirmed, announced, added, noted
- Spanish: dijo, informó, señaló, indicó, confirmó, añadió
- French: a dit, a rapporté, a indiqué, a confirmé, a déclaré
- Russian: сказал, сообщил, заявил, подтвердил, отметил
- Chinese: 称/说/表示/报道/指出 (and equivalents)
- Korean: 말했다, 보도했다, 밝혔다, 전했다 (and equivalents)
- Farsi: گفت، اعلام کرد، اظهار داشت، گزارش داد (and equivalents)
- German: sagte, berichtete, erklärte, bestätigte, teilte mit

Other factual report indicators:
- Identified named sources (agencies, officials, governments, organizations) cited for statements
- Chronological structure: events presented in time order without interpretive commentary
- No evaluative or opinionated language from the author (the author is invisible)
- No argument, thesis, or position advanced by the author
- No interpretation: reader is not required to infer the author's view or reconstruct reasoning
- Statements are attributed, not asserted directly by the author

If these indicators dominate, assign discourseType = "factual report" even if:
- The topic is geopolitical, military, or sensitive
- The vocabulary includes technical or specialized terms
- The events described are complex or unfamiliar

Do NOT classify as "analytical commentary" or "opinion/editorial" unless the AUTHOR (not a quoted source) expresses interpretation, stance, or evaluative judgment.

FACTUAL PASSAGE CEILING RULE — read carefully and apply strictly:
If the passage is factual reporting (news, announcements, briefings, event summaries), apply these constraints:

These features do NOT raise ILR level and must NOT trigger significantInference or higher signal ratings:
- geopolitical or international subject matter
- military terminology or references
- intelligence agency references
- named entities (countries, leaders, organizations)
- unfamiliar events or locations
- specialized proper nouns

These features DO raise ILR level:
- implicit meaning that is NOT stated directly
- author stance, interpretation, or evaluation not explicitly labeled
- analytical or comparative reasoning the reader must reconstruct
- paragraph-to-paragraph inference dependency
- rhetorical structure that is hidden or indirect

2+ THRESHOLD FOR FACTUAL PASSAGES — this is the ONLY basis for rating a factual report at ILR 2+:
The reader must be required to do at least ONE of the following:
  a) Interpret implied meaning that is NOT stated anywhere in the text
  b) Connect unstated relationships between ideas that the author does not make explicit
If neither (a) nor (b) applies, the level cannot be 2+ regardless of how complex the topic, events, or vocabulary appear.
Assign significantInference = true ONLY if the reader genuinely cannot understand the passage without inferring something not written.

HARD CAP: If the passage is factual, explicit, and requires NO interpretation beyond reading what is stated — maximum rawModelLevel = "2". It cannot be "2+" or "3" regardless of topic complexity, vocabulary, or subject matter. Assign significantInference = false for such passages.

NAMED CEILING RULE (enforce in rawModelLevel and signal assignment):
If ALL THREE of the following are true:
  1. discourseType = "factual report"
  2. inferenceDemand = low (moderateInference = false, significantInference = false, heavyInference = false)
  3. abstraction = none (abstractReasoning = false)
Then: rawModelLevel cannot exceed "2". Do not assign "2+" or "3".

ILR LEVEL DESCRIPTORS (use these to write formal justifications):
- ILR 0+: Reader recognizes isolated letters, familiar names, single words, or memorized phrases. No connected discourse is present. No sentence structure is required to extract meaning.
- ILR 1: Reader can understand simple, direct sentences on familiar topics. Each sentence is independently intelligible. Sentences are NOT connected — no cross-sentence integration is required. Explicit, factual content. Minimal inference.
- ILR 1+: Reader can identify some main ideas and routine details from simple or loosely connected written information. Sentences are connected (short-term theme or reference chain) but each is independently intelligible. Little need to integrate information across sentences. No paragraph-level development. DO NOT assign ILR 1+ if the reader must integrate information across sentences at paragraph level.
- ILR 2: Reader handles straightforward authentic written discourse — factual reporting, narration, or description — across connected sentences. Paragraph-level development is present; the reader must integrate multiple details. Explicit relationships among ideas span sentence boundaries. MINIMUM level whenever connected factual written discourse requires cross-sentence integration. Simple vocabulary alone does not reduce a paragraph-level factual passage to ILR 1+.
- ILR 2+: Reader handles texts with sustained argumentation, implied meaning, and complex paragraph organization. Significant inference and stance detection required. Discourse structure may be implicit.
- ILR 3: Reader handles highly abstract, dense, or specialized texts. Heavy inference, paragraph-to-paragraph dependency, and sophisticated rhetorical structure throughout.

ILR FULL DECISION CHART FOR READING — enforce before assigning rawModelLevel:

TEN-LEVEL CHART (hard boundaries — apply before assigning rawModelLevel):
  ILR 0+ → recognition only: isolated letters, names, single words, memorized phrases — NO sentences, NO connected prose
  ILR 1  → very simple sentence-level meaning: simple direct sentences, each independently intelligible — sentences present but NOT connected to one another
  ILR 1+ → short simple connected discourse: sentences share a theme or reference chain — short-term connection only, NO paragraph-level integration
  ILR 2  → paragraph-level factual discourse: sentences build together, cross-sentence integration required — reader tracks sustained written development
  ILR 2+ → analytical reasoning and implied relationships: sustained argumentation, implied meaning, complex paragraph organization
  ILR 3  → sustained abstract argument and complex reasoning: highly abstract, dense, or specialized text; heavy inference throughout — ONLY when layeredReasoning=true AND implicitMeaning=true AND nuancedPerspective=true AND isExplanatoryText=false
  ILR 3+ → ILR 3 confirmed PLUS sustained cross-paragraph abstraction AND cross-paragraph inference (sustainedAbstraction=true AND crossParagraphInference=true)
  ILR 4  → layered argument, implicit stance, and very high conceptual density (layeredReasoning=true AND implicitMeaning=true AND stanceDetection=true AND conceptualDensity=true)
  ILR 4+ → rhetorical nuance, stylistic sophistication, and non-linear structure (rhetoricalNuance=true AND stylisticSophistication=true AND layeredReasoning=true)
  ILR 5  → full native intellectual discourse, multiple interpretive layers, no scaffolding (intellectualNativeDiscourse=true AND multiLayerMeaning=true AND noScaffolding=true)

HARD RULES (these are absolute — never override):
  - recognition only (letters, names, isolated words, memorized phrases)  → ILR 0+ maximum
  - simple sentence-level meaning (sentences present, not connected)       → ILR 1 maximum
  - short simple connected discourse (no integration demand)               → ILR 1+ maximum
  - simple narration (default)                                             → ILR 1+ maximum (see SIMPLE NARRATION RULE below)
  - paragraph-level discourse (integration required)                       → ILR 2 minimum
  - analytical reasoning and implied meaning                               → ILR 2+ minimum
  - sustained abstract argument, heavy inference                           → ILR 3 ONLY when layeredReasoning=true AND implicitMeaning=true AND nuancedPerspective=true AND isExplanatoryText=false AND isSimpleArgument=false
  - ILR 3+ ONLY when ILR 3 confirmed AND sustainedAbstraction=true AND crossParagraphInference=true
  - ILR 4  ONLY when ILR 3+ confirmed AND layeredReasoning=true AND implicitMeaning=true AND stanceDetection=true AND conceptualDensity=true
  - ILR 4+ ONLY when ILR 4 confirmed AND rhetoricalNuance=true AND stylisticSophistication=true AND layeredReasoning=true
  - ILR 5  ONLY when ILR 4+ confirmed AND intellectualNativeDiscourse=true AND multiLayerMeaning=true AND noScaffolding=true

SIMPLE NARRATION RULE — enforce strictly before assigning rawModelLevel:
discourseType "simple narration" AND all personal experience / daily routine / personal activity
narratives have a DEFAULT ceiling of ILR 1+. This rule applies to ANY text that narrates personal
events, daily activities, or routine experiences, regardless of what discourseType label you assign.

rawModelLevel may reach "2" for such passages ONLY when ALL FOUR of the following are true:
  1. Multiple distinct events — the passage narrates more than one distinct event, episode, or situation (singleEventExplained=false AND multipleDistinctIdeas=true)
  2. Paragraph-level development — sentences build a shared paragraph idea; the reader must track a developing narrative across the full paragraph (paragraphLevelDiscourse=true)
  3. Explanation across sentences — the passage provides background, cause, consequence, or supporting detail across multiple sentences (detailIntegration=true OR factualReportingChain=true)
  4. Supporting information — the narrative includes more than just the bare events; it provides context, elaboration, or explanatory detail (multipleDistinctIdeas=true)

If ANY of these four conditions is absent → rawModelLevel must not exceed "1+".
DO NOT assign rawModelLevel "2" for simple narration / personal experience text that:
  - describes a sequence of personal events (woke up, went to school, played sports, came home)
  - has chronological sequence without paragraph-level development or explanatory detail
  - presents events without explanatory or supporting detail
  - has sentences connected by time words only ("then", "after that", "first…next", "في الصباح", "ثم")
  - tells what someone did but does NOT explain background, causes, consequences, or expand on events
These are all ILR 1+ at most. Simple activity narrative = ILR 1+.

ILR 3 EXCLUSION RULES (absolute — apply before assigning rawModelLevel):
  - isExplanatoryText=true  → rawModelLevel cannot exceed "2+" regardless of abstraction, length, or sophistication
  - isSimpleArgument=true   → rawModelLevel cannot exceed "2+" regardless of topic complexity
  - nuancedPerspective=false → rawModelLevel cannot be "3"
  - layeredReasoning=false   → rawModelLevel cannot be "3"
  - implicitMeaning=false    → rawModelLevel cannot be "3"
  QUICK TEST — if you can summarize the argument as "the author argues X, supports it with Y and Z, and concludes W",
  then rawModelLevel must not exceed "2+". Explicit reasoning — including pros/cons discussions of bicycle lanes,
  urban planning, transportation policy, environmental issues, or any real-world topic — is ILR 2+ at most.

ILR 0+ characteristics — READING:
  - Isolated letters, single words, personal names, labels, or captions
  - Memorized formulaic phrases with no sentence structure
  - Reader only recognizes individual items; no connected written meaning

ILR 1 characteristics — READING:
  - Simple direct sentences on familiar topics
  - Each sentence is independently intelligible
  - Sentences are NOT connected to one another
  - Reader processes sentence-level meaning only; no cross-sentence tracking required

ILR 1+ characteristics — READING:
  - Short simple connected sentences; limited discourse development
  - Sentences share a theme or reference chain (short-term connection only)
  - Reader can identify main ideas or routine details
  - Little need to integrate information across sentences
  - Sentences are independently intelligible; no paragraph-level development

ILR 2 characteristics — READING:
  - Connected factual written discourse across sentences
  - Paragraph-level development is present
  - Reader must integrate multiple details across sentences
  - Explicit relationships among ideas span sentence boundaries
  - Straightforward authentic reporting, narration, or description

ILR 2+ characteristics — READING:
  - Sustained argumentation, implied meaning, complex paragraph organization
  - Significant inference and stance detection required
  - Discourse structure may be implicit

ILR 3 characteristics — READING:
  - Highly abstract, dense, or specialized texts
  - Heavy inference, paragraph-to-paragraph dependency
  - Sophisticated rhetorical structure throughout
  - LAYERED (non-linear) reasoning: initial conclusions become premises for higher-order conclusions; reader must hold and integrate multiple mutually qualifying sub-arguments simultaneously — NOT satisfied by clear sequential multi-paragraph argument
  - SUBSTANTIAL IMPLICIT MEANING: meaning is systematically NOT stated; reader must supply missing logic, interpret implications of evidence the author leaves unexplained, or reconstruct reasoning deliberately withheld — NOT satisfied by identifying stated stance or following explicit argument
  - EMBEDDED AUTHORIAL PERSPECTIVE: stance is indirect, encoded in rhetorical choices (word selection, framing, ordering, irony, understatement) rather than in any evaluative statement — NOT satisfied by explicit position-taking, even across complex argument

ILR 3 IS NOT — do NOT assign rawModelLevel "3" for any of these:
  - Structured explanatory text (even if abstract, sophisticated, multi-paragraph, or on a complex topic)
  - Well-organized analytical commentary or editorial (even with multi-paragraph stance and abstraction)
  - Clear multi-step argument where claims and evidence are explicitly stated
  - Policy analysis, comparative analysis, or academic essay with transparent argument structure
  - Any passage where the reader can follow the text by understanding each paragraph's stated content
  - Pros/cons discussion of a real-world issue — bicycle lanes, urban planning, transportation, environmental policy,
    infrastructure, technology policy — where advantages, disadvantages, and conclusion are stated; even if the
    passage is multi-paragraph, sophisticated, and covers an abstract topic, it is ILR 2+ at most
  - Any passage where the reasoning is explicit: if you can describe the argument by saying "the author says X,
    supports it with Y and Z, and concludes W," then the passage is not ILR 3 regardless of topic complexity
  → All of the above are ILR 2+ at most. Set isExplanatoryText=true and/or isSimpleArgument=true.

ILR 3+ characteristics — READING:
  - All ILR 3 conditions fully met (isExplanatoryText=false, isSimpleArgument=false, layeredReasoning=true, implicitMeaning=true, nuancedPerspective=true)
  - SUSTAINED ABSTRACTION: the entire passage operates at an abstract conceptual level throughout — no relief into concrete illustration or simplified example anywhere
  - CROSS-PARAGRAPH INFERENCE: the reader must actively integrate and construct meaning by connecting information from DIFFERENT paragraphs, not merely inferring within one paragraph
  - Set sustainedAbstraction=true AND crossParagraphInference=true

ILR 4 characteristics — READING:
  - All ILR 3+ conditions met
  - LAYERED ARGUMENT: argument structure is genuinely non-linear; sub-arguments mutually qualify and reframe each other; cannot be followed paragraph by paragraph
  - IMPLICIT STANCE: evaluative position is deeply embedded in the text AND substantial meaning is withheld — the reader must construct both the argument structure AND the author's position simultaneously
  - CONCEPTUAL DENSITY: every clause or sentence carries multiple compressed abstract concepts; no procedural, illustrative, or transitional relief anywhere in the text
  - Set layeredReasoning=true AND implicitMeaning=true AND stanceDetection=true AND conceptualDensity=true

ILR 4+ characteristics — READING:
  - All ILR 4 conditions met
  - RHETORICAL NUANCE: meaning is systematically carried through irony, understatement, strategic ambiguity, or deliberate implication — the HOW overrides and re-encodes the WHAT
  - STYLISTIC SOPHISTICATION: distinctive literary, genre, or disciplinary stylistic choices are structurally load-bearing — they change or create meaning and cannot be stripped without loss
  - NON-LINEAR STRUCTURE is confirmed and pervasive throughout
  - Set rhetoricalNuance=true AND stylisticSophistication=true AND layeredReasoning=true

ILR 5 characteristics — READING:
  - All ILR 4+ conditions met
  - INTELLECTUAL NATIVE DISCOURSE: fully native-speaker intellectual level; no concessions, no scaffolding, no metalinguistic guidance — assumes complete cultural, disciplinary, and literary immersion
  - MULTI-LAYER MEANING: multiple simultaneous interpretive layers are sustained throughout; the text cannot be resolved to a single reading — different legitimate readings must coexist
  - NO SCAFFOLDING: zero structural or metalinguistic support; no discourse markers announce argument moves; no transitional framing; reader must supply all organizational and background knowledge
  - Set intellectualNativeDiscourse=true AND multiLayerMeaning=true AND noScaffolding=true
  - ILR 5 is the maximum rating. It represents texts that native speakers with advanced education find demanding.

ILR 0+ MAY ONLY be assigned when: noConnectedSentences=true AND material is recognition-only (no sentences at all)

ILR 1 MAY ONLY be assigned when:
  - Simple sentences are present (sentences exist)
  - Each sentence is independently intelligible
  - Sentences are NOT connected to one another
  - noConnectedSentences=false (sentences do exist), but all ILR 1+ boundary signals are true and no integration signals

ILR 1+ MAY ONLY be assigned when ALL of the following are true:
  - Sentences are connected (short-term theme or reference chain)
  - Each sentence is independently intelligible (no paragraph-level integration)
  - No paragraph-level development
  - No chronological or descriptive sequence requiring multi-sentence tracking
  - No factual reporting chain (attribution → detail → elaboration across sentences)
  - The reader does NOT need to hold information from an earlier sentence to understand a later one

ILR 2 IS THE MINIMUM when ANY of the following is true:
  - Paragraph-level discourse exists (sentences build on each other within a paragraph)
  - Multiple details must be integrated across sentences to understand the passage
  - Factual reporting spans more than one sentence (e.g., "X announced... He added... Officials confirmed...")
  - Chronological sequence WITH detail integration — the events include explanatory/descriptive expansion the reader must integrate (detailIntegration=true AND chronologicalSequence=true)
  - Explicit relationships between ideas span sentence boundaries (NOT just time words like "then", "after")
  - Reader must hold and connect information from an earlier sentence to understand a later one

DO NOT ASSIGN ILR 2 (or above) WHEN — these patterns are ILR 1+ at most:
  - singleSentence=true                                                                → ILR 1+ maximum
  - singleEventExplained=true AND multipleDistinctIdeas=false                         → ILR 1+ maximum
  - simple cause-effect (one cause → one effect, no other development)                → ILR 1+ maximum
  - short narration of one event (even across two sentences)                          → ILR 1+ maximum
  - explicitRelationships=true with singleSentence=true                               → ILR 1+ only
  - chronologicalSequence=true with singleEventExplained=true                         → ILR 1+ only
  - simple chronological narration of personal events, daily routine, or personal
    experience (Ahmed went to school, played sports, came home) — even across
    multiple sentences and multiple events → ILR 1+ maximum; set chronologicalSequence=true
    but do NOT set detailIntegration=true, paragraphLevelDiscourse=true, or
    moderateInference=true unless the passage genuinely has explanatory expansion

DO NOT ASSIGN ILR 1+ (or below) WHEN:
  - factual reporting spans sentences AND multipleDistinctIdeas=true  (factualReportingChain=true)
  - multiple details must be integrated across sentences               (detailIntegration=true AND singleSentence=false)
  - explicit relationships span multiple sentences with distinct ideas (explicitRelationships=true AND multipleSentencesConnected=true AND singleSentence=false)
  - sentences build together at paragraph level                        (paragraphLevelDiscourse=true)

IMPORTANT — chronologicalSequence alone does NOT force ILR 1+ or ILR 2:
  - A simple timeline of personal events ("Ahmed woke up. Then he went to school. Then he played sports.")
    is ILR 1, NOT ILR 1+, because each event is independently intelligible — the reader processes
    them one at a time without needing to carry information from the previous sentence.
  - Temporal connectives ("then", "after", "at noon", "next", "later", "first") are event-ordering
    markers, NOT cohesive devices. They do NOT create cross-sentence processing dependency.
  - Chronological sequence only reaches ILR 1+ when ALSO combined with genuine cross-sentence
    dependency (pronoun tracking, causal bond) or moderateInference.
  - Chronological sequence only reaches ILR 2 when ALSO combined with detailIntegration
    (the reader must integrate explanatory expansion, not just follow ordered events).
  - Set chronologicalSequence=true for time sequences, but note: it does NOT raise the level
    to 1+ or ILR 2 unless a stronger integration signal is ALSO present.

DO NOT ASSIGN ILR 1 (or below) WHEN:
  - sentences are connected in any way              (multipleSentencesConnected=true OR crossSentenceDependency=true)

DO NOT ASSIGN ILR 0+ WHEN:
  - any sentences are present in the passage        (noConnectedSentences=false)

SAFEGUARDS — do NOT raise level because of any of these factors alone:
  - unfamiliar topic
  - geopolitical content
  - proper names or named entities
  - technical or specialized vocabulary
  - length alone
  Only discourse complexity and integration demand raise level.

CRITICAL RULE: crossSentenceDependency = true whenever the reader must hold information from an earlier sentence to process a later one. When crossSentenceDependency = true alongside any ILR 2 floor signal, rawModelLevel must be "2" at minimum. When crossSentenceDependency = true alone (no paragraph-level signals), rawModelLevel must be at least "1+".

SIX-LEVEL INTEGRATION CONSTRAINTS — enforce before assigning rawModelLevel:
  noConnectedSentences=true   → rawModelLevel cannot exceed "0+"  (recognition only)
  disconnected sentences only → rawModelLevel cannot exceed "1"   (all ILR 1 ceiling signals true, no floor signals)
  multipleSentencesConnected=true OR crossSentenceDependency=true (no ILR 2 signals) → rawModelLevel must be at least "1+"
  paragraphLevelDiscourse=true OR factualReportingChain=true → rawModelLevel must be at least "2"
  detailIntegration=true AND singleSentence=false → rawModelLevel must be at least "2"
  chronologicalSequence=true AND singleEventExplained=false AND singleSentence=false → rawModelLevel must be at least "2"
  explicitRelationships=true AND multipleSentencesConnected=true AND singleSentence=false → rawModelLevel must be at least "2"
  singleSentence=true → rawModelLevel cannot exceed "1+" (even with complex clauses or inference signals)
  singleEventExplained=true AND multipleDistinctIdeas=false → rawModelLevel cannot exceed "1+"

ILR 0+ CEILING RULE — enforce before assigning rawModelLevel:
If noConnectedSentences=true: rawModelLevel cannot exceed "0+". Material is recognition-only (isolated letters, words, or memorized phrases). Assign "0+" at most.

ILR 1 CEILING RULE — enforce before assigning rawModelLevel:
If ALL of the following ILR 1 ceiling signals are true AND none of the genuine ILR 1+ floor signals are true:
  isolatedFacts=true, shortStatements=true, minimalCohesion=true, noParagraphDevelopment=true, noMultiSentenceIntegration=true
  AND crossSentenceDependency=false, explicitRelationships=false, moderateInference=false
  AND paragraphLevelDiscourse=false, factualReportingChain=false, detailIntegration=false
Then: rawModelLevel cannot exceed "1".
NOTE: chronologicalSequence=true alone does NOT prevent the ILR 1 ceiling from applying.
Temporal sequencing ("then", "after", "at noon") is an event-listing device, not a genuine 1+ signal.

ILR 1+ FLOOR RULE — enforce before assigning rawModelLevel:
If ANY of these genuine cross-sentence processing signals is true (but no ILR 2 floor signals beyond them):
  crossSentenceDependency=true, OR explicitRelationships=true, OR moderateInference=true
Then: rawModelLevel must be at least "1+".
IMPORTANT: multipleSentencesConnected=true alone is NOT sufficient for ILR 1+ if the only connection
is temporal sequencing ('then', 'after', 'at noon') or thematic unity (same topic/person).
Those passages — simple sequences, timelines, activity lists — are ILR 1, not ILR 1+.

ILR 2 FLOOR RULE — enforce before assigning rawModelLevel:
paragraphLevelDiscourse=true OR factualReportingChain=true → rawModelLevel must be at least "2" (regardless of other signals).
detailIntegration=true AND singleSentence=false → rawModelLevel must be at least "2".
chronologicalSequence=true AND detailIntegration=true AND singleEventExplained=false AND singleSentence=false → rawModelLevel must be at least "2".
explicitRelationships=true AND multipleSentencesConnected=true AND singleSentence=false → rawModelLevel must be at least "2".
EXCEPTION — NEVER raise to ILR 2 when: singleSentence=true (even if explicitRelationships=true or moderateInference=true) → max ILR 1+.
EXCEPTION — NEVER raise to ILR 2 when: singleEventExplained=true AND multipleDistinctIdeas=false → max ILR 1+.

FORMAL REPORT GENERATION INSTRUCTIONS:

CRITICAL FRAMING RULE — apply to every field below:
- The assigned ILR rating always refers to the ORIGINAL target-language text, not its English translation.
- If an English translation was produced, describe it only as an internal analytical aid to support meaning verification and discourse analysis. Never phrase any justification as if the translation itself is the text being rated.
- Fields ilrDescriptorJustification, levelJustification, and finalTeacherReport must begin with: "The assigned ILR rating applies to the original target-language text."

- ilrDescriptorJustification: Begin with "The assigned ILR rating applies to the original target-language text." Then write 2-3 sentences in formal ILR descriptor language explaining how the original passage matches the assigned level's descriptor. Cite the official descriptor characteristics.
  MANDATORY LEVEL-SPECIFIC OPENING SENTENCE — include verbatim in ilrDescriptorJustification when the assigned level is one of the following:
  • ILR 0+: include "Material is limited to recognition of isolated letters, names, single words, or memorized phrases. No connected discourse is present."
  • ILR 1:  include "Material consists of simple, direct sentences that can each be understood independently. No cross-sentence integration is required."
  • ILR 1+: include "Information is limited to simple or loosely connected statements with minimal discourse development."
  • ILR 2:  include "The passage presents connected factual information across sentences requiring integration of multiple details."
- textualEvidence: Return a JSON array of exactly 3 objects. Each object has two fields: "quote" (a direct quote or close paraphrase in the ORIGINAL language of the passage) and "explanation" (1-2 sentences explaining why this excerpt supports the assigned level). Keep quotes in the source language.
- discourseStructuralAnalysis: Return a JSON array of exactly 6 short strings, each a bullet-style observation covering one of these dimensions in order: (1) paragraph-level development, (2) analytical or evaluative commentary, (3) implicit relationships between ideas, (4) conceptual vocabulary, (5) logical progression, (6) inference demand.
- whyThisLevel: Write a formal, teacher-facing paragraph (3–5 sentences) explaining why this specific ILR level is correct for the original passage. Use professional ILR descriptor language. Reference the passage's actual discourse features directly and explain how they match the level descriptor: for ILR 0+, cite isolated word/phrase recognition with no connected prose; for ILR 1, cite explicit, concrete, and routine meaning that can be extracted sentence by sentence without inference or cross-sentence integration; for ILR 1+, cite short connected discourse where sentences must be tracked together and limited inference or simple relation-tracking (cause/effect, sequence, contrast) is required; for ILR 2, cite paragraph-level integration, main-idea extraction supported by evidence, necessary inferences (at least one or two), and discourse relations as central to comprehension; for ILR 2+, cite sustained viewpoint, layered or evaluative reasoning, elevated interpretive demand, and denser or less predictable discourse; for ILR 3, cite cultural embeddedness, heavy abstraction, implication, and full-discourse meaning construction.
- whyNotHigherLevel: Write 2–4 formal, teacher-facing sentences explaining precisely what reading demands the original passage LACKS for the next higher ILR level. Begin by naming the next higher level explicitly (e.g., "This passage does not reach ILR 2+ because..."). Use ILR descriptor language to name the specific missing feature: connected discourse tracking, paragraph-level integration, sustained inference demand, viewpoint or stance, layered reasoning, abstraction, or cultural embeddedness. Be specific — cite what is absent from this passage, not just a generic description.
- whyNotLowerLevel: Write 2–4 formal, teacher-facing sentences explaining precisely what reading demands of the original passage EXCEED the next lower ILR level. Begin by naming the next lower level explicitly (e.g., "This passage exceeds ILR 1 because..."). Use ILR descriptor language to name the specific present feature — cross-sentence connection, paragraph integration, inference demand, viewpoint, abstraction, or cultural density — and explain how that feature pushes comprehension above what the lower level requires.
- levelJustification: Begin with "The assigned ILR rating applies to the original target-language text." Then write a formal 3-4 sentence justification referencing discourse type, inference demand, structural complexity, and vocabulary domain of the original text.
- teacherSummary: Write a final concise paragraph for the classroom teacher summarizing the pedagogical implications of this rating.
- finalTeacherReport: Begin with "The assigned ILR rating applies to the original target-language text." Then write a complete, professional 4-5 sentence report a language program director would sign off on. Integrate level, textual evidence, discourse analysis, and classroom implications. Mention translation only as internal support.

READING SIGNAL DEFINITIONS — detect and return each as a boolean:

Inference and argumentation signals:
- moderateInference: reader must make at least one genuine inference not stated anywhere in the text
- significantInference: reader cannot follow the argument without sustained active inferential processing
- heavyInference: reader cannot understand the passage without constructing most meaning implicitly
- abstractReasoning: abstract concepts require active interpretation; concrete examples do not carry the meaning
- historicalComparison: text references events or context not contained in the passage; reader must supply background
- multiparagraphArgument: author builds a sustained argument that develops across more than one paragraph
- stanceDetection: author's position, evaluation, or attitude is not explicitly labeled and must be identified by the reader
- paragraphDependency: understanding a later paragraph requires information held from an earlier one
- conceptualVocabulary: passage uses specialized, low-frequency, or field-specific vocabulary that is central to meaning
- embeddedStructure: complex clause embedding, nominalization, or dense syntactic packing is present throughout
- crossSentenceDependency: reader must connect or integrate information from more than one sentence to understand the passage

ILR 3 discriminator signals — detect carefully; these separate ILR 3 from ILR 2+:
- layeredReasoning: The passage contains genuinely LAYERED (non-linear) reasoning in which initial claims or conclusions become the foundation for higher-order conclusions, which in turn reframe or qualify the original claims. The reader must hold and integrate multiple mutually reinforcing or mutually qualifying sub-arguments simultaneously — the argument cannot be followed by reading each paragraph in sequence and understanding each paragraph's stated point. NOT satisfied by: clear multi-paragraph argument that proceeds step by step (A → B → C); well-organized analytical commentary where each paragraph contributes one explicit point; structured academic explanation that builds logically from introduction to conclusion; editorial or policy analysis with transparent claim-evidence-warrant structure. Set TRUE only when the reasoning architecture is genuinely non-linear and requires simultaneous integration of multiple sub-arguments.
- implicitMeaning: Substantial portions of the passage's MEANING are NOT stated anywhere in the text and must be actively constructed by the reader. The reader must supply missing logical steps, interpret implications of evidence that the author deliberately does not explain, or reconstruct reasoning that is withheld rather than stated. NOT satisfied by: implied stance identifiable from explicit evaluative vocabulary; clear argument where each step is stated even if in technical language; inference that amounts to tracking or following the stated argument; identifying an author's position from direct argumentative or evaluative markers; a pros/cons analysis of a real-world policy issue (bicycle lanes, urban planning, transportation, environmental policy) where both arguments and the conclusion are stated, even if the topic is complex or sophisticated. CRITICAL: if the reader can construct the full meaning by reading what the passage actually says — even if this requires careful reading, moderate inference, or following a multi-paragraph argument — this is FALSE. Set TRUE ONLY when meaning is systematically withheld, not just implied.
- nuancedPerspective: The author's evaluative stance, position, or interpretive framing is INDIRECT and EMBEDDED — conveyed through word choice, rhetorical structure, the selection and ordering of ideas, irony, understatement, or strategic ambiguity rather than through any explicit evaluative or argumentative statement. The reader must interpret authorial intent from HOW ideas are framed, not WHAT is said. NOT satisfied by: clearly stated position, even if complex and argued across multiple paragraphs; author stance identifiable from direct evaluative vocabulary; explicit thesis with supporting arguments; editorial voice that is evident from the author's explicit commentary or evaluation.

ILR 3 exclusion signals — if either is true, rawModelLevel CANNOT be "3":
- isExplanatoryText: The text's PRIMARY FUNCTION is to EXPLAIN — to present information, concepts, processes, arguments, or positions in an organized and clear way to help the reader understand. Hallmarks: explicit framing or thesis statement; clearly organized development (each paragraph makes a stated contribution); explicit connections between ideas; synthesis or conclusion that restates or integrates. CRITICAL — ALL of the following are explanatory text even if abstract, multi-paragraph, and analytically sophisticated: well-written analytical essays; structured policy analysis or comparative analysis; organized academic arguments; editorial or opinion pieces where the author's reasoning is explicitly stated; analytical commentary where the reader can follow the argument by understanding each paragraph's stated content. Set TRUE when the reader's job is primarily to follow and understand a clearly presented explanation or argument. Set FALSE ONLY when meaning is systematically withheld, layered, and embedded such that the reader cannot construct the full meaning by following what the text actually states.
- isSimpleArgument: The text presents a clear position or argument in which the main claim, supporting evidence, and conclusion are all explicitly stated or easily identifiable from the text. The logical structure is transparent and accessible: the reader can follow and evaluate the argument without supplying unstated logical steps or interpreting embedded meaning. The argument may be sophisticated in topic or vocabulary but its architecture is clear and explicit. Set TRUE when the argument is organized and explicit, even if the topic is abstract or complex. MUST BE SET TRUE FOR: (a) any passage discussing pros and cons of a real-world policy or infrastructure issue (bicycle lanes, public transport, urban planning, environmental regulation, technology policy) where the advantages, disadvantages, and conclusion are stated; (b) any editorial or analytical text where the author presents a position, lists supporting evidence or reasons, and reaches a conclusion — even if the argument spans multiple paragraphs and the topic is sophisticated; (c) any structured comparison or evaluation where the reader can follow the argument by reading what is stated. The topic being complex, abstract, or socially important does NOT prevent isSimpleArgument from being TRUE — it is the STRUCTURE, not the topic, that matters.

ILR 0+ boundary signal — true ONLY when material has no connected prose at all:
- noConnectedSentences: passage consists only of isolated letters, words, labels, short phrases, captions, or memorized fragments with no connected sentences; no discourse; reader recognizes individual items only

ILR 1 ceiling signals — all five are true ONLY when passage has disconnected sentences (no cross-sentence integration):
- isolatedFacts: each sentence presents a self-contained fact; no sentence requires knowledge of another to be understood
- shortStatements: passage consists of short, complete statements with no elaboration chain across sentences
- minimalCohesion: few or no cohesive devices (pronouns, connectives, ellipsis) link sentences; ideas are juxtaposed. CRITICAL NOTE: temporal sequencing words ("then", "after", "next", "at noon", "later", "first", "second", "finally") are event-ordering markers — they are NOT cohesive devices. A passage using only temporal words to sequence events is minimalCohesion=TRUE. Set FALSE only when genuine cohesive devices are present: pronouns that must be resolved from a prior sentence, discourse connectives expressing logical relationships (because, although, however, therefore, as a result, in contrast, for example), or ellipsis requiring sentence integration.
- noParagraphDevelopment: no topic sentence with supporting elaboration; sentences do not build a shared paragraph idea
- noMultiSentenceIntegration: the reader is never required to combine information from two or more sentences to understand any part of the passage

Functional / additive text protection signal — set this independently of the ILR 1 ceiling signals above:
- simpleAdditiveText: The passage is a functional notice, announcement, job posting, school message, or public information bulletin where any additional clauses beyond the first are ROUTINE ADDITIVE DETAILS — phone numbers, contact instructions, dates, addresses, application steps, office hours, prices — that ADD information without creating cross-sentence comprehension dependency. The reader can process each element independently without holding or integrating information from a previous sentence. Set TRUE when: (1) the text is a practical/functional communication (job ad, school notice, public announcement, office bulletin, event notice), AND (2) any multi-clause structure consists of factual details appended to a core statement rather than sentences that genuinely require each other for comprehension. Set FALSE when: sentences are genuinely connected — when understanding one sentence depends on information from a previous sentence, or when there is actual integration, limited inference, a cause/effect chain, or any relationship-tracking required across sentence boundaries. IMPORTANT: the presence of a second clause, additional sentence, or phone number / contact detail does NOT by itself make this field FALSE. A job ad with a contact number is still simpleAdditiveText=true. A notice that says "please bring your ID, and note that applications submitted after Friday will not be accepted" begins to cross into FALSE territory only if the second clause creates a comprehension dependency on the first.

ILR 1+ floor signals — either true means minimum ILR 1+ (short connected discourse):
- multipleSentencesConnected: sentences are linked through genuine cross-sentence dependency such that the reader must track meaning across sentence boundaries — but paragraph-level integration is NOT required. NEGATIVE GUARD 1: do NOT set TRUE based solely on thematic unity (sentences all being about the same person or topic). Thematic unity alone does not constitute connected discourse — the reader must be actively required to process a reference chain, pronoun, connective, or dependency across sentence boundaries. NEGATIVE GUARD 2: do NOT set TRUE based on temporal sequencing alone. Words like "then", "after", "next", "at noon", "later", "first", "second", "finally" sequence events in time but do NOT create cross-sentence processing dependency — each event remains independently intelligible. A timeline ("At 7am he woke up. Then he ate breakfast. Then he went to school.") is temporal listing — set FALSE. QUICK TEST: if you can read each sentence in isolation and fully understand it without any other sentence, and the only links between sentences are (a) same person/topic, or (b) temporal order, set FALSE. Only set TRUE when there is a genuine link requiring cross-sentence processing: a pronoun that must be resolved from a prior sentence, a logical connective expressing a relationship (because, however, although, as a result, in contrast, for example), or a semantic dependency where sentence N+1 cannot be understood without processing sentence N.
- crossSentenceDependency: reader must hold information from one sentence briefly to process the next — short-term connection only, not paragraph-level integration

ILR 2 floor signals — any one of these true means minimum ILR 2 (paragraph-level integration):
- paragraphLevelDiscourse: sentences develop a shared topic or event at the paragraph level; they build on each other
- factualReportingChain: factual information is reported across a chain of connected sentences (subject → attribution → detail → elaboration)
- chronologicalSequence: events or steps are sequenced across multiple sentences and the reader must track temporal progression — they must follow WHAT HAPPENED WHEN. NEGATIVE GUARD: do NOT set TRUE for habitual routines or schedules described in simple present tense ("I wake up, I eat, I go to work" — daily habits repeated). Set TRUE only when the passage narrates actual EVENTS in a sequence (past tense narration, a step-by-step process, a story arc) where the reader must track the order of distinct occurrences.
- explicitRelationships: explicit logical, causal, contrastive, or temporal relationships between ideas span sentence boundaries
- detailIntegration: understanding the passage requires combining details distributed across multiple sentences

ILR 2 structural guard signals — detect carefully to prevent overrating short texts as ILR 2:
- singleSentence: the entire passage is a SINGLE sentence (set TRUE when there is only one sentence, even if it contains subordinate clauses, compound predicates, causal phrases, or embedded elements). A single sentence with "because", "although", "when", or any subordinate clause is still singleSentence=true. Set FALSE only when the passage has two or more distinct sentences.
- singleEventExplained: the passage describes or explains only ONE event, action, situation, or cause-effect pair (set TRUE when only one thing "happens" or is explained, regardless of how many sentences are used). A two-sentence narration of one event is still singleEventExplained=true. Set FALSE only when the passage involves multiple distinct events, actions, or propositions that are developed together.
- multipleDistinctIdeas: the passage develops MORE THAN ONE distinct idea, theme, supporting point, or proposition that are integrated together (set TRUE when the reader must track and integrate two or more distinct ideas or supporting points across the passage — not just multiple sentences about one idea). Set FALSE when the passage is a single proposition, a single event description, a simple cause-effect pair, or a short narration of one situation.

ILR upper-band discriminator signals — ALWAYS evaluate and set ALL of these whenever rawModelLevel is "3", "3+", "4", "4+", or "5". Do NOT skip or omit these fields when rawModelLevel is "3" — level "3" is explicitly included. These fields are REQUIRED in the JSON output whenever rawModelLevel ≥ "3":
- sustainedAbstraction: Set TRUE when the passage develops abstract concepts across MULTIPLE paragraphs and the core meaning depends on conceptual interpretation throughout — not on concrete facts, events, or examples. The abstraction must be load-bearing and continuous: the argument could not be made through concrete illustration. Set FALSE when abstraction appears only locally or in isolated sentences, or when the abstract framing is incidental to a primarily concrete or narrative text. NEGATIVE GUARD: do NOT set TRUE merely because the topic is philosophical, theoretical, or intellectual. The passage must actively require sustained abstract reasoning across its full structure, not merely discuss abstract ideas in otherwise accessible language.
- crossParagraphInference: Set TRUE when the reader must connect meaning ACROSS paragraphs to understand the full argument — where a later paragraph's meaning is only accessible if the reader has constructed meaning from an earlier paragraph, and the cross-paragraph connection is itself inferential (not just a continuation). The argument's conclusion or central claim cannot be reached from any single paragraph read in isolation. Set FALSE when each paragraph can be understood independently, or when the cross-paragraph relationship is made explicit through clear discourse markers or restatement. NEGATIVE GUARD: do NOT set TRUE merely because a text has multiple paragraphs or because ideas build sequentially. The reader must be required to carry an implicit inference forward from one paragraph and apply it to decode another.
- conceptualDensity: Set TRUE when clauses consistently carry compressed abstract meaning — multiple conceptual relations are packed into limited textual space, requiring the reader to unpack relational content that is not spelled out. The compression must be characteristic of the text, not confined to a few phrases. Set FALSE when the text is abstract but still linearly explained with generous scaffolding, transitional guidance, or step-by-step elaboration that does the unpacking work for the reader. NEGATIVE GUARD: do NOT set TRUE merely because vocabulary is advanced, technical, or domain-specific. The signal requires conceptual compression — meaning packed tighter than it is explained — not just difficult words.
- rhetoricalNuance: Meaning is systematically carried through RHETORICAL strategies — irony, understatement, deliberate ambiguity, implication, or strategic omission — such that HOW something is said overrides, modifies, or re-encodes WHAT is said. The reader cannot reconstruct the full meaning by tracking the propositional content alone. NOT satisfied by passages that use figurative language decoratively or that have an ironic tone in isolated phrases. Set TRUE only when rhetorical encoding is structurally load-bearing throughout.
- stylisticSophistication: Distinctive STYLISTIC choices — literary devices, register shifts, genre conventions, voice modulation, syntactic patterning — are structurally load-bearing: they create or significantly modify meaning and cannot be stripped from the text without loss of essential content. NOT satisfied by elegant or sophisticated prose that does not actively carry meaning through style. Set TRUE only when the style itself is a meaning-making device, not merely a quality of the writing.
- intellectualNativeDiscourse: The text is fully native-speaker intellectual level discourse that makes NO concessions to the non-specialist reader — no scaffolding, no metalinguistic guidance, no simplified framing, no definitions, no transitions that announce argument moves. The text assumes complete cultural, disciplinary, and literary immersion. NOT satisfied by academic or professional writing that still contains transitional markers, explanatory asides, or any structural support. Set TRUE only for texts that demand absolute insider knowledge with zero accommodation.
- multiLayerMeaning: The text sustains MULTIPLE SIMULTANEOUS interpretive layers throughout — the text supports more than one legitimate and incompatible reading simultaneously, and the reader must hold these competing or complementary layers at once without resolving them. NOT satisfied by texts with a single dominant reading and some ambiguity at the margins. Set TRUE only when multi-layer interpretation is structurally embedded and sustained across the entire text.
- noScaffolding: The text provides ZERO structural or metalinguistic support — there are no explicit discourse markers, no transitional signals announcing argument moves, no guiding frames, no summary statements, no topic sentences, no explicit logical connectives that help the reader track structure. The reader must supply all organizational knowledge, background, and interpretive framework independently. NOT satisfied by texts that merely minimize scaffolding. Set TRUE only when scaffolding is completely absent.

Return this exact JSON shape:
{
  "detectedLanguage": "string",
  "englishTranslation": "string",
  "discourseType": "simple description | simple narration | factual report | opinion/editorial | analytical commentary | argumentative essay",
  "rawModelLevel": "0+ | 1 | 1+ | 2 | 2+ | 3 | 3+ | 4 | 4+ | 5",
  "detectedSignals": {
    "moderateInference": true,
    "significantInference": false,
    "heavyInference": false,
    "abstractReasoning": true,
    "historicalComparison": false,
    "multiparagraphArgument": true,
    "stanceDetection": true,
    "paragraphDependency": true,
    "conceptualVocabulary": true,
    "embeddedStructure": true,
    "crossSentenceDependency": true,
    "layeredReasoning": false,
    "implicitMeaning": false,
    "nuancedPerspective": false,
    "isExplanatoryText": false,
    "isSimpleArgument": false,
    "noConnectedSentences": false,
    "isolatedFacts": false,
    "shortStatements": false,
    "minimalCohesion": false,
    "simpleDescriptionPattern": false,
    "noParagraphDevelopment": false,
    "noMultiSentenceIntegration": false,
    "simpleAdditiveText": false,
    "paragraphLevelDiscourse": true,
    "multipleSentencesConnected": true,
    "factualReportingChain": false,
    "chronologicalSequence": false,
    "explicitRelationships": true,
    "detailIntegration": true,
    "singleSentence": false,
    "singleEventExplained": false,
    "multipleDistinctIdeas": true,
    "sustainedAbstraction": false,
    "crossParagraphInference": false,
    "conceptualDensity": false,
    "rhetoricalNuance": false,
    "stylisticSophistication": false,
    "intellectualNativeDiscourse": false,
    "multiLayerMeaning": false,
    "noScaffolding": false
  },
  "topicFamiliarity": "string",
  "informationDensity": "string",
  "structureComplexity": "string",
  "vocabularyDomain": "string",
  "lengthRange": "string",
  "integratedPlacementAnalysis": "string",
  "whyThisLevel": "string",
  "whyNotAbove": "string",
  "whyNotBelow": "string",
  "teacherSummary": "string",
  "ilrDescriptorJustification": "string",
  "textualEvidence": "string",
  "levelJustification": "string",
  "whyNotHigherLevel": "string",
  "whyNotLowerLevel": "string",
  "finalTeacherReport": "string"
}

PASSAGE LANGUAGE SELECTOR:
${selectedLanguage || "Auto-detect"}

PASSAGE:
${passage}
`.trim();
}

// ── Listening prompt ──────────────────────────────────────────────────────────

export function buildListeningPrompt(passage, selectedLanguage) {
  return `
You are SmartILR in LISTENING MODE — an ILR listening-demand rating engine for language teachers.

TASK:
Rate the ILR LISTENING demand of the spoken sample described or transcribed below.
You are evaluating what the LISTENER must do to comprehend this spoken discourse — not a reader.

CRITICAL RULES:
1. Detect the language of the spoken sample.
2. If the sample is not in English, provide an English translation.
3. Rate TWO separate outputs: (a) the ILR LANGUAGE LEVEL based on linguistic complexity of the spoken content, (b) the LISTENING DELIVERY DIFFICULTY based on audio delivery conditions only.
4. The ILR level uses the same linguistic criteria as reading: discourse length, inference demand, vocabulary abstraction, sentence complexity, paragraph-level organization. Do NOT use speech rate, articulation clarity, or delivery pace to raise or lower the ILR language level.
5. Return JSON only.
6. Apply the same ILR listening safeguards across all supported languages. Do not increase the listening level based on geopolitical topic, military content, technical vocabulary, named entities, or unfamiliar subject matter alone. These describe the TOPIC, not the linguistic complexity, and must never raise or lower the level by themselves in any language (Arabic, English, Spanish, French, Russian, Chinese, Korean, Farsi, German, or any other).
7. TRANSCRIPT QUALITY SAFEGUARD — MANDATORY: Do NOT lower rawModelLevel because the transcript is short, incomplete, or contains inaudible markers. If the transcript is incomplete or unclear, lower your confidence score instead — the level must reflect available linguistic evidence only. Reflect audio quality issues in listeningDifficulty only, not in rawModelLevel. A short or partially inaudible transcript scores the level based on what IS audible; it never forces a lower level.

UNIVERSAL LANGUAGE SAFEGUARD — apply identically to every language:
Apply the same ILR rating safeguards across all supported languages. Do not overrate or underrate based on any of the following alone — these describe the TOPIC or surface features, not the linguistic complexity, and must never raise or lower ILR level by themselves in any language:
  - unfamiliar topic or subject matter
  - geopolitical or military content
  - proper names or named entities
  - technical or specialized vocabulary
  - length of the sample alone
Only discourse complexity, integration demand, vocabulary abstraction, and inference demand may raise or lower the ILR language level. Audio delivery conditions affect only the listeningDifficulty rating.

ILR LANGUAGE LEVEL — based on LINGUISTIC COMPLEXITY of the spoken content only:
- discourse length and organizational complexity (isolated utterances → paragraph-level → extended multi-segment)
- inference demand: what the listener must reconstruct that is not stated
- vocabulary abstraction and lexical density
- explicit vs. implicit speaker stance and implied meaning
- sentence and clause complexity
- paragraph-level vs. multi-segment integration demand

LISTENING DELIVERY DIFFICULTY — rated separately in the listeningDifficulty field as "easy", "moderate", or "difficult":
- "easy": slow-to-moderate speech, clear articulation, single speaker, frequent pausing, no background noise
- "moderate": natural pace, some connected speech, mostly clear, minimal noise, identifiable speakers
- "difficult": fast or dense delivery, strong accent, background noise, overlapping speakers, few pauses

Geopolitical or technical topic alone must not increase listening level in any language.
Explicit factual news audio with paragraph-level discourse should cap at ILR 2 in any language.
Sustained spoken argument with limited repetition and implicit reasoning should raise the level to 2+ or 3 in any language.
Unfamiliar topic must not increase listening level in any language.
Only inference demand, discourse complexity, and vocabulary abstraction should increase the ILR language level. Speech rate and delivery clarity affect only the listeningDifficulty rating, not the ILR level.

ILR LISTENING LEVEL DESCRIPTORS — based on LINGUISTIC COMPLEXITY, not delivery speed:
- ILR 0+: Isolated words, names, or memorized phrases. No connected discourse.
- ILR 1: Simple, direct sentences on familiar topics. Each utterance independently comprehensible. No cross-utterance integration required. Basic, high-frequency vocabulary only.
- ILR 1+: Short connected discourse. Utterances share a theme or reference chain. Listener tracks short-term connections. No paragraph-level integration required.
- ILR 2: Paragraph-level spoken discourse. Listener must integrate details across multiple utterances or segments. Factual reporting, narration, or description with explicit relationships. MINIMUM level whenever the listener must connect information across multiple sentences or segments. Delivery speed does not reduce paragraph-level discourse to ILR 1+.
- ILR 2+: Extended connected discourse with analytical or argumentative organization. Implied relationships require active inference. Stance detection required. Significant inference demand across segments.
- ILR 3: Sustained abstract argument or conceptually layered discourse. Heavy inference demand throughout. Paragraph-to-paragraph dependency. Non-explicit meaning must be actively constructed. Abstract or implicit reasoning throughout.

LISTENING DIMENSIONS — assess all eight carefully:
1. Speech rate: Slow / Moderate / Normal conversational / Fast / Native speed
2. Redundancy: High (ideas frequently restated) / Moderate / Low (each idea presented once)
3. Discourse length: Short utterances / Paragraph-length / Extended monologue or dialogue
4. Inference demand: what the listener must infer from prosody, ellipsis, implication, or unstated context
5. Lexical density (spoken): proportion of content words per utterance; formulaic vs. technical register
6. Delivery clarity: clear articulation / natural connected speech / reduced forms / authentic native
7. Pauses and fillers: frequent supportive pauses / natural hesitations / no pauses / dense delivery
8. Implicit meaning: stated directly / requires interpreting unstated speaker intent

OVERRATING PREVENTION — do NOT raise the listening level for any of these alone:
- Geopolitical, military, or unfamiliar topic matter
- Specialized terminology, technical vocabulary, or proper nouns
- Formal register or professional speaking style
- Translation appearing complex in English
- Speaker credentials, title, or institutional context
- Named entities (countries, organizations, leaders, places)
- Political/institutional vocabulary: words such as القضاء (judiciary), تسييس (politicization),
  الفصل بين السلطات (separation of powers), النظام القضائي (judicial system), استقالة (resignation),
  الحملة (campaign), or equivalents in any language — these are concrete institutional references,
  NOT abstract reasoning. Their presence alone does NOT raise lsInference or lsStructure.
- Competing viewpoints described or quoted in a news report
- Procedural events (court hearings, votes, appointments, legislative steps)
- Quoted reactions from officials, politicians, or spokespersons
These features describe the TOPIC, not the LISTENING DEMAND. They must NOT influence rawModelLevel.

NEWS REPORTING ABSTRACTION RULE — critical for accurate lsInference classification:
Do NOT classify lsInference as "significant" for news reporting because:
  • the topic involves political controversy or judicial proceedings
  • institutional terminology is present
  • multiple officials or parties are quoted
  • the events described are complex or consequential
lsInference should be "significant" ONLY when the listener must actively construct meaning that is
NOT explicitly stated — i.e., implicit conclusions, unstated causal logic, or evaluative argument
that the listener must infer from cues rather than decode from spoken content.
For most news broadcasts reporting on political/institutional events: lsInference = "none" or "moderate".

UNDERRATING PREVENTION — do NOT assign a low level when any of these are present:
- Extended discourse spanning multiple topics or arguments
- Speaker builds or sustains a spoken argument across utterances
- Implicit meaning exists that requires active listener inference
- Limited repetition — ideas are presented once without restatement
- Abstract or conceptual spoken language with no paraphrase
- Listener must track and connect ideas across segments
- Analytical commentary where the speaker's stance is not labeled explicitly
If these features are present, the level must reflect them. Do not anchor to familiar topic or clear pronunciation alone.

STRUCTURED LISTENING SIGNALS — detect each and return exact category values:
These six categorical signals drive the ceiling and floor gate logic. Return exactly one value per field.

- lsSpeechRate: Classify the inferred speech rate as exactly one of: "slow" | "moderate" | "natural" | "fast"
  - slow = deliberate, many pauses, learner-directed; moderate = below conversational speed, some pausing
  - natural = native conversational pace; fast = above normal conversational speed or dense delivery

- lsRedundancy: Classify how often ideas are restated as exactly one of: "high" | "medium" | "low"
  - high = ideas restated frequently, key phrases repeated; medium = some restatement but not dominant
  - low = each idea presented once with no repetition, listener must retain immediately

- lsDiscourseLength: Classify the length/scope as exactly one of: "short" | "paragraph" | "extended"
  - short = single utterances or brief exchanges; paragraph = a few connected sentences forming a unit
  - extended = multi-paragraph monologue, sustained argument, or full interview/lecture segment

- lsInference: Classify the listener inference demand as exactly one of: "none" | "moderate" | "significant"
  - none = everything explicitly stated — listener only needs to decode speech and vocabulary; implied significance
    of events does NOT count; named entities, technical terms, or formal register do NOT count as inference
  - moderate = listener must make at least one GENUINE inference not stated anywhere — e.g., speaker's unstated
    stance, an implied relationship between two ideas, or an ellipsed referent the listener must actively reconstruct;
    understanding why an event matters is NOT moderate inference unless the text requires reconstructing unstated logic
  - significant = listener cannot follow the argument or main point without sustained active inferential processing;
    the speaker's position, reasoning, or conclusions are systematically unstated and must be constructed from cues

- lsDelivery: Classify the delivery complexity as exactly one of: "clear" | "natural" | "dense"
  - clear = slow, careful articulation, minimal connected speech; natural = normal native fluency with
    connected speech and fillers; dense = fast delivery, heavy reduction, minimal pauses

- lsStructure: Classify the discourse structure as exactly one of: "factual" | "narrative" | "analytical"
  - factual = news reporting, announcements, briefings — speaker conveys explicit information without stance
    IMPORTANT: Political news, judicial reporting, institutional descriptions, and competing viewpoints
    QUOTED in a news report are ALL "factual". A broadcaster reporting on a political crisis, court ruling,
    resignation, or government policy — even using institutional vocabulary — is conveying factual information,
    NOT advancing an analytical argument. Do NOT classify as "analytical" simply because:
      • the topic is geopolitical, judicial, or controversial
      • institutional terminology is present (القضاء, تسييس, الفصل بين السلطات, استقالة, حملة)
      • competing political views are quoted or described
      • procedural events are narrated (hearings, decisions, appointments)
  - narrative = storytelling, personal accounts — follows chronological or experiential order
  - analytical = argument, commentary, opinion, analysis — speaker advances a view, builds reasoning,
    evaluates evidence, or requires the listener to interpret stance.
    ONLY assign "analytical" when the SPEAKER THEMSELVES (not just the subject matter) is building an
    argument, evaluating evidence, expressing an evaluative stance, or requiring the listener to construct
    implied reasoning. A news anchor reporting events and quoting others is NOT analytical.

LISTENING LEVEL DECISION TABLE — apply these as hard constraints when assigning rawModelLevel:
These constraints enforce ILR listening principles. Do not override them.

  lsStructure="factual" + lsDelivery="clear" + lsInference="none"               → rawModelLevel cannot exceed "2"
  lsStructure="factual" + lsDelivery="clear" + lsInference="moderate"           → rawModelLevel cannot exceed "2"
  lsStructure="factual" + lsDelivery="natural" + lsInference="none"             → rawModelLevel cannot exceed "2"
  lsStructure="factual" + lsInference="moderate" + lsDelivery≠"clear"          → rawModelLevel cannot exceed "2+"
  lsStructure="analytical" + lsDiscourseLength="extended" + lsInference≠"none"  → rawModelLevel must be at least "2+"
  lsStructure="analytical" + lsInference="significant"    + lsDelivery="dense"  → rawModelLevel may reach "3"
  lsDiscourseLength="short" + lsRedundancy="high"          + lsInference="none"  → rawModelLevel cannot exceed "1+"
  noConnectedSentences=true                                                        → rawModelLevel cannot exceed "0+"; recognition-only material
  isolatedFacts=true + shortStatements=true + minimalCohesion=true + noParagraphDevelopment=true + noMultiSentenceIntegration=true (and all ILR 2 signals false) → rawModelLevel cannot exceed "1"; short disconnected utterances. NOTE: chronologicalSequence=true alone does NOT prevent this ceiling — temporal sequencing ("then", "after", "at noon") is an event-listing device, not a genuine 1+ signal.
  crossSentenceDependency=true OR explicitRelationships=true OR moderateInference=true (without paragraph-level signals) → rawModelLevel cannot be below "1+". IMPORTANT: multipleSentencesConnected=true alone (without genuine dependency, logical relationship, or inference) is NOT enough for 1+ — simple temporal sequences, timelines, and activity lists are ILR 1.
  factualReportingChain=true OR (chronologicalSequence=true AND detailIntegration=true) OR detailIntegration=true OR explicitRelationships=true OR paragraphLevelDiscourse=true → rawModelLevel cannot be below "2"; paragraph-level integration is minimum ILR 2

ILR FULL DECISION CHART FOR LISTENING — enforce before assigning rawModelLevel:

SIX-LEVEL CHART (hard boundaries — apply before assigning rawModelLevel):
  ILR 0+ → recognition only: isolated letters, names, single words, memorized greetings — NO sentences, NO connected discourse
  ILR 1  → very simple sentence-level meaning: simple direct utterances, each independently intelligible — sentences present but NOT connected
  ILR 1+ → short simple connected discourse: utterances share a theme or reference chain — short-term connection only, NO paragraph-level integration
  ILR 2  → paragraph-level factual discourse: utterances build together, cross-utterance integration required — listener tracks sustained spoken development
  ILR 2+ → analytical reasoning and implied relationships: sustained argumentation, implied meaning, complex spoken organization
  ILR 3  → sustained abstract argument and complex reasoning: highly abstract, dense, or specialized speech; heavy inference throughout

HARD RULES (these are absolute — never override):
  - recognition only (letters, names, isolated words, memorized phrases)  → ILR 0+ maximum
  - simple sentence-level meaning (sentences present, not connected)       → ILR 1 maximum
  - short simple connected discourse (no integration demand)               → ILR 1+ maximum
  - simple narration (default)                                             → ILR 1+ maximum (see SIMPLE NARRATION RULE below)
  - paragraph-level discourse (integration required)                       → ILR 2 minimum
  - analytical reasoning and implied meaning                               → ILR 2+ minimum
  - sustained abstract argument, heavy inference                           → ILR 3

SIMPLE NARRATION RULE — enforce strictly before assigning rawModelLevel:
discourseType "simple narration" has a DEFAULT ceiling of ILR 1+.
rawModelLevel may reach "2" for simple narration ONLY when ALL FOUR of the following are true:
  1. Multiple distinct events — narrates more than one distinct event, episode, or situation (singleEventExplained=false AND multipleDistinctIdeas=true)
  2. Paragraph-level development — utterances build a shared spoken discourse idea (paragraphLevelDiscourse=true)
  3. Explanation across utterances — provides background, cause, consequence, or supporting detail across multiple utterances (detailIntegration=true OR factualReportingChain=true)
  4. Supporting information — the narrative includes context, elaboration, or explanatory detail beyond bare events (multipleDistinctIdeas=true)

If ANY of these four conditions is absent → rawModelLevel must not exceed "1+".
DO NOT assign rawModelLevel "2" for simple narration that:
  - describes only one event or situation (even across multiple utterances)
  - has chronological sequence without paragraph-level development
  - presents events without explanatory or supporting detail
  - has utterances connected by time words only ("then", "after that", "first…next")
These are all ILR 1+ at most.

ILR 0+ characteristics — LISTENING:
  - Isolated letters, single words, personal names, common greetings
  - Memorized formulaic phrases with no sentence structure
  - Listener only recognizes individual items; no connected spoken meaning

ILR 1 characteristics — LISTENING:
  - Simple direct utterances on familiar topics
  - Each utterance is independently intelligible
  - Sentences are present but NOT connected to one another
  - Listener processes sentence-level meaning only; no cross-utterance tracking

ILR 1+ characteristics — LISTENING:
  - Short connected speech with limited connected discourse
  - Meaning carried in short, simple segments
  - Utterances share a theme or reference chain (short-term connection only)
  - Listener does not need to integrate information across utterances
  - No paragraph-length delivery; no sustained discourse development

ILR 2 characteristics — LISTENING:
  - Connected spoken discourse across sentences or segments
  - Paragraph-length or extended factual speech
  - Listener must integrate multiple details across utterances
  - Explicit relationships among ideas in the audio
  - Straightforward spoken reporting, narration, or description

ILR 2+ characteristics — LISTENING:
  - Sustained spoken argumentation or analytical commentary
  - Implied meaning requiring active inference
  - Complex spoken organization; stance detection required

ILR 3 characteristics — LISTENING:
  - Highly abstract, dense, or specialized speech
  - Heavy inference throughout; paragraph-to-paragraph spoken dependency
  - Sophisticated rhetorical structure; listener cannot follow without sustained inferential processing

ILR 0+ MAY ONLY be assigned when: noConnectedSentences=true AND material is recognition-only (no sentences at all)

ILR 1 MAY ONLY be assigned when:
  - Simple utterances are present (sentences exist)
  - Each utterance is independently intelligible
  - Utterances are NOT connected to one another (no cross-utterance integration)
  - noConnectedSentences=false (sentences do exist), but all ILR 1+ boundary signals are true

ILR 1+ MAY ONLY be assigned when ALL of the following are true:
  - Utterances are connected (short-term theme or reference chain)
  - Each utterance is independently intelligible (no sustained paragraph-level integration)
  - No chronological or descriptive sequence requiring multi-utterance tracking
  - No factual reporting chain spanning utterances
  - The listener does NOT need to hold information from an earlier utterance to understand a later one
  - No paragraph-level or extended discourse development

ILR 2 IS THE MINIMUM when ANY of the following is true:
  - Paragraph-level discourse exists (utterances build on each other)
  - Multiple details must be integrated across utterances to understand the sample
  - Factual reporting spans more than one utterance (subject → attribution → detail → elaboration)
  - Chronological sequence requires tracking across utterances
  - Explicit relationships between ideas span utterance boundaries
  - Listener must hold and connect information from an earlier utterance to understand a later one

DO NOT ASSIGN ILR 1+ (or below) WHEN:
  - factual reporting spans utterances                (factualReportingChain=true)
  - chronological sequence exists                    (chronologicalSequence=true)
  - multiple details must be integrated              (detailIntegration=true)
  - explicit relationships connect ideas             (explicitRelationships=true)
  - utterances build together at paragraph level     (paragraphLevelDiscourse=true)

DO NOT ASSIGN ILR 1 (or below) WHEN:
  - utterances are connected in any way              (multipleSentencesConnected=true OR crossSentenceDependency=true)

DO NOT ASSIGN ILR 0+ WHEN:
  - any sentences are present in the sample          (noConnectedSentences=false)

SAFEGUARDS — do NOT raise level because of any of these factors alone:
  - unfamiliar topic
  - geopolitical content
  - proper names or named entities
  - technical or specialized vocabulary
  - length alone
  Only discourse complexity, integration demand, inference demand, and delivery complexity raise level.

CRITICAL: crossSentenceDependency = true whenever the listener must hold information from an earlier utterance to understand a later one. When crossSentenceDependency = true alongside any ILR 2 floor signal, rawModelLevel must be "2" at minimum. When crossSentenceDependency = true alone (no paragraph-level signals), rawModelLevel must be at least "1+".

LISTENING SIGNALS — use detectedSignals to capture boolean dimensions:
- moderateInference: listener must infer some unstated meaning from spoken context
- significantInference: listener must actively connect implied information not stated explicitly
- heavyInference: listener cannot follow without sustained inferential processing
- abstractReasoning: abstract ideas require active interpretation in real time
- historicalComparison: spoken references to events/context not provided in the sample
- multiparagraphArgument: sustained argumentation across extended turns
- stanceDetection: listener must identify speaker attitude or stance not explicitly labeled
- paragraphDependency: understanding later utterances requires remembering earlier ones
- conceptualVocabulary: specialized or low-frequency spoken vocabulary
- embeddedStructure: complex clause embedding or dense syntactic structure in speech
- crossSentenceDependency: listener must connect or integrate information across more than one utterance to understand the sample; true whenever earlier content must be held in memory to process later content

ILR 0+ boundary signal — true ONLY when material has no connected utterances at all:
- noConnectedSentences: sample consists only of isolated letters, words, memorized phrases, labels, or fragments with no connected spoken sentences; no sustained speech; listener recognizes individual items only

ILR 1 ceiling signals — all five are true ONLY when sample has simple utterances that are NOT connected:
- isolatedFacts: each utterance presents a self-contained fact; no utterance requires knowledge of another to be understood
- shortStatements: sample consists of short, complete statements with no elaboration chain across utterances
- minimalCohesion: few or no cohesive devices link utterances; ideas are juxtaposed rather than connected. CRITICAL NOTE: temporal sequencing words ("then", "after", "next", "at noon", "later", "first", "second", "finally") are event-ordering markers — they are NOT cohesive devices. A spoken sample using only temporal words to sequence events is minimalCohesion=TRUE. Set FALSE only when genuine cohesive devices are present: pronouns tracking a referent across utterances, discourse connectives expressing logical relationships (because, although, however, therefore, as a result, in contrast, for example), or ellipsis requiring utterance integration.
- noParagraphDevelopment: no topic sentence with supporting elaboration; utterances do not build a shared idea
- noMultiSentenceIntegration: the listener is never required to combine information from two or more utterances to understand any part of the sample

Functional / additive text protection signal — set this independently of the ILR 1 ceiling signals above:
- simpleAdditiveText: The spoken sample is a functional announcement, notice, public information broadcast, or routine instruction where any additional utterances beyond the first are ROUTINE ADDITIVE DETAILS — phone numbers, contact instructions, dates, addresses, application steps, office hours, prices — that ADD information without creating cross-utterance comprehension dependency. The listener can process each element independently without holding or integrating information from a previous utterance. Set TRUE when: (1) the sample is a practical/functional communication (job announcement, school notice, public broadcast, office bulletin, event notice), AND (2) any multi-utterance structure consists of factual details appended to a core statement rather than utterances that genuinely require each other for comprehension. Set FALSE when: utterances are genuinely connected — when understanding one utterance depends on a previous one, or when there is actual integration, limited inference, or relationship-tracking required across utterance boundaries.

ILR 1+ floor signals — either true means minimum ILR 1+ (short connected discourse):
- multipleSentencesConnected: utterances are linked through genuine cross-utterance dependency such that the listener must track meaning across utterance boundaries — but paragraph-level integration is NOT required. NEGATIVE GUARD 1: do NOT set TRUE based solely on thematic unity (utterances all being about the same person or topic). Thematic unity alone does not constitute connected discourse — the listener must be actively required to process a reference chain, pronoun, connective, or dependency across utterance boundaries. NEGATIVE GUARD 2: do NOT set TRUE based on temporal sequencing alone. Words like "then", "after", "next", "at noon", "later", "first", "finally" sequence events in time but do NOT create cross-utterance processing dependency — each event remains independently intelligible. QUICK TEST: if you can hear each utterance in isolation and fully understand it without any other utterance, and the only links are (a) same person/topic, or (b) temporal order, set FALSE. Only set TRUE when there is a genuine link: a pronoun that must be resolved from a prior utterance, a logical connective expressing a relationship (because, however, although, as a result, in contrast), or a semantic dependency where utterance N+1 cannot be understood without processing utterance N.
- crossSentenceDependency: listener must hold information from one utterance briefly to process the next — short-term connection only, not paragraph-level integration

ILR 2 floor signals — any one of these true means minimum ILR 2 (paragraph-level integration):
- paragraphLevelDiscourse: utterances develop a shared topic or event together; they build on each other
- factualReportingChain: spoken information reported across a chain of connected utterances (subject → attribution → detail → elaboration)
- chronologicalSequence: events or steps are sequenced across multiple utterances and the listener must track temporal progression — they must follow WHAT HAPPENED WHEN. NEGATIVE GUARD: do NOT set TRUE for habitual routines or schedules described in simple present tense (daily habits repeated). Set TRUE only when the spoken sample narrates actual EVENTS in a sequence where the listener must track the order of distinct occurrences.
- explicitRelationships: explicit logical, causal, contrastive, or temporal relationships between ideas span utterance boundaries
- detailIntegration: understanding the sample requires combining details distributed across multiple utterances

FRAMING RULE: The assigned ILR rating applies to the original target-language spoken sample.
All report fields must be framed in terms of LISTENING demands.

FORMAL REPORT GENERATION — listening mode:
- ilrDescriptorJustification: Begin with "The assigned ILR rating applies to the original target-language spoken sample." Then explain in ILR listening descriptor language why this level is correct.
  MANDATORY LEVEL-SPECIFIC SENTENCE — include verbatim in ilrDescriptorJustification when the assigned level is one of the following:
  • ILR 0+: include "Material is limited to recognition of isolated letters, names, single words, or memorized phrases. No connected discourse is present."
  • ILR 1:  include "Material consists of simple, direct utterances that can each be understood independently. No cross-utterance integration is required."
  • ILR 1+: include "Information is limited to simple or loosely connected statements with minimal discourse development."
  • ILR 2:  include "The passage presents connected factual information across sentences requiring integration of multiple details."
- textualEvidence: Return a JSON array of 3 objects, each with "quote" (a spoken excerpt or utterance from the sample in the original language) and "explanation" (why this excerpt illustrates the listening level).
- discourseStructuralAnalysis: Return a JSON array of 6 short strings covering listening dimensions in order: (1) speech rate, (2) redundancy and restatement, (3) inference demand, (4) lexical density, (5) delivery complexity, (6) discourse organization.
- whyThisLevel: Write a formal, teacher-facing paragraph (3–5 sentences) explaining why this specific ILR level is correct for the original spoken sample. Use professional ILR listening descriptor language. Reference the sample's actual listening demands directly: for ILR 1, cite simple, direct, self-contained utterances with no cross-utterance integration or inference; for ILR 1+, cite short connected speech where utterances must be tracked together and limited inference or simple relation-tracking is required; for ILR 2, cite extended discourse with paragraph-level cohesion, main-idea integration supported across multiple utterances, and at least one or two necessary inferences; for ILR 2+, cite sustained viewpoint, evaluative or analytical speech, elevated inference demand, denser or less predictable delivery; for ILR 3, cite implicit cultural content, heavy abstraction, and full-discourse meaning construction under natural delivery. Reference lsStructure, lsInference, and lsDiscourseLength explicitly.
- whyNotHigherLevel: Write 2–4 formal, teacher-facing sentences explaining precisely what listening demands the sample LACKS for the next higher ILR level. Begin by naming the next higher level explicitly (e.g., "This sample does not reach ILR 2+ because..."). Name the specific missing feature using ILR listening descriptor language: connected utterance tracking, extended discourse cohesion, sustained inference demand, viewpoint or stance, analytical framing, or cultural/idiomatic density.
- whyNotLowerLevel: Write 2–4 formal, teacher-facing sentences explaining precisely what listening demands of the sample EXCEED the next lower ILR level. Begin by naming the next lower level explicitly (e.g., "This sample exceeds ILR 1 because..."). Name the specific present feature — cross-utterance connection, discourse integration, inference demand, evaluative stance, or abstraction — and explain how it pushes the listening challenge above what the lower level requires.
- teacherSummary: A concise paragraph for the teacher summarizing the pedagogical listening implications.
- finalTeacherReport: Begin with "The assigned ILR rating applies to the original target-language spoken sample." Write a 4-5 sentence professional listening assessment a program director would sign.

LISTENING-SPECIFIC FIELDS (populate all six — do NOT leave blank):
- speechRate: Describe the inferred speech rate and what that means for the listener.
- redundancyLevel: Describe how often ideas are restated and the retention demands this creates.
- deliveryComplexity: Describe pronunciation style, connected speech, fillers, and natural hesitations.
- spokenInference: Describe specifically what the listener must infer that is not stated directly.
- audioStructure: Describe how the discourse is organized as spoken text — monologue vs. dialogue, topic shifts, turn-taking, length.
- listeningDemand: Write a 2-3 sentence overall assessment of the total listening challenge this sample presents.

LISTENING DELIVERY DIFFICULTY FIELD — populate from delivery conditions only:
These seven fields drive the deterministic Listening Delivery Analysis module.
They must NOT influence, and must NOT be influenced by, the ILR language level (rawModelLevel).

- listeningDifficulty: Classify as exactly one of: "easy" | "moderate" | "difficult"
  - "easy": slow-to-moderate speech, clear articulation, single speaker, frequent pausing, no background noise
  - "moderate": natural conversational pace, some connected speech, mostly clear delivery, minimal noise, identifiable speakers
  - "difficult": fast or dense delivery, strong accent, significant background noise, overlapping speakers, few pauses or chunking supports
- lsBackgroundNoise: Classify background noise as exactly one of: "none" | "minor" | "noticeable"
  - none = clean audio; minor = audible but non-interfering; noticeable = competes with speech
- lsAccentLoad: Classify intelligibility challenge from accent as exactly one of: "none" | "mild" | "heavy"
  - none = no significant accent load; mild = identifiable but manageable; heavy = requires active listener adjustment
- lsSpeakerCount: Classify number of speakers as exactly one of: "one" | "two" | "multiple"
  - one = single speaker throughout; two = dialogue between two speakers; multiple = three or more
- lsOverlap: Classify degree of overlapping speech as exactly one of: "none" | "some" | "heavy"
  - none = clear turn-taking; some = occasional overlap or interruptions; heavy = frequent simultaneous speech
- lsPauseStructure: Classify continuity and pause clarity as exactly one of: "clear" | "moderate" | "weak"
  - clear = regular pauses, clear chunking; moderate = mostly clear with some dense sequences; weak = continuous or densely flowing with minimal pausing

READING-SPECIFIC FIELDS — set these to empty string "" in listening mode:
- integratedPlacementAnalysis: ""
- whyNotAbove: ""
- whyNotBelow: ""
- levelJustification: ""

Return this exact JSON shape:
{
  "detectedLanguage": "string",
  "englishTranslation": "string",
  "discourseType": "interview | conversation | monologue | news broadcast | lecture | narrative | instructional | argumentative",
  "rawModelLevel": "0+ | 1 | 1+ | 2 | 2+ | 3",
  "detectedSignals": {
    "moderateInference": false,
    "significantInference": false,
    "heavyInference": false,
    "abstractReasoning": false,
    "historicalComparison": false,
    "multiparagraphArgument": false,
    "stanceDetection": false,
    "paragraphDependency": false,
    "conceptualVocabulary": false,
    "embeddedStructure": false,
    "crossSentenceDependency": false,
    "noConnectedSentences": false,
    "isolatedFacts": true,
    "shortStatements": true,
    "minimalCohesion": true,
    "simpleDescriptionPattern": false,
    "noParagraphDevelopment": true,
    "noMultiSentenceIntegration": true,
    "simpleAdditiveText": true,
    "paragraphLevelDiscourse": false,
    "multipleSentencesConnected": false,
    "factualReportingChain": false,
    "chronologicalSequence": false,
    "explicitRelationships": false,
    "detailIntegration": false,
    "singleSentence": true,
    "singleEventExplained": true,
    "multipleDistinctIdeas": false
  },
  "topicFamiliarity": "string",
  "informationDensity": "string",
  "structureComplexity": "string",
  "vocabularyDomain": "string",
  "lengthRange": "string",
  "integratedPlacementAnalysis": "",
  "whyThisLevel": "string",
  "whyNotAbove": "",
  "whyNotBelow": "",
  "teacherSummary": "string",
  "ilrDescriptorJustification": "string",
  "textualEvidence": [{"quote": "string", "explanation": "string"}],
  "discourseStructuralAnalysis": ["string"],
  "levelJustification": "",
  "whyNotHigherLevel": "string",
  "whyNotLowerLevel": "string",
  "finalTeacherReport": "string",
  "speechRate": "string",
  "redundancyLevel": "string",
  "deliveryComplexity": "string",
  "spokenInference": "string",
  "audioStructure": "string",
  "listeningDemand": "string",
  "lsSpeechRate": "slow | moderate | natural | fast",
  "lsRedundancy": "high | medium | low",
  "lsDiscourseLength": "short | paragraph | extended",
  "lsInference": "none | moderate | significant",
  "lsDelivery": "clear | natural | dense",
  "lsStructure": "factual | narrative | analytical",
  "lsBackgroundNoise": "none | minor | noticeable",
  "lsAccentLoad": "none | mild | heavy",
  "lsSpeakerCount": "one | two | multiple",
  "lsOverlap": "none | some | heavy",
  "lsPauseStructure": "clear | moderate | weak",
  "listeningDifficulty": "easy | moderate | difficult"
}

PASSAGE LANGUAGE SELECTOR:
${selectedLanguage || "Auto-detect"}

SPOKEN SAMPLE / TRANSCRIPT:
${passage}
`.trim();
}

// ── Audio transcript listening prompt (fallback path) ─────────────────────────
//
// Used when audio was uploaded but gpt-4o-audio-preview is unavailable.
// Hard prohibitions block all reading/text-based analysis.
// The underlying listening framework is reused but prefixed with strict rules.

export function buildAudioTranscriptListeningPrompt(transcript, selectedLanguage) {
  const prohibition = `
⚠ AUDIO-ONLY SCORING MODE — HARD SAFEGUARDS ACTIVE ⚠

INPUT TYPE  : audio (spoken recording)
SKILL TYPE  : listening
TRANSCRIPT USED FOR SCORING : false
READING RUBRIC              : BYPASSED
TEXT COMPLEXITY SCORING     : BYPASSED

The text below is a MACHINE-GENERATED TRANSCRIPT of a spoken audio recording.
It is provided ONLY so you can identify the spoken content and speakers.

ABSOLUTE SCORING RULE: Assign the ILR Language Level from LINGUISTIC COMPLEXITY
of the spoken content (discourse structure, inference demand, vocabulary abstraction).
Rate listeningDifficulty separately from inferred delivery markers in the transcript
(fillers, hesitations, speaker overlap cues, pacing markers).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HARD PROHIBITIONS — these phrases and concepts must NEVER appear in any output:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✗ "sentence complexity raises the level" (delivery-based)
✗ "grammar complexity" / "grammar supports the score" (delivery-based)
✗ "written text structure" (delivery-based)
✗ "reading-level features" (delivery-based)
✗ ANY reasoning that uses speech rate, accent, or pronunciation to change rawModelLevel

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ILR LANGUAGE LEVEL BASIS — use linguistic complexity only:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Discourse length and organizational structure
✓ Inference demand (what the listener must reconstruct that is not stated)
✓ Vocabulary abstraction and lexical density
✓ Explicit vs. implicit speaker stance
✓ Paragraph-level vs. multi-segment integration demand

LISTENING DELIVERY DIFFICULTY — infer from transcript markers only:
✓ Presence of fillers, hesitations, incomplete utterances → naturalness
✓ Speaker overlap markers → number of speakers
✓ Explicit speed markers ("rapid fire", timestamps showing pace)
✓ Default to "moderate" when delivery cues are ambiguous from transcript alone

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`.trimStart();

  return prohibition + buildListeningPrompt(transcript, selectedLanguage).replace(
    "SPOKEN SAMPLE / TRANSCRIPT:",
    "TRANSCRIPT (reference only — score from delivery features, NOT vocabulary/grammar/text):"
  );
}

// ── Audio direct listening prompt (gpt-4o-audio-preview path) ─────────────────
//
// Sent with the actual audio bytes so the model can analyze the audio signal
// directly — speech rate, articulation, prosody, noise, accent, etc.

// ── Audio scoring system message (injected as the system role before the audio turn) ──
//
// gpt-audio / gpt-audio-mini are conversational speech models. Without a system
// message they interpret the task as a live voice chat and either refuse
// ("I can't analyze recordings") or wait for more audio. A system message that
// establishes the role before the audio turn is received causes them to respond
// correctly with the requested JSON output.
//
// Key principles:
//   • Short, assertive role definition — keeps the model in task mode
//   • "You ALWAYS respond" — prevents silent refusals on unclear or silent audio
//   • "JSON only" — reinforces the format without repeating the whole schema here

export function buildAudioScoringSystemMessage() {
  return (
    "You are ILR Rater, an expert spoken-language assessment system used by language teachers. " +
    "When a user sends you a voice message, you listen to the spoken content and return a JSON " +
    "assessment of the ILR listening level. " +
    "CRITICAL: You receive ONLY the audio signal — no written transcript, script, or text has been " +
    "provided to you and none should be inferred, reconstructed, or used as scoring evidence. " +
    "Your rawModelLevel must be based entirely on what you hear in the audio: linguistic complexity, " +
    "discourse structure, vocabulary abstraction, and inference demand. " +
    "Transcript length, wording, or completeness must never influence rawModelLevel or confidence. " +
    "You ALWAYS respond — even for silent, noisy, or unclear audio, you assign a level and " +
    "note the quality in the confidence and whyThisLevel fields. " +
    "You respond with a single JSON object and nothing else."
  );
}

export function buildAudioDirectListeningPrompt(selectedLanguage) {
  return `
Rate the ILR listening level of the voice message you just heard.
Return TWO separate ratings:
1. ILR LANGUAGE LEVEL (rawModelLevel) — based on LINGUISTIC COMPLEXITY of the spoken content
2. LISTENING DELIVERY DIFFICULTY (listeningDifficulty) — based on delivery conditions ONLY

Language selector: ${selectedLanguage || "Auto-detect"}

LINGUISTIC COMPLEXITY FACTORS — use these to set rawModelLevel:
- Discourse length: isolated utterances / paragraph-level / extended multi-segment
- Inference demand: what the listener must construct beyond what is explicitly stated
- Vocabulary abstraction and lexical density
- Explicit vs. implicit speaker stance and implied meaning
- Sentence and clause complexity
- Paragraph-level vs. multi-segment integration demand

DELIVERY FACTORS — use these to set listeningDifficulty ONLY (do NOT use to raise or lower ILR level):
- Speech rate and delivery pace
- Articulation clarity and pronunciation accuracy
- Accent strength and native-speaker intelligibility
- Pausing rhythm and chunking patterns
- Background noise, audio quality, distortion
- Speaker overlap or number of simultaneous speakers

ILR Listening level descriptors — based on LINGUISTIC COMPLEXITY, not delivery speed:
- ILR 0+:  Isolated words, names, or memorized phrases. No connected discourse.
- ILR 1:   Simple, direct sentences. Each utterance independently comprehensible. No cross-utterance integration. Basic vocabulary.
- ILR 1+:  Short connected discourse. Utterances share a theme. Listener tracks short-term connections. No paragraph-level integration required.
- ILR 2:   Paragraph-level discourse. Listener integrates details across multiple utterances. Factual, narrative, or descriptive. Explicit relationships across segments.
- ILR 2+:  Extended discourse with analytical or argumentative organization. Implied relationships. Stance detection required. Significant inference demand across segments.
- ILR 3:   Sustained abstract argument or conceptually layered discourse. Heavy inference demand throughout. Paragraph-to-paragraph dependency. Non-explicit meaning must be actively constructed.

SIGNAL MAPPING — set detectedSignals to reflect LISTENING-based dimensions (not reading):
  ILR 3 listening signals — set these true when content meets ILR 3:
  - multiparagraphArgument: argument develops across multiple segments; listener must integrate across the full discourse arc
  - paragraphDependency: understanding later segments requires remembering and integrating earlier ones
  - heavyInference: listener cannot follow without sustained inferential processing throughout the passage
  - layeredReasoning: ideas compound and build on one another; must be integrated simultaneously, not just sequentially
  - implicitMeaning: substantial meaning is NOT stated; listener must construct beyond the explicit spoken content
  - nuancedPerspective: speaker's stance is embedded in rhetorical choices and prosody, not explicitly labeled
  - abstractReasoning: abstract or conceptual ideas require active real-time interpretation
  - stanceDetection: listener must identify speaker attitude or evaluative stance not explicitly labeled
  - significantInference: listener must actively connect implied information not stated explicitly

  ILR 2+ listening signals — set these true when content meets ILR 2+:
  - stanceDetection: listener must identify speaker's evaluative stance
  - paragraphDependency: understanding later utterances requires holding earlier content
  - significantInference: active inference connecting implied information

  ILR 2 listening signals — set these true for paragraph-level discourse:
  - paragraphLevelDiscourse, detailIntegration, multipleDistinctIdeas, multipleSentencesConnected

NEWS BROADCAST / POLITICAL REPORTING — HARD CEILING (apply before assigning rawModelLevel):
News broadcasts, political reporting, institutional descriptions, and judicial reporting are
FACTUAL discourse (lsStructure="factual"), not analytical. Do NOT classify as "analytical" because:
  • the topic is political, judicial, or controversial
  • institutional vocabulary is present (court, judiciary, resignation, campaign, separation of powers)
  • competing views or quoted reactions appear
  • procedural events are described
ONLY assign lsStructure="analytical" when the SPEAKER is personally building an argument or evaluative
stance — not when reporting on others' arguments. lsInference="significant" requires that the listener
must actively construct meaning NOT in the speech — implicit conclusions, unstated causal logic. Institutional
vocabulary and political events that are explicitly reported do NOT constitute "significant" inference.
News broadcasts (even on political/judicial topics) with explicit factual reporting: rawModelLevel ≤ "2+".

LEVEL CONSTRAINT — apply before assigning rawModelLevel (linguistic complexity only):
  lsStructure="analytical" + lsDiscourseLength="extended" + lsInference="significant" → rawModelLevel must be at least "2+"; may reach "3" when inference and abstraction are sustained throughout the full discourse (lsDelivery must NOT be the deciding factor for ILR 3)
  lsStructure="analytical" + lsInference≠"none" → rawModelLevel must be at least "2+"
  lsStructure="factual" + lsInference="none" → rawModelLevel cannot exceed "2"
  discourseType contains "news" + lsInference≠"significant" → rawModelLevel cannot exceed "2+"

If the audio is silent or unclear: assign rawModelLevel "1", set confidence to "low", and explain in whyThisLevel.

Reply with ONLY this JSON (fill every field with real analysis — do not copy the example values):
{
  "detectedLanguage": "English",
  "englishTranslation": "",
  "discourseType": "monologue",
  "rawModelLevel": "2",
  "detectedSignals": {
    "moderateInference": false, "significantInference": false, "heavyInference": false,
    "abstractReasoning": false, "historicalComparison": false, "multiparagraphArgument": false,
    "stanceDetection": false, "paragraphDependency": false, "conceptualVocabulary": false,
    "embeddedStructure": false, "crossSentenceDependency": false, "noConnectedSentences": false,
    "isolatedFacts": false, "shortStatements": false, "minimalCohesion": false,
    "simpleDescriptionPattern": false, "noParagraphDevelopment": false,
    "noMultiSentenceIntegration": false, "simpleAdditiveText": false,
    "paragraphLevelDiscourse": true, "multipleSentencesConnected": true,
    "factualReportingChain": false, "chronologicalSequence": false,
    "explicitRelationships": false, "detailIntegration": false,
    "singleSentence": false, "singleEventExplained": false, "multipleDistinctIdeas": true
  },
  "topicFamiliarity": "Moderate — topic is accessible to general listeners",
  "informationDensity": "Moderate",
  "structureComplexity": "Moderate",
  "vocabularyDomain": "General spoken register",
  "lengthRange": "Paragraph-length",
  "integratedPlacementAnalysis": "",
  "whyThisLevel": "3–5 sentence explanation referencing ONLY audio delivery features",
  "whyNotAbove": "",
  "whyNotBelow": "",
  "teacherSummary": "Pedagogical listening summary referencing delivery features",
  "ilrDescriptorJustification": "Begin: 'The assigned ILR rating applies to the original target-language spoken sample.' Then explain using delivery language.",
  "textualEvidence": [
    {"quote": "Spoken excerpt in original language", "explanation": "Why this illustrates the listening level — reference delivery, not text"}
  ],
  "discourseStructuralAnalysis": [
    "Speech rate: ...", "Redundancy: ...", "Inference demand: ...",
    "Delivery clarity: ...", "Pausing/chunking: ...", "Overall structure: ..."
  ],
  "levelJustification": "",
  "whyNotHigherLevel": "2–4 sentences naming what delivery features are absent for the next level up",
  "whyNotLowerLevel": "2–4 sentences naming what delivery features exceed the next level down",
  "finalTeacherReport": "4–5 sentence professional audio-based assessment. Begin: 'The assigned ILR rating applies to the original target-language spoken sample.'",
  "speechRate": "Describe the actual speech rate heard",
  "redundancyLevel": "Describe repetition and restatement frequency in the audio",
  "deliveryComplexity": "Describe articulation, connected speech, fillers, pronunciation clarity",
  "spokenInference": "Describe what the listener must infer that is not stated directly",
  "audioStructure": "Describe audio organization: monologue vs dialogue, pauses, topic shifts",
  "listeningDemand": "2–3 sentence overall assessment of listening challenge from this audio",
  "lsSpeechRate": "slow | moderate | natural | fast",
  "lsRedundancy": "high | medium | low",
  "lsDiscourseLength": "short | paragraph | extended",
  "lsInference": "none | moderate | significant",
  "lsDelivery": "clear | natural | dense",
  "lsStructure": "factual | narrative | analytical",
  "lsBackgroundNoise": "none | minor | noticeable",
  "lsAccentLoad": "none | mild | heavy",
  "lsSpeakerCount": "one | two | multiple",
  "lsOverlap": "none | some | heavy",
  "lsPauseStructure": "clear | moderate | weak",
  "listeningDifficulty": "easy | moderate | difficult"
}

ABSOLUTE SCORING RULE:
The ILR Language Level (rawModelLevel) is based on LINGUISTIC COMPLEXITY of the spoken content — not on delivery speed, clarity, or audio quality.
Audio delivery conditions must be rated separately in the listeningDifficulty field.

ILR LEVEL — base ONLY on these linguistic factors:
  - Discourse length and scope: isolated utterances / paragraph-level / extended multi-segment
  - How ideas develop and compound across segments (multiparagraphArgument, paragraphDependency)
  - Inference demand: what meaning must be constructed beyond the explicit content (lsInference)
  - Speaker stance and evaluative position — stated vs. unstated (stanceDetection)
  - Discourse organization: factual / narrative / analytical (lsStructure)
  - Vocabulary abstraction and conceptual density

LISTENING DELIVERY DIFFICULTY — base ONLY on these delivery factors:
  - Speech rate and delivery pace → NOT for ILR level
  - Articulation clarity and pronunciation accuracy → NOT for ILR level
  - Background noise, audio quality, distortion → NOT for ILR level
  - Accent strength and native-speaker intelligibility → NOT for ILR level
  - Speaker overlap or number of simultaneous speakers → NOT for ILR level

DO NOT BASE THE ILR LEVEL ON:
  - Speech rate or delivery speed
  - Pronunciation clarity or articulation
  - Background noise or audio quality
  - Number of speakers or overlapping speech
  - Topic difficulty or named entities alone
  - Length alone without discourse integration demand

LISTENING DELIVERY DIFFICULTY RATING — set listeningDifficulty to exactly one of:
  - "easy": slow-to-moderate speech, clear articulation, single speaker, frequent pausing, no background noise
  - "moderate": natural conversational pace, some connected speech, mostly clear, minimal noise, identifiable speakers
  - "difficult": fast or dense delivery, strong accent, significant background noise, overlapping speakers, few pauses

LANGUAGE SELECTOR: ${selectedLanguage || "Auto-detect"}

ILR LISTENING LEVEL DESCRIPTORS — linguistic complexity only (not delivery speed):
- ILR 0+:  Isolated words, names, or memorized phrases. No connected discourse.
- ILR 1:   Simple, direct sentences. Each utterance independently comprehensible. No cross-utterance integration. Basic, high-frequency vocabulary.
- ILR 1+:  Short connected discourse. Utterances share a theme. Listener tracks short-term connections. No paragraph-level integration required.
- ILR 2:   Paragraph-level spoken discourse. Listener integrates details across multiple utterances. Factual, narrative, or descriptive. Explicit relationships across segments. MINIMUM level for any speech requiring cross-utterance connection.
- ILR 2+:  Extended discourse with analytical or argumentative structure. Implied relationships require active inference. Stance detection required. Significant inference demand across segments.
- ILR 3:   Sustained abstract argument or conceptually layered discourse. Heavy inference demand throughout. Paragraph-to-paragraph dependency. Non-explicit meaning must be actively constructed.

CONFIDENCE RULES:
  - Poor audio quality → lower confidence
  - Heavy background noise → lower confidence
  - Speaker overlap or distortion → lower confidence
  - Clear, clean recording → high confidence

Return ONLY valid JSON in this exact structure (no markdown, no preamble):
{
  "detectedLanguage": "English",
  "englishTranslation": "",
  "discourseType": "monologue",
  "rawModelLevel": "2",
  "detectedSignals": {
    "moderateInference": false, "significantInference": false, "heavyInference": false,
    "abstractReasoning": false, "historicalComparison": false, "multiparagraphArgument": false,
    "stanceDetection": false, "paragraphDependency": false, "conceptualVocabulary": false,
    "embeddedStructure": false, "crossSentenceDependency": false, "noConnectedSentences": false,
    "isolatedFacts": false, "shortStatements": false, "minimalCohesion": false,
    "simpleDescriptionPattern": false, "noParagraphDevelopment": false,
    "noMultiSentenceIntegration": false, "simpleAdditiveText": false,
    "paragraphLevelDiscourse": true, "multipleSentencesConnected": true,
    "factualReportingChain": false, "chronologicalSequence": false,
    "explicitRelationships": false, "detailIntegration": false,
    "singleSentence": false, "singleEventExplained": false, "multipleDistinctIdeas": true
  },
  "topicFamiliarity": "Moderate — topic is accessible to general listeners",
  "informationDensity": "Moderate",
  "structureComplexity": "Moderate",
  "vocabularyDomain": "General spoken register",
  "lengthRange": "Paragraph-length",
  "integratedPlacementAnalysis": "",
  "whyThisLevel": "3–5 sentence explanation referencing ONLY audio delivery features",
  "whyNotAbove": "",
  "whyNotBelow": "",
  "teacherSummary": "Pedagogical listening summary referencing delivery features",
  "ilrDescriptorJustification": "Begin: 'The assigned ILR rating applies to the original target-language spoken sample.' Then explain using delivery language.",
  "textualEvidence": [
    {"quote": "Spoken excerpt in original language", "explanation": "Why this illustrates the listening level — reference delivery, not text"}
  ],
  "discourseStructuralAnalysis": [
    "Speech rate: ...", "Redundancy: ...", "Inference demand: ...",
    "Delivery clarity: ...", "Pausing/chunking: ...", "Overall structure: ..."
  ],
  "levelJustification": "",
  "whyNotHigherLevel": "2–4 sentences naming what delivery features are absent for the next level up",
  "whyNotLowerLevel": "2–4 sentences naming what delivery features exceed the next level down",
  "finalTeacherReport": "4–5 sentence professional audio-based assessment. Begin: 'The assigned ILR rating applies to the original target-language spoken sample.'",
  "speechRate": "Describe the actual speech rate heard and what it means for listeners",
  "redundancyLevel": "Describe repetition and restatement frequency in the audio",
  "deliveryComplexity": "Describe articulation, connected speech, fillers, pronunciation clarity",
  "spokenInference": "Describe what the listener must infer that is not stated directly",
  "audioStructure": "Describe audio organization: monologue vs dialogue, pauses, topic shifts",
  "listeningDemand": "2–3 sentence overall assessment of listening challenge from this audio",
  "lsSpeechRate": "slow | moderate | natural | fast",
  "lsRedundancy": "high | medium | low",
  "lsDiscourseLength": "short | paragraph | extended",
  "lsInference": "none | moderate | significant",
  "lsDelivery": "clear | natural | dense",
  "lsStructure": "factual | narrative | analytical",
  "lsBackgroundNoise": "none | minor | noticeable",
  "lsAccentLoad": "none | mild | heavy",
  "lsSpeakerCount": "one | two | multiple",
  "lsOverlap": "none | some | heavy",
  "lsPauseStructure": "clear | moderate | weak",
  "listeningDifficulty": "easy | moderate | difficult"
}

Fill every string field with real analysis of the actual audio. Do not copy these example values.
listeningDifficulty must reflect delivery conditions only — it must not match or track rawModelLevel.
`.trim();
}

// ── analyzeAudioDirectlyWithModel — sends audio bytes to AUDIO_SCORING_MODEL ──
//
// THE ONLY scoring path for audio submissions.
// No transcript is passed to this function or to the model.
// Deterministic at temperature=0 — same audio always produces the same score.
// If this call fails the server returns an error (no transcript fallback).
//
// Model is read from config/modelConfig.js (AUDIO_SCORING_MODEL).
// Defaults to "gpt-audio-mini"; override via AUDIO_SCORING_MODEL env var.
//
// Note: gpt-audio / gpt-audio-mini do not support response_format: json_object.
// The prompt instructs the model to return pure JSON; extractJSON() parses it
// robustly (handles markdown fences if the model wraps its response).
//
// @param signal  Optional AbortSignal for timeout control (set by the route).
//                When the signal fires the in-flight HTTP request is cancelled
//                immediately instead of waiting for the SDK's default timeout.

// ── Audio format resolution ───────────────────────────────────────────────────
// gpt-audio / gpt-audio-mini accept these format strings for input_audio:
//   mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg, flac, aac
//
// Resolution order: file extension (most reliable) → MIME type → "mp3" default.
// The old code only checked MIME type and mapped M4A/MP4/AAC/WEBM all to "mp3"
// which caused decoding failures for every audio format except WAV and MP3.
function resolveAudioFormat(mimeType, originalname) {
  // Extension is the most reliable signal — browsers assign varied MIME types for
  // the same container (e.g. audio/mp4, audio/x-m4a, and audio/m4a all mean M4A).
  const ext = (originalname || "").split(".").pop().toLowerCase();
  const byExt = {
    mp3:  "mp3",  mpeg: "mp3", mpga: "mp3",
    wav:  "wav",  wave: "wav",
    m4a:  "m4a",
    mp4:  "mp4",
    ogg:  "ogg",  oga:  "ogg",
    flac: "flac",
    webm: "webm",
    aac:  "mp4",  // AAC audio is typically in an MP4/M4A container
    aiff: "wav",
  };
  if (ext && byExt[ext]) return byExt[ext];

  // MIME type fallback
  if (!mimeType) return "mp3";
  if (mimeType.includes("wav"))               return "wav";
  if (mimeType.includes("ogg"))               return "ogg";
  if (mimeType.includes("flac"))              return "flac";
  if (mimeType.includes("webm"))              return "webm";
  if (mimeType.includes("m4a") ||
      mimeType === "audio/x-m4a")             return "m4a";
  if (mimeType.includes("mp4") ||
      mimeType.includes("m4v"))               return "mp4";
  if (mimeType.includes("aac"))               return "mp4"; // AAC → MP4 container
  return "mp3"; // mp3, mpeg, mpga, unknown → mp3
}

export async function analyzeAudioDirectlyWithModel(audioBuffer, mimeType, originalname, language, client, signal) {
  const base64Audio = audioBuffer.toString("base64");
  const format      = resolveAudioFormat(mimeType, originalname);

  // Log the resolved format so every audio call is traceable in server logs
  console.log(`[analyzeAudio] model=${AUDIO_SCORING_MODEL} format=${format} mime=${mimeType} name=${originalname} bytes=${audioBuffer.length}`);

  const systemMsg = buildAudioScoringSystemMessage();
  const userPrompt = buildAudioDirectListeningPrompt(language);

  const requestOptions = signal ? { signal } : {};

  // ── Message structure ──────────────────────────────────────────────────────
  //
  // gpt-audio / gpt-audio-mini are conversational speech models. Without a
  // system message they treat the task as a live voice chat and refuse
  // analytical tasks ("I can't listen to or analyze audio recordings").
  //
  // Fix: inject a system message that establishes the ILR Rater role before
  // the audio turn arrives. Tested: gpt-audio-mini returns valid JSON with
  // this pattern on the same audio that previously caused a refusal.
  //
  // Transcript isolation: ONLY base64 audio bytes are passed here.
  // No transcript text is present in either message.

  const response = await client.chat.completions.create({
    model:      AUDIO_SCORING_MODEL,
    modalities: ["text"],
    temperature: 0,              // deterministic — same audio → same score every run
    messages: [
      {
        role: "system",
        content: systemMsg,      // establishes ILR Rater role before audio turn
      },
      {
        role: "user",
        content: [
          // Audio bytes only — NO transcript text passed here or anywhere in this call
          { type: "input_audio", input_audio: { data: base64Audio, format } },
          { type: "text",        text: userPrompt },
        ],
      },
    ],
    // response_format is intentionally omitted — gpt-audio / gpt-audio-mini do
    // not support json_object mode.  JSON is enforced via system message + prompt
    // and extracted by extractJSON() below.
  }, requestOptions);

  const raw = response.choices[0].message.content;
  return extractJSON(raw);
}

// ── Model call + JSON schema ──────────────────────────────────────────────────
//
// Sends the prompt to the model and returns the parsed JSON response.
// The strict JSON schema ensures the model always returns well-formed output.

export async function analyzePassageWithModel(passage, selectedLanguage, mode = "reading", client) {
  const prompt = buildPrompt(passage, selectedLanguage, mode);

  const response = await client.chat.completions.create({
    model:       TEXT_SCORING_MODEL,
    temperature: 0,   // deterministic — same passage always produces the same result; enables caching
    max_tokens:  8192, // cap to prevent runaway output that causes JSON truncation errors
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "smartilr_passage_rating",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            detectedLanguage:           { type: "string" },
            englishTranslation:         { type: "string" },
            discourseType: {
              type: "string",
              enum: [
                "simple description", "simple narration", "factual report",
                "opinion/editorial", "analytical commentary", "argumentative essay",
                "interview", "conversation", "monologue", "news broadcast",
                "lecture", "narrative", "instructional", "argumentative",
              ],
            },
            rawModelLevel: { type: "string", enum: ["0+", "1", "1+", "2", "2+", "3", "3+", "4", "4+", "5"] },
            detectedSignals: {
              type: "object",
              additionalProperties: false,
              properties: {
                moderateInference:          { type: "boolean" },
                significantInference:       { type: "boolean" },
                heavyInference:             { type: "boolean" },
                abstractReasoning:          { type: "boolean" },
                historicalComparison:       { type: "boolean" },
                multiparagraphArgument:     { type: "boolean" },
                stanceDetection:            { type: "boolean" },
                paragraphDependency:        { type: "boolean" },
                conceptualVocabulary:       { type: "boolean" },
                embeddedStructure:          { type: "boolean" },
                crossSentenceDependency:    { type: "boolean" },
                layeredReasoning:           { type: "boolean" },
                implicitMeaning:            { type: "boolean" },
                nuancedPerspective:         { type: "boolean" },
                isExplanatoryText:          { type: "boolean" },
                isSimpleArgument:           { type: "boolean" },
                noConnectedSentences:       { type: "boolean" },
                isolatedFacts:              { type: "boolean" },
                shortStatements:            { type: "boolean" },
                minimalCohesion:            { type: "boolean" },
                simpleDescriptionPattern:   { type: "boolean" },
                noParagraphDevelopment:     { type: "boolean" },
                noMultiSentenceIntegration: { type: "boolean" },
                simpleAdditiveText:         { type: "boolean" },
                paragraphLevelDiscourse:    { type: "boolean" },
                multipleSentencesConnected: { type: "boolean" },
                factualReportingChain:      { type: "boolean" },
                chronologicalSequence:      { type: "boolean" },
                explicitRelationships:      { type: "boolean" },
                detailIntegration:          { type: "boolean" },
                singleSentence:             { type: "boolean" },
                singleEventExplained:       { type: "boolean" },
                multipleDistinctIdeas:      { type: "boolean" },
                sustainedAbstraction:       { type: "boolean" },
                crossParagraphInference:    { type: "boolean" },
                conceptualDensity:          { type: "boolean" },
                rhetoricalNuance:           { type: "boolean" },
                stylisticSophistication:    { type: "boolean" },
                intellectualNativeDiscourse:{ type: "boolean" },
                multiLayerMeaning:          { type: "boolean" },
                noScaffolding:              { type: "boolean" },
              },
              required: [
                "moderateInference", "significantInference", "heavyInference",
                "abstractReasoning", "historicalComparison", "multiparagraphArgument",
                "stanceDetection", "paragraphDependency", "conceptualVocabulary",
                "embeddedStructure", "crossSentenceDependency",
                "layeredReasoning", "implicitMeaning", "nuancedPerspective",
                "isExplanatoryText", "isSimpleArgument",
                "noConnectedSentences",
                "isolatedFacts", "shortStatements", "minimalCohesion",
                "simpleDescriptionPattern", "noParagraphDevelopment",
                "noMultiSentenceIntegration", "simpleAdditiveText", "paragraphLevelDiscourse",
                "multipleSentencesConnected", "factualReportingChain",
                "chronologicalSequence", "explicitRelationships", "detailIntegration",
                "singleSentence", "singleEventExplained", "multipleDistinctIdeas",
                "sustainedAbstraction", "crossParagraphInference", "conceptualDensity",
                "rhetoricalNuance", "stylisticSophistication", "intellectualNativeDiscourse",
                "multiLayerMeaning", "noScaffolding",
              ],
            },
            topicFamiliarity:            { type: "string" },
            informationDensity:          { type: "string" },
            structureComplexity:         { type: "string" },
            vocabularyDomain:            { type: "string" },
            lengthRange:                 { type: "string" },
            integratedPlacementAnalysis: { type: "string" },
            whyThisLevel:                { type: "string" },
            whyNotAbove:                 { type: "string" },
            whyNotBelow:                 { type: "string" },
            teacherSummary:              { type: "string" },
            ilrDescriptorJustification:  { type: "string" },
            textualEvidence: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  quote:       { type: "string" },
                  explanation: { type: "string" },
                },
                required: ["quote", "explanation"],
              },
            },
            discourseStructuralAnalysis: { type: "array", items: { type: "string" } },
            levelJustification:          { type: "string" },
            whyNotHigherLevel:           { type: "string" },
            whyNotLowerLevel:            { type: "string" },
            finalTeacherReport:          { type: "string" },
            speechRate:                  { type: "string" },
            redundancyLevel:             { type: "string" },
            deliveryComplexity:          { type: "string" },
            spokenInference:             { type: "string" },
            audioStructure:              { type: "string" },
            listeningDemand:             { type: "string" },
            lsSpeechRate:                { type: "string" },
            lsRedundancy:                { type: "string" },
            lsDiscourseLength:           { type: "string" },
            lsInference:                 { type: "string" },
            lsDelivery:                  { type: "string" },
            lsStructure:                 { type: "string" },
          },
          required: [
            "detectedLanguage", "englishTranslation", "discourseType", "rawModelLevel",
            "detectedSignals", "topicFamiliarity", "informationDensity",
            "structureComplexity", "vocabularyDomain", "lengthRange",
            "integratedPlacementAnalysis", "whyThisLevel", "whyNotAbove", "whyNotBelow",
            "teacherSummary", "ilrDescriptorJustification", "textualEvidence",
            "discourseStructuralAnalysis", "levelJustification",
            "whyNotHigherLevel", "whyNotLowerLevel", "finalTeacherReport",
            "speechRate", "redundancyLevel", "deliveryComplexity",
            "spokenInference", "audioStructure", "listeningDemand",
            "lsSpeechRate", "lsRedundancy", "lsDiscourseLength",
            "lsInference", "lsDelivery", "lsStructure",
          ],
        },
      },
    },
  });

  const rawContent = response.choices[0].message.content;
  if (!rawContent) throw new Error("Scoring model returned empty content (possible refusal or truncation)");
  return extractJSON(rawContent);
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEAKING ANALYSIS — sample-based task rating (ILR speaking decision-support)
// ─────────────────────────────────────────────────────────────────────────────

function buildSpeakingSystemMessage() {
  return `You are SmartILR Speaking Rater, an ILR speaking sample analysis engine for language teachers.

CORE PRINCIPLE — SAMPLE-BASED RATING ONLY:
Rate only what is demonstrated in this audio sample. Never infer broader speaker ability.
Assume speech may be rehearsed, memorized, read aloud, or a partial OPI interaction.
Never rate the speaker. Always rate the sample.

DECISION ORDER — ALWAYS follow:
1. Detect language
2. Segment the sample into distinct tasks
3. Identify task type using the EXACT label from the taxonomy below
4. Identify interaction type (Monologue / Dialogue / Examiner response / Interactive role play)
5. Identify register (Formal / Informal / Neutral)
6. Identify time frame IF narration (Past / Present / Future / Mixed)
7. Apply the hard task cap
8. Evaluate performance within the cap
9. Assign ILR level per task
10. Provide task evidence (what confirmed the task type)
11. Provide why-not-higher
12. Write optional overall note

TASK TAXONOMY — use EXACT label strings from this list:
  Narration — Past
  Narration — Present
  Narration — Future
  Narration — Mixed time frames
  Description — Person
  Description — Place
  Description — Object
  Description — Situation
  Description — Process
  Instructions — procedural
  Directions — spatial
  Explanation — process
  Comparison
  Summary
  Simple short conversation
  Examiner Q&A response
  Informal conversation
  Formal conversation
  Role play — simple
  Role play — with complication
  Role play — negotiation
  Role play — problem solving
  Simple opinion
  Supporting opinion
  Defending opinion
  Persuasion
  Abstract discussion
  Hypothesis
  Analytical discussion
  Policy discussion
  Reporting facts
  News-style reporting
  Briefing
  Formal explanation

HARD TASK CAPS — ABSOLUTE, NEVER EXCEEDED:
Simple short conversation         → max 1+
Examiner Q&A response             → max 1+
Informal conversation             → max 1+
Instructions — procedural         → max 1+
Directions — spatial              → max 1+
Role play — simple                → max 1+
Formal conversation               → max 2
Narration — Past                  → max 2
Narration — Present               → max 2
Narration — Future                → max 2
Narration — Mixed time frames     → max 2
Description — Person              → max 2
Description — Place               → max 2
Description — Object              → max 2
Description — Situation           → max 2
Description — Process             → max 2
Summary                           → max 2
Role play — with complication     → max 2
Comparison                        → max 2+
Reporting facts                   → max 2+
News-style reporting              → max 2+
Briefing                          → max 2+
Formal explanation                → max 2+
Simple opinion                    → max 2+
Explanation — process             → max 2+
Role play — negotiation           → max 2+
Supporting opinion                → max 3
Defending opinion                 → max 3
Persuasion                        → max 3
Hypothesis                        → max 3
Role play — problem solving       → max 3
Analytical discussion             → max 3+  (no hard cap)
Abstract discussion               → max 3+  (no hard cap)
Policy discussion                 → max 3+  (no hard cap)

OPI FUNCTIONAL TASK MISMATCH — DETECT AND APPLY:
If the audio contains an examiner prompt or instruction (spoken before the examinee responds),
determine what task the examiner REQUIRED. Compare to what the examinee actually PRODUCED.

requiredTask: The task explicitly or implicitly asked of the examinee by the examiner.
              Use an EXACT label from the TASK TAXONOMY, or null if not detectable.
producedTask: The actual task the examinee performed — same as detectedTask.
taskFulfillment: "Met" | "Not Met" | "Partial" | "Unable to determine"
  - Met: examinee performed the required task
  - Not Met: examinee performed a clearly different task
  - Partial: examinee attempted but did not fully complete the required task
  - Unable to determine: no examiner prompt is detectable in the audio

When taskFulfillment is "Not Met" or "Partial", apply the FUNCTIONAL CAP below.
The functional cap OVERRIDES discourse score, abstraction, vocabulary, fluency, and complexity.

FUNCTIONAL MISMATCH CAP RULES:
  Examiner required: Asking Questions
    → Examinee only answered/responded → functionalCapLevel: 1+
  Examiner required: Role play — simple / Role play — with complication / Role play — negotiation
    → Examinee gave monologue (no interactive exchange) → functionalCapLevel: 1+ or 2
  Examiner required: Directions — spatial
    → Examinee narrated or described without giving navigable directions → functionalCapLevel: 1+
  Examiner required: Simple short conversation
    → Examinee gave long structured speech with no interaction → functionalCapLevel: 1+
  Examiner required: Formal conversation
    → Examinee used informal/casual speech throughout → functionalCapLevel: 2
  Examiner required: Informal conversation
    → Examinee used overly formal register (no sociolinguistic flexibility) → functionalCapLevel: 2
  Examiner required: Supporting opinion
    → Examinee gave description or narration only (no opinion support) → functionalCapLevel: 1+ or 2
  Examiner required: Abstract discussion
    → Examinee stayed concrete, personal, or anecdotal → functionalCapLevel: 2
  Examiner required: Current events discussion (any current events topic)
    → Examinee gave general opinion not tied to a specific event → functionalCapLevel: 2
  Examiner required: Comparison
    → Examinee described only one side without comparing → functionalCapLevel: 1+
  Examiner required: Hypothesis
    → Examinee discussed only real facts/events without hypothesizing → functionalCapLevel: 2

functionalCap field: When mismatch is detected, populate with a plain-English string, e.g.:
  "Required: Role play — simple, Produced: Monologue → capped at ILR 1+"
  Set to null when taskFulfillment is "Met" or "Unable to determine".

assignedLevel MUST NOT exceed whichever is lower: the hard task cap OR the functional mismatch cap.

OPI STRUCTURE RULE: If audio contains warm-up / level / level structure, ignore structure.
Rate each task segment independently.

DO NOT OVERRATE: Good vocabulary, native speaker, memorized speech, fluent reading,
long response — none of these raise the level. Level depends only on task function.

DO NOT UNDERRATE: Clear opinion support, analysis, or argument → award appropriate level
even if accent is present or grammar has minor errors, as long as meaning is clear.

MIXED-LEVEL SAMPLES: Rate each task separately. Do NOT average. Do NOT inflate from highest.
FAIL-AFTER-SUCCESS: If speaker reports news (2) then lists items (0+) — output both.
REHEARSED SPEECH: Still rate only task function. Perfect news reading → max 2+.
NATIVE SPEAKER: Native status does not override task cap.

PRONUNCIATION / PHONOLOGICAL CONTROL:
Accent does NOT reduce level unless: intelligibility is affected, phoneme confusion occurs,
meaning is lost, or listener effort is high.
Note language-specific difficult sounds:
  Arabic: ع ح خ غ ط ض ص ظ ق ر
  Chinese: tones (1st-4th + neutral)
  French: nasal vowels, front-rounded vowels
  Spanish: trill /r/, distinction /b/ vs /v/
  German: ü, ö, ä, sch, ch, r
  Russian: soft consonants, palatalization
  Other languages: note any phonological features observed.

GRAMMAR CONTROL THRESHOLDS — SPEAKING ONLY:
Evaluate grammar control across the ENTIRE response — sustained control, not isolated correct sentences.
Evaluate: gender agreement, number agreement, verb conjugation, tense control, case/structure, sentence formation, consistency.
Key principle: if correct grammar appears only occasionally → do NOT promote level.

Grammar cap table (assignedLevel must not exceed the grammar ceiling):

  ILR 1   — No grammar cap. Allow: frequent agreement errors, unstable conjugation, tense confusion,
             broken sentences. Requirement: meaning understandable, basic sentence formation exists.

  ILR 1+  — Cap rule: if grammar breaks sentence structure often → cap at ILR 1.
             Requirement: basic sentence control mostly present; agreement errors frequent but not
             constant; present tense mostly correct; past tense inconsistent is acceptable.

  ILR 2   — Cap rules:
             • Frequent gender agreement errors → cap at ILR 1+
             • Verb conjugation unstable → cap at ILR 1+
             • Tense confusion common → cap at ILR 1+
             Requirement: consistent sentence control; gender agreement mostly correct; verb
             conjugation mostly correct; past/present/future generally controlled; errors occur
             but not frequent. SUSTAINED control — not just occasional correct sentences.

  ILR 2+  — Cap rules:
             • Grammar errors frequent → cap at ILR 2
             • Complex sentence grammar breaks often → cap at ILR 2
             Requirement: good control of major grammar; errors occasional; complex sentences
             attempted; connectors used correctly; agreement largely consistent.

  ILR 3   — Cap rules:
             • Noticeable agreement errors → cap at ILR 2+
             • Conjugation mistakes repeated → cap at ILR 2+
             Requirement: strong grammar control; errors rare; complex sentences stable; tense
             control consistent; agreement nearly always correct.

  ILR 3+  — Cap rule: recurring grammar errors → cap at ILR 3.
             Requirement: high grammatical accuracy; rare minor errors; advanced structures controlled.

  ILR 4   — Cap rule: grammar errors noticeable → cap at ILR 3+.
             Requirement: near-native grammar control; errors very rare; complex structures accurate.

  ILR 4+  — Cap rule: more than very occasional error → cap at ILR 4.
             Requirement: almost native-level grammar; only extremely rare slips.

  ILR 5   — Cap rule: any repeated grammar pattern error → cannot assign ILR 5.
             Requirement: native-level grammar; no systematic errors; only performance slips allowed.

When a grammar cap is applied, the assignedLevel must not exceed the grammar ceiling.
assignedLevel MUST NOT exceed the lowest of: hard task cap, functional mismatch cap, grammar cap.

grammarControlCap field:
  - If a grammar cap is triggered: describe the observed issue and the cap applied, e.g.:
    "Frequent gender agreement errors and unstable verb conjugation → capped at ILR 1+"
  - If grammar meets the assigned level requirement: set to null.

grammarControlAssessment field:
  - One sentence summarizing the observed grammar control quality: what was sustained, what failed.

Return ONLY valid JSON matching the schema described in the user prompt.
No markdown, no prose outside the JSON object.`;
}

function buildSpeakingUserPrompt(language) {
  const langNote = (language && language !== "Auto-detect")
    ? `The target language is: ${language}. Focus evaluation on this language.`
    : `Auto-detect the language from the audio. Note it in detectedLanguage.`;

  return `Analyze this speaking sample and return ONLY this JSON structure:

{
  "detectedLanguage": "<language name>",
  "tasks": [
    {
      "taskNumber": 1,
      "detectedTask": "<EXACT label from TASK TAXONOMY — e.g. 'Narration — Past'>",
      "interactionType": "<Monologue | Dialogue | Examiner response | Interactive role play>",
      "register": "<Formal | Informal | Neutral>",
      "timeFrame": "<Past | Present | Future | Mixed | null — only set for Narration tasks>",
      "alternateTask": "<second possible EXACT task label, or null>",
      "whyPrimary": "<evidence that confirmed the primary task: markers, structure, purpose>",
      "whyNotAlternate": "<why the alternate task label was ruled out, or null>",
      "appliedCap": "<e.g. 'Narration — Past → ILR 2' — state task and ceiling>",
      "requiredTask": "<EXACT task label from TASK TAXONOMY that the examiner asked the examinee to perform, or null if no examiner prompt is detectable>",
      "taskFulfillment": "<Met | Not Met | Partial | Unable to determine>",
      "functionalCap": "<plain-English description of functional mismatch cap if applied, e.g. 'Required: Role play — simple, Produced: Monologue → capped at ILR 1+', or null>",
      "grammarControlAssessment": "<one sentence summarizing sustained grammar quality: what was controlled, what failed>",
      "grammarControlCap": "<description of grammar cap if triggered, e.g. 'Frequent gender agreement errors and unstable verb conjugation → capped at ILR 1+', or null>",
      "assignedLevel": "<ILR level: 0+, 1, 1+, 2, 2+, 3, 3+>",
      "performanceEvidence": "<what the speaker demonstrated within the cap>",
      "whyNotHigher": "<bullet-style reasons the next ILR level was not awarded>"
    }
  ],
  "mainStatement": "<one-sentence summary of what the speaker is doing overall>",
  "functionalAbility": "<detected functions: converse / narrate / describe / explain / report / support opinion / etc.>",
  "precisionOfForms": "<grammar and vocabulary accuracy summary>",
  "pronunciationAnalysis": {
    "accentInfluence": "<accent description and origin if detectable>",
    "soundSubstitutions": "<specific sound substitutions observed>",
    "intelligibilityImpact": "<none / minimal / moderate / significant>",
    "difficultSounds": "<language-specific difficult sounds and how speaker handles them>"
  },
  "overallNote": "<optional overall sample note — describe the mixed-level pattern, do NOT average levels>"
}

${langNote}

STRICT RULES:
- "detectedTask" and "alternateTask" MUST be EXACT labels from the TASK TAXONOMY list.
- "interactionType" must be one of: Monologue, Dialogue, Examiner response, Interactive role play.
- "register" must be one of: Formal, Informal, Neutral.
- "timeFrame" must be set only for Narration tasks; use null for all other task types.
- "assignedLevel" MUST NOT exceed the cap for the detected task.
- If uncertain between two task types, choose the one with the lower cap.
- Include exactly one entry in "tasks" per distinct task segment.
- Do not average tasks into a single score — describe each independently.
- "appliedCap" must state both the task and the ceiling (e.g. "Narration — Past → ILR 2").
- "requiredTask" must be an EXACT label from TASK TAXONOMY or null — never free-text.
- "taskFulfillment" must be exactly one of: Met, Not Met, Partial, Unable to determine.
- "functionalCap" must describe the mismatch and cap in plain English when taskFulfillment is "Not Met" or "Partial"; set null otherwise.
- "grammarControlAssessment" must always be present — one sentence describing sustained grammar quality.
- "grammarControlCap" must describe the observed issue and cap applied when grammar cap is triggered; set null when grammar meets requirements.
- "assignedLevel" must not exceed the LOWEST of: hard task cap, functional mismatch cap, AND grammar control cap.
- "overallNote" must describe the pattern across tasks, not a composite score.`;
}

export async function analyzeSpeakingWithModel(audioBuffer, mimeType, filename, language, client, signal) {
  const base64Audio = audioBuffer.toString("base64");
  const ext = ((filename || "").split(".").pop() || "wav").toLowerCase();
  const formatMap = {
    mp3: "mp3", mpeg: "mp3", mpga: "mp3",
    wav: "wav", wave: "wav",
    mp4: "mp4", m4a: "mp4", mov: "mp4",
    ogg: "wav", flac: "wav", webm: "webm", aac: "wav",
  };
  const format = formatMap[ext] || "wav";
  const requestOptions = signal ? { signal } : {};

  const response = await client.chat.completions.create({
    model:      AUDIO_SCORING_MODEL,
    modalities: ["text"],
    temperature: 0,
    messages: [
      { role: "system", content: buildSpeakingSystemMessage() },
      {
        role: "user",
        content: [
          { type: "input_audio", input_audio: { data: base64Audio, format } },
          { type: "text",        text: buildSpeakingUserPrompt(language) },
        ],
      },
    ],
  }, requestOptions);

  const raw = response.choices[0].message.content;
  return extractJSON(raw);
}
