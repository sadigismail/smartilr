// ─────────────────────────────────────────────────────────────────────────────
// config/scoringConfig.js
//
// Dimension weights, scoring anchors, and modality parameters.
// Edit this file to tune how each discourse feature contributes to the final
// score and confidence value — without touching any rule or gate logic.
//
// Sections:
//   1.  LEVELS           — canonical ILR level ordering
//   2.  FACTUAL_*        — factual-discourse ceiling type list and ceiling cap
//   3.  CONFIDENCE_WEIGHTS — confidence decay penalties
//   4.  THREE_LAYER      — all three-layer scoring anchors (passage complexity,
//                          task demand, modality difficulty)
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Canonical ILR level ordering ──────────────────────────────────────────
/** Ordered ILR levels from lowest to highest. */
export const LEVELS = ["0+", "1", "1+", "2", "2+", "3", "3+", "4", "4+", "5"];

// ── 2. Factual discourse ceiling ──────────────────────────────────────────────
/** Discourse types subject to the factual ceiling rule (reading). */
export const FACTUAL_DISCOURSE_TYPES = Object.freeze([
  "simple description",
  "simple narration",
  "factual report",
]);

/** Maximum ILR level permitted for unadorned factual discourse (reading). */
export const FACTUAL_CEILING = "2";

// ── 3. Confidence decay weights ───────────────────────────────────────────────
//
// Each factor reduces the raw confidence score when it is detected.
// Increase a weight to penalise that discrepancy more heavily.
//
export const CONFIDENCE_WEIGHTS = Object.freeze({
  /** Penalty per ILR level of disagreement between rawModelLevel and finalLevel. */
  PER_LEVEL_DIFF: 0.07,
  /** Additional penalty when a ceiling rule fired. */
  CEILING_APPLIED: 0.05,
  /** Additional penalty when a reading floor gate fired. */
  FLOOR_APPLIED: 0.05,
  /** Additional penalty when a listening-specific floor fired. */
  LISTENING_FLOOR_APPLIED: 0.05,
  /** Minimum confidence regardless of discrepancy count. */
  MIN_CONFIDENCE: 0.50,
});

// ── 3b. Confidence caps ───────────────────────────────────────────────────────
//
// Applied AFTER confidence decay.  These caps enforce two policies:
//
//   Policy A — Never 100% without strong signals:
//     100% confidence requires all key level signals to be clearly positive,
//     neighboring levels to be clearly rejected, and no borderline indicators.
//     When a passage meets the level but not those "strongly satisfied"
//     conditions, confidence is capped at DEFAULT_MAX (97%).
//
//   Policy B — ILR 2 vs 2+: interpretation-depth cap:
//     Distinguishes ILR 2+ from ILR 2 using four positive interpretation-depth
//     indicators.  The fewer present, the lower the confidence cap, reflecting
//     the proximity of a barely-2+ passage to a strong ILR 2.
//
//     ILR 2  shows: paragraph explanation, moderate abstraction,
//                   straightforward reasoning, limited viewpoint.
//     ILR 2+ shows: interpretation beyond explanation, viewpoint or critique,
//                   conceptual reasoning, implication beyond explicit meaning.
//
//     depth-indicator count → cap
//       4       → no Policy B cap  (strong ILR 2+)
//       3       → WEAK_2PLUS_MINOR (92%)
//       2       → WEAK_2PLUS_MAJOR (85%)
//       0 or 1  → LOW_2PLUS        (78%)  "low ILR 2+"
//
export const CONFIDENCE_CAPS = Object.freeze({
  /**
   * Default maximum when the level is met but NOT strongly satisfied.
   * 100% is only reachable when all key positive signals for the level are
   * present and neighboring levels are clearly rejected.
   */
  DEFAULT_MAX: 0.97,

  // ── ILR 2 vs 2+: interpretation-depth caps ─────────────────────────────
  //
  // Four interpretation-depth indicators distinguish ILR 2+ from ILR 2:
  //   1. depthInterpretation  — significantInference || heavyInference
  //                             (active interpretation beyond tracking explanation)
  //   2. viewpointOrCritique  — stanceDetection
  //                             (author viewpoint, evaluation, or critique)
  //   3. conceptualReasoning  — abstractReasoning
  //                             (abstract conceptual framework, not just factual)
  //   4. implicationBeyond    — conceptualVocabulary || implicitMeaning
  //                             (meaning implied beyond what any sentence directly states)
  //
  // ILR 2 passages show: paragraph explanation, moderate abstraction,
  //   straightforward reasoning, limited viewpoint — none of the above.
  // ILR 2+ passages show: interpretation beyond explanation, viewpoint or
  //   critique, conceptual reasoning, implication beyond explicit meaning.
  //
  // Depth-indicator count → confidence cap:
  //   4 present  →  no Policy B cap (strong ILR 2+)
  //   3 present  →  WEAK_2PLUS_MINOR  (92%)  — solid but not perfectly clean
  //   2 present  →  WEAK_2PLUS_MAJOR  (85%)  — moderate ILR 2+
  //   0 or 1     →  LOW_2PLUS         (78%)  — "low ILR 2+", lower confidence

  /**
   * ILR 2+ cap when 3 of 4 interpretation-depth indicators are present.
   * Solid 2+ assignment but one criterion is absent.
   */
  WEAK_2PLUS_MINOR: 0.92,

  /**
   * ILR 2+ cap when exactly 2 interpretation-depth indicators are present.
   * Moderate 2+ — text shows some interpretive depth but not across the board.
   */
  WEAK_2PLUS_MAJOR: 0.85,

  /**
   * "Low ILR 2+" cap when only 0–1 interpretation-depth indicators are present.
   * The text barely qualifies as 2+ — assign ILR 2+ but with noticeably lower
   * confidence to signal the proximity to a solid ILR 2.
   */
  LOW_2PLUS: 0.78,

  // ── Policy D: borderline score caps ─────────────────────────────────────────
  //
  // Applied when the combined numeric score falls within 0.20 of a band
  // boundary, flagging that the passage is numerically close to an adjacent
  // level even though the gate system assigned the current one.
  //
  // "lower" borderline — score barely clears the floor of the assigned band.
  //   Signals the passage is numerically close to the level below.
  //   Cap set conservatively to reflect genuine uncertainty.
  //
  // "upper" borderline — score is approaching the ceiling of the assigned band.
  //   Signals the passage nearly qualifies for the level above.
  //   Cap slightly less restrictive since "close to next level" is positive.
  //
  BORDERLINE_LOWER: 0.82,
  BORDERLINE_UPPER: 0.88,
});

// ── 4. Three-layer scoring anchors ────────────────────────────────────────────
//
// Controls all anchor values, category mappings, and combination weights used
// by engine/threeLayers.js.  All dimension scores are on a 0–10 scale
// (higher = more complex / demanding).
// The combined score is a weighted mean of the three sub-scores.
//
export const THREE_LAYER = Object.freeze({

  // ── Combined sub-score weights (must sum to 1.0) ──────────────────────────
  WEIGHTS: Object.freeze({
    passageComplexity:  0.40,
    taskDemand:         0.35,
    modalityDifficulty: 0.25,
  }),

  // ── Passage Complexity anchors ─────────────────────────────────────────────
  // mainIdeaAccessibility: how hard it is to identify the main idea (0=explicit, 10=buried)
  MAIN_IDEA: Object.freeze({
    noSentences:           0,   // recognition-only material; no main idea concept
    isolated:              1,   // each sentence its own fact; no single main idea
    shortConnected:        3,   // main idea emerges from short connected text
    paragraphExplicit:     5,   // explicit in paragraph-level factual text
    moderateInference:     6,   // reader must infer main idea from moderate cues
    significantInference:  8,   // reader must actively construct main idea
    heavyInference:       10,   // main idea must be built across paragraphs
  }),

  // inferenceDemand: how much implicit meaning the reader/listener must construct
  INFERENCE: Object.freeze({
    none:         0,   // no inference required; everything is stated explicitly
    moderate:     5,   // some inference required; meaning largely stated
    significant:  7,   // significant inference required throughout
    heavy:        9,   // heavy sustained inference; much meaning is implicit
    abstractBonus: 1,  // added when abstractReasoning is detected
    stanceBonus:   1,  // added when stanceDetection is detected
  }),

  // discourseOrganization: complexity of how ideas are arranged (0=simple, 10=complex)
  DISCOURSE_ORG: Object.freeze({
    "simple description":    1,
    "simple narration":      2,
    "factual report":        4,
    "news broadcast":        4,
    "interview":             4,
    "conversation":          3,
    "narrative":             3,
    "instructional":         4,
    "monologue":             4,
    "lecture":               5,
    "opinion/editorial":     6,
    "analytical commentary": 8,
    "argumentative":         8,
    "argumentative essay":   9,
    DEFAULT:                 3,
    paragraphDependencyBonus: 1,
    multiparagraphBonus:      1,
  }),

  // vocabularyAbstraction: lexical sophistication (0=concrete/familiar, 10=abstract/specialized)
  VOCAB: Object.freeze({
    base:                  2,   // baseline: any passage without specialized vocabulary
    conceptualBonus:       3,   // +3 when conceptualVocabulary detected
    abstractBonus:         3,   // +3 when abstractReasoning detected
    historicalBonus:       1,   // +1 when historicalComparison detected
    multiparagraphBonus:   1,   // +1 when multiparagraphArgument detected
  }),

  // sentenceClauseComplexity: syntactic density (0=simple, 10=heavily embedded)
  SYNTAX: Object.freeze({
    base:                    2,
    crossSentenceBonus:      2,
    embeddedStructureBonus:  4,
    paragraphDepBonus:       2,
  }),

  // genrePurposeComplexity: genre sophistication for passage complexity sub-score
  GENRE: Object.freeze({
    "simple description":    1,
    "simple narration":      2,
    "factual report":        4,
    "news broadcast":        4,
    "interview":             3,
    "conversation":          2,
    "narrative":             3,
    "instructional":         4,
    "monologue":             4,
    "lecture":               5,
    "opinion/editorial":     6,
    "analytical commentary": 8,
    "argumentative":         8,
    "argumentative essay":   9,
    DEFAULT:                 3,
  }),

  // culturalContextDependency: background world/cultural knowledge required (0=none, 10=heavy)
  CULTURAL: Object.freeze({
    base:                 0,
    historicalBonus:      5,
    abstractBonus:        2,
    stanceBonus:          2,
    conceptualBonus:      1,
  }),

  // ── Task Demand anchors ────────────────────────────────────────────────────
  // literalDetail: how much literal detail tracking is required (0=none, 10=heavy)
  LITERAL_DETAIL: Object.freeze({
    base:                     0,
    detailIntegrationBonus:   5,
    factualChainBonus:        2,
    chronologicalBonus:       1,
    paragraphLevelBonus:      1,
    crossSentenceBonus:       1,
  }),

  // paraphraseRecognition: detecting restated meaning (0=not needed, 10=essential)
  PARAPHRASE: Object.freeze({
    base:                     1,
    conceptualVocabBonus:     4,
    embeddedStructureBonus:   3,
    detailIntegrationBonus:   2,
    multipleSentencesBonus:   1,
  }),

  // toneAttitude: detecting tone/attitude (0=not needed, 10=essential)
  TONE: Object.freeze({
    base:                     0,
    stanceBonus:              7,
    multiparagraphBonus:      1,
    significantInferenceBonus:1,
    heavyInferenceBonus:      1,
    editorialGenreBonus:      1,  // added for opinion/editorial and analytical discourseTypes
  }),

  // speakerAuthorPurpose: identifying speaker/author purpose (0=not needed, 10=essential)
  PURPOSE: Object.freeze({
    base:                     0,
    stanceBonus:              5,
    multiparagraphBonus:      2,
    analyticalGenreBonus:     2,  // added for analytical/argumentative discourseTypes
    significantInferenceBonus:1,
  }),

  // compareContrast: comparing/contrasting information across the text (0=none, 10=essential)
  COMPARE: Object.freeze({
    base:                     0,
    historicalBonus:          6,
    multiparagraphBonus:      2,
    paragraphDepBonus:        2,
  }),

  // synthesisAcrossPassage: synthesizing across sections (0=none, 10=essential)
  SYNTHESIS: Object.freeze({
    base:                     0,
    paragraphDepBonus:        6,
    detailIntegrationBonus:   2,
    multiparagraphBonus:      2,
  }),

  // ── Listening Modality Difficulty anchors ──────────────────────────────────
  // speechRate: difficulty due to speech rate (0=slow/easy, 10=fast/hard)
  SPEECH_RATE: Object.freeze({
    slow:     2,
    moderate: 4,
    natural:  6,
    fast:     9,
    DEFAULT:  5,
  }),

  // audioClarity: difficulty due to delivery/articulation (0=clear, 10=dense/opaque)
  AUDIO_CLARITY: Object.freeze({
    clear:   2,
    natural: 5,
    dense:   9,
    DEFAULT: 5,
  }),

  // numberOfSpeakers: difficulty from multiple speakers (0=single, 10=many/overlapping)
  SPEAKERS: Object.freeze({
    single:   1,   // monologue, lecture, news broadcast, instructional
    multiple: 6,   // interview
    many:     8,   // conversation
    DEFAULT:  3,
  }),

  // redundancySupport: higher = LESS redundancy = harder (0=lots of repetition, 10=none)
  REDUNDANCY: Object.freeze({
    high:    2,  // ideas frequently restated → easy
    medium:  5,
    low:     9,  // each idea once → hard
    DEFAULT: 5,
  }),

  // segmentationDifficulty: how hard it is to segment the stream (0=easy, 10=very hard)
  SEGMENTATION: Object.freeze({
    "clear+short":      1,
    "clear+paragraph":  3,
    "clear+extended":   5,
    "natural+short":    3,
    "natural+paragraph":5,
    "natural+extended": 7,
    "dense+short":      5,
    "dense+paragraph":  7,
    "dense+extended":   9,
    DEFAULT:            4,
  }),

  // ── Reading Modality Difficulty anchors ───────────────────────────────────
  // paragraphDensity: density of paragraph-level information (0=sparse, 10=very dense)
  PARA_DENSITY: Object.freeze({
    noSentences:          0,
    isolated:             1,
    shortConnected:       3,
    paragraphLevel:       5,
    factualChainBonus:    1,
    chronologicalBonus:   1,
    detailIntegrationBonus: 2,
    multiparagraphBonus:  2,
  }),

  // embeddedClauses: syntactic embedding difficulty (0=simple, 10=heavily embedded)
  EMBEDDED_CLAUSES: Object.freeze({
    base:                   2,
    embeddedStructureScore: 7,  // when embeddedStructure=true
    paragraphDepBonus:      1,
    abstractBonus:          2,  // when embeddedStructure AND abstractReasoning both true
  }),

  // referenceTracking: cross-reference tracking demand (0=not needed, 10=essential)
  REFERENCE_TRACKING: Object.freeze({
    base:                   1,
    crossSentenceScore:     4,  // when crossSentenceDependency=true
    paragraphDepBonus:      3,
    detailIntegrationBonus: 2,
  }),

  // connectorLoad: how much connector/cohesive device processing is needed
  CONNECTOR_LOAD: Object.freeze({
    base:                       2,
    explicitRelationshipsScore: 5,
    chronologicalBonus:         1,
    multipleSentencesBonus:     1,
    multiparagraphBonus:        2,
  }),

  // textualOrganization: how complex the overall text organization is (0=simple, 10=complex)
  TEXT_ORG: Object.freeze({
    "simple description":    1,
    "simple narration":      2,
    "factual report":        4,
    "news broadcast":        4,
    "interview":             3,
    "conversation":          2,
    "narrative":             3,
    "instructional":         4,
    "monologue":             4,
    "lecture":               5,
    "opinion/editorial":     6,
    "analytical commentary": 7,
    "argumentative":         7,
    "argumentative essay":   8,
    DEFAULT:                 3,
    multiparagraphBonus:     1,
    paragraphDepBonus:       1,
  }),
});

// ── 5. Item Difficulty Predictor config ───────────────────────────────────────
//
// Controls how detected passage signals map to predicted difficulty scores
// for each DLPT-style question type.  All weights are additive; clamped to
// [0.0, 5.0].  Edit base scores and signal weights here to tune predictions
// without touching the predictor engine.
//
// Difficulty thresholds (lower inclusive, upper exclusive):
//   Easy            : score < EASY
//   Moderate        : EASY  ≤ score < MODERATE
//   Challenging     : MODERATE ≤ score < CHALLENGING
//   Very Challenging: score ≥ CHALLENGING
//
export const ITEM_DIFFICULTY_CONFIG = Object.freeze({

  THRESHOLDS: Object.freeze({
    EASY:        2.0,   // < 2.0    → Easy
    MODERATE:    3.1,   // 2.0–3.0  → Moderate
    CHALLENGING: 4.1,   // 3.1–4.0  → Challenging
                        // ≥ 4.1    → Very Challenging
  }),

  ILR_DEMAND: Object.freeze({
    "Easy":            "ILR 1",
    "Moderate":        "ILR 1+–2",
    "Challenging":     "ILR 2+",
    "Very Challenging": "ILR 3",
  }),

  QUESTION_TYPES: Object.freeze({
    mainIdea:            { label: "Main Idea",            base: 2.0 },
    supportingDetail:    { label: "Supporting Detail",    base: 1.8 },
    inference:           { label: "Inference",            base: 1.5 },
    purpose:             { label: "Purpose",              base: 2.2 },
    toneAttitude:        { label: "Tone/Attitude",        base: 2.5 },
    paraphraseRecognition: { label: "Paraphrase Recognition", base: 1.8 },
    compareContrast:     { label: "Compare/Contrast",     base: 2.5 },
    synthesis:           { label: "Synthesis",            base: 2.0 },
  }),

  // Signal weights — positive values raise score (harder), negative lower it (easier).
  // Each key must be a valid detectedSignals field.
  SIGNAL_WEIGHTS: Object.freeze({

    mainIdea: Object.freeze({
      abstractReasoning:       +0.7,
      implicitMeaning:         +0.8,
      heavyInference:          +0.8,
      significantInference:    +0.5,
      multiparagraphArgument:  +0.4,
      paragraphDependency:     +0.3,
      stanceDetection:         +0.3,
      layeredReasoning:        +0.6,
      noConnectedSentences:    -0.3,
      isolatedFacts:           -0.2,
    }),

    supportingDetail: Object.freeze({
      paragraphLevelDiscourse:    +0.5,
      detailIntegration:          +0.6,
      embeddedStructure:          +0.7,
      crossSentenceDependency:    +0.6,
      multiparagraphArgument:     +0.5,
      paragraphDependency:        +0.5,
      factualReportingChain:      +0.3,
      multipleSentencesConnected: +0.2,
      simpleAdditiveText:         -0.3,
      isolatedFacts:              -0.3,
      noMultiSentenceIntegration: -0.2,
    }),

    inference: Object.freeze({
      moderateInference:    +0.6,
      significantInference: +1.0,
      heavyInference:       +1.5,
      implicitMeaning:      +0.8,
      abstractReasoning:    +0.5,
      nuancedPerspective:   +0.5,
      layeredReasoning:     +0.7,
      stanceDetection:      +0.3,
      isolatedFacts:        -0.4,
      noConnectedSentences: -0.3,
      shortStatements:      -0.2,
    }),

    purpose: Object.freeze({
      stanceDetection:      +0.8,
      implicitMeaning:      +0.7,
      abstractReasoning:    +0.5,
      nuancedPerspective:   +0.7,
      layeredReasoning:     +0.6,
      isExplanatoryText:    -0.5,
      isSimpleArgument:     -0.3,
      isolatedFacts:        -0.3,
      noConnectedSentences: -0.2,
    }),

    toneAttitude: Object.freeze({
      nuancedPerspective:   +1.0,
      implicitMeaning:      +0.8,
      heavyInference:       +0.6,
      significantInference: +0.4,
      abstractReasoning:    +0.4,
      stanceDetection:      +0.3,
      layeredReasoning:     +0.5,
      isExplanatoryText:    -0.5,
      simpleDescriptionPattern: -0.3,
      noConnectedSentences: -0.3,
      isolatedFacts:        -0.3,
    }),

    paraphraseRecognition: Object.freeze({
      conceptualVocabulary:    +0.8,
      abstractReasoning:       +0.6,
      embeddedStructure:       +0.7,
      implicitMeaning:         +0.5,
      paragraphLevelDiscourse: +0.4,
      heavyInference:          +0.4,
      multiparagraphArgument:  +0.3,
      noConnectedSentences:    -0.3,
      isolatedFacts:           -0.2,
      shortStatements:         -0.2,
    }),

    compareContrast: Object.freeze({
      implicitMeaning:       +0.9,
      abstractReasoning:     +0.5,
      stanceDetection:       +0.4,
      historicalComparison:  +0.7,
      multiparagraphArgument:+0.5,
      layeredReasoning:      +0.5,
      significantInference:  +0.4,
      explicitRelationships: -0.4,
      chronologicalSequence: -0.2,
      noConnectedSentences:  -0.4,
    }),

    synthesis: Object.freeze({
      multiparagraphArgument: +0.8,
      paragraphDependency:    +0.7,
      heavyInference:         +0.7,
      layeredReasoning:       +0.9,
      multipleDistinctIdeas:  +0.4,
      detailIntegration:      +0.4,
      paragraphLevelDiscourse:+0.3,
      singleEventExplained:   -0.5,
      noConnectedSentences:   -0.4,
      singleSentence:         -0.5,
      simpleAdditiveText:     -0.3,
    }),
  }),

  // ── DLPT-style item tags ──────────────────────────────────────────────────
  //
  // Keyed by question type, then by difficulty label.  Each entry is an ordered
  // array of tag strings drawn from the canonical tag vocabulary:
  //   explicit detail · implied meaning · paraphrase · sequence · cause/effect
  //   compare/contrast · author purpose · attitude/tone · summary
  //   supporting evidence
  //
  // Tags are additive with difficulty — harder levels keep the easier tags and
  // add new ones.  Edit freely; the engine merges them with the difficulty array.
  ITEM_TAGS: Object.freeze({

    mainIdea: Object.freeze({
      "Easy":            ["explicit detail", "summary"],
      "Moderate":        ["explicit detail", "summary", "supporting evidence"],
      "Challenging":     ["summary", "supporting evidence", "implied meaning"],
      "Very Challenging":["summary", "implied meaning", "attitude/tone"],
    }),

    supportingDetail: Object.freeze({
      "Easy":            ["explicit detail", "supporting evidence"],
      "Moderate":        ["explicit detail", "supporting evidence", "sequence"],
      "Challenging":     ["supporting evidence", "sequence", "implied meaning"],
      "Very Challenging":["supporting evidence", "sequence", "implied meaning"],
    }),

    inference: Object.freeze({
      "Easy":            ["explicit detail"],
      "Moderate":        ["implied meaning", "cause/effect"],
      "Challenging":     ["implied meaning", "cause/effect"],
      "Very Challenging":["implied meaning", "cause/effect", "attitude/tone"],
    }),

    purpose: Object.freeze({
      "Easy":            ["author purpose", "explicit detail"],
      "Moderate":        ["author purpose", "implied meaning"],
      "Challenging":     ["author purpose", "implied meaning", "attitude/tone"],
      "Very Challenging":["author purpose", "implied meaning", "attitude/tone"],
    }),

    toneAttitude: Object.freeze({
      "Easy":            ["attitude/tone"],
      "Moderate":        ["attitude/tone", "implied meaning"],
      "Challenging":     ["attitude/tone", "implied meaning"],
      "Very Challenging":["attitude/tone", "implied meaning", "author purpose"],
    }),

    paraphraseRecognition: Object.freeze({
      "Easy":            ["paraphrase", "explicit detail"],
      "Moderate":        ["paraphrase", "implied meaning"],
      "Challenging":     ["paraphrase", "implied meaning"],
      "Very Challenging":["paraphrase", "implied meaning", "compare/contrast"],
    }),

    compareContrast: Object.freeze({
      "Easy":            ["compare/contrast", "explicit detail"],
      "Moderate":        ["compare/contrast", "cause/effect"],
      "Challenging":     ["compare/contrast", "implied meaning", "cause/effect"],
      "Very Challenging":["compare/contrast", "implied meaning", "supporting evidence"],
    }),

    synthesis: Object.freeze({
      "Easy":            ["summary", "explicit detail"],
      "Moderate":        ["summary", "supporting evidence"],
      "Challenging":     ["summary", "supporting evidence", "compare/contrast"],
      "Very Challenging":["summary", "supporting evidence", "compare/contrast", "implied meaning"],
    }),

  }),
});
