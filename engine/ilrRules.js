// ─────────────────────────────────────────────────────────────────────────────
// engine/ilrRules.js
//
// Core ILR level utilities, signal normalization, and the discourse-floor gate.
// This module is purely functional — no I/O, no model calls.
// ─────────────────────────────────────────────────────────────────────────────

import { LEVELS } from "../config/scoringConfig.js";
import { GATE, LEVEL_CAPS } from "../config/gateConfig.js";

// ── Level ordering helpers ────────────────────────────────────────────────────

export function levelIndex(level) {
  return LEVELS.indexOf(level);
}

export function maxLevel(a, b) {
  return levelIndex(a) >= levelIndex(b) ? a : b;
}

export function minLevel(a, b) {
  return levelIndex(a) <= levelIndex(b) ? a : b;
}

export function countTrue(values) {
  return values.filter(Boolean).length;
}

// ── Numeric ILR conversion ────────────────────────────────────────────────────
//
// Maps string ILR levels to their canonical float equivalents on the 0–5 scale.
// The "+" suffix represents a half-step above the integer (e.g. "1+" → 1.5).
//
const LEVEL_FLOAT_MAP = Object.freeze({
  "0+": 0.5,
  "1":  1.0,
  "1+": 1.5,
  "2":  2.0,
  "2+": 2.5,
  "3":  3.0,
  "3+": 3.5,
  "4":  4.0,
  "4+": 4.5,
  "5":  5.0,
});

/**
 * Convert a string ILR level to its numeric float equivalent.
 * Returns null for unrecognised levels.
 *
 * @param {string} level — e.g. "3+", "4", "5"
 * @returns {number|null}
 */
export function levelToFloat(level) {
  return LEVEL_FLOAT_MAP[level] ?? null;
}

/**
 * Snap an arbitrary numeric value to the nearest valid ILR half-step.
 * Valid steps: 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5
 *
 * This is the canonical normalizeIlrLevel implementation.
 * Use it wherever a calculated/intermediate numeric score must be
 * rounded to a valid ILR position before display or comparison.
 *
 * @param {number} level — raw numeric value (may be fractional)
 * @returns {number} — nearest valid ILR half-step in [0, 5]
 */
export function normalizeIlrLevel(level) {
  if (level === null || level === undefined || isNaN(level)) return 0;

  const allowed = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

  return allowed.reduce((prev, curr) =>
    Math.abs(curr - level) < Math.abs(prev - level) ? curr : prev
  );
}

/**
 * Clamp and normalize a numeric ILR level to a valid half-step in [0, 5].
 *
 * Rules:
 *   null / undefined / NaN  → 0
 *   < 0                     → 0
 *   > 5                     → 5
 *   strictly between n and n+1 (for n in 0–4) → n + 0.5
 *   exact integer (0–5)     → that integer
 *
 * Unlike normalizeIlrLevel (nearest-neighbor), this function maps ANY
 * value strictly between two integers to the "+" half-step, making it
 * suitable as a last-resort safety clamp on numeric pipeline output.
 *
 * @param {number} level — raw numeric value
 * @returns {number} — valid ILR half-step in [0, 5]
 */
export function finalizeILRLevel(level) {
  if (level === null || level === undefined || isNaN(level)) return 0;

  if (level < 0) level = 0;
  if (level > 5) level = 5;

  if (level > 0 && level < 1) return 0.5;
  if (level > 1 && level < 2) return 1.5;
  if (level > 2 && level < 3) return 2.5;
  if (level > 3 && level < 4) return 3.5;
  if (level > 4 && level < 5) return 4.5;

  return Math.round(level);
}

// ── Discourse type sets ───────────────────────────────────────────────────────

// DISPLAY-ONLY — these types are shown as supporting context in the report.
// They do NOT trigger any floor gate or level promotion.
// Discourse type describes what kind of text was assigned; it does not
// determine how hard the text is to read.  Analytical commentary can occur
// at ILR 1+, ILR 2, ILR 2+, or ILR 3 — the comprehension signals alone
// determine the floor.
export const ARGUMENTATIVE_TYPES = Object.freeze([
  "opinion/editorial",
  "analytical commentary",
  "argumentative essay",
]);

export const FACTUAL_TYPES = Object.freeze([
  "simple description",
  "simple narration",
  "factual report",
]);

// ── Signal normalization ──────────────────────────────────────────────────────
//
// Converts a raw model signal object (which may have missing or non-boolean
// values) into a clean boolean-typed record.  All 26 signals are listed here.
// Adding a new signal means adding it here AND in the prompt schema.

export function normalizeSignals(signals = {}) {
  return {
    // ── Inference and argumentation signals ──────────────────────────
    moderateInference:     !!signals.moderateInference,
    significantInference:  !!signals.significantInference,
    heavyInference:        !!signals.heavyInference,
    abstractReasoning:     !!signals.abstractReasoning,
    historicalComparison:  !!signals.historicalComparison,
    multiparagraphArgument:!!signals.multiparagraphArgument,
    stanceDetection:       !!signals.stanceDetection,
    paragraphDependency:   !!signals.paragraphDependency,
    conceptualVocabulary:  !!signals.conceptualVocabulary,
    embeddedStructure:     !!signals.embeddedStructure,
    crossSentenceDependency:!!signals.crossSentenceDependency,

    // ── ILR 3 discriminator signals ───────────────────────────────────
    // These three POSITIVE signals are required simultaneously for ILR 3.
    // layeredReasoning: non-linear reasoning where sub-arguments must be
    //   integrated simultaneously, not followed sequentially paragraph by paragraph.
    // implicitMeaning: substantial meaning is NOT stated; reader must construct
    //   beyond the explicit content of the text.
    // nuancedPerspective: authorial stance is indirect/embedded in rhetorical
    //   choices, not identifiable from explicit evaluative vocabulary.
    layeredReasoning:  !!signals.layeredReasoning,
    implicitMeaning:   !!signals.implicitMeaning,
    nuancedPerspective:!!signals.nuancedPerspective,

    // ── ILR 3 exclusion signals ───────────────────────────────────────
    // These NEGATIVE signals block ILR 3 even when all other conditions are met.
    // isExplanatoryText: primary function is explanation — even if abstract,
    //   multi-paragraph, and analytically sophisticated.  ILR 2+ maximum.
    // isSimpleArgument: main claim, evidence, and conclusion are all explicitly
    //   stated; architecture is transparent.  ILR 2+ maximum.
    isExplanatoryText: !!signals.isExplanatoryText,
    isSimpleArgument:  !!signals.isSimpleArgument,

    // ── ILR 3+ / 4 / 4+ / 5 discriminator signals ────────────────────
    // sustainedAbstraction: sustained multi-paragraph abstract conceptual
    //   reasoning that is more pervasive and dense than baseline ILR 3 —
    //   the entire text operates at an abstract conceptual level with no
    //   relief into concrete illustration.
    sustainedAbstraction:        !!signals.sustainedAbstraction,
    // crossParagraphInference: the reader must construct meaning by actively
    //   integrating information from DIFFERENT paragraphs — not just within
    //   a single paragraph's inference chain.
    crossParagraphInference:     !!signals.crossParagraphInference,
    // conceptualDensity: very high density of abstract concepts packed into
    //   compressed text; each clause or sentence carries multiple abstract ideas.
    conceptualDensity:           !!signals.conceptualDensity,
    // rhetoricalNuance: rhetorical sophistication — irony, understatement,
    //   deliberate ambiguity, or implication embedded in rhetorical structure
    //   such that meaning is carried by HOW it is said, not WHAT is said.
    rhetoricalNuance:            !!signals.rhetoricalNuance,
    // stylisticSophistication: distinctive literary or disciplinary stylistic
    //   choices (register shifts, genre conventions, voice) that actively carry
    //   or modify meaning and cannot be ignored by the reader.
    stylisticSophistication:     !!signals.stylisticSophistication,
    // intellectualNativeDiscourse: fully native-speaker intellectual level
    //   discourse — no scaffolding, no metalinguistic guidance, no concessions
    //   to a non-specialist reader; assumes complete cultural and disciplinary
    //   immersion.
    intellectualNativeDiscourse: !!signals.intellectualNativeDiscourse,
    // multiLayerMeaning: text sustains multiple simultaneous interpretive
    //   layers; meaning cannot be fully resolved into a single reading and the
    //   reader must hold competing or complementary layers at once.
    multiLayerMeaning:           !!signals.multiLayerMeaning,
    // noScaffolding: the text provides zero structural or metalinguistic
    //   support — no explicit discourse markers, no guiding frames, no
    //   transitions that announce argument moves; the reader must supply
    //   all organizational and background knowledge independently.
    noScaffolding:               !!signals.noScaffolding,

    // ── ILR 0+ boundary signal ───────────────────────────────────────
    // Recognition only — no connected discourse of any kind.
    noConnectedSentences:  !!signals.noConnectedSentences,

    // ── ILR 1 ceiling signals (disconnected sentences) ───────────────
    isolatedFacts:              !!signals.isolatedFacts,
    shortStatements:            !!signals.shortStatements,
    minimalCohesion:            !!signals.minimalCohesion,
    simpleDescriptionPattern:   !!signals.simpleDescriptionPattern,
    noParagraphDevelopment:     !!signals.noParagraphDevelopment,
    noMultiSentenceIntegration: !!signals.noMultiSentenceIntegration,

    // ── Functional / additive text protection ────────────────────────
    // TRUE when the passage is a functional notice, announcement, job ad,
    // school message, or public information text where any additional clauses
    // are routine additive details (phone numbers, contact instructions,
    // dates, addresses, application steps, office hours, prices) that do NOT
    // require the reader to integrate or hold information across sentences.
    simpleAdditiveText:         !!signals.simpleAdditiveText,

    // ── ILR 1+ floor signals (short connected discourse) ─────────────
    multipleSentencesConnected: !!signals.multipleSentencesConnected,

    // ── ILR 2 floor signals (paragraph-level integration) ────────────
    paragraphLevelDiscourse: !!signals.paragraphLevelDiscourse,
    factualReportingChain:   !!signals.factualReportingChain,
    chronologicalSequence:   !!signals.chronologicalSequence,
    explicitRelationships:   !!signals.explicitRelationships,
    detailIntegration:       !!signals.detailIntegration,

    // ── ILR 2 structural guard signals ───────────────────────────────
    // Prevent single-sentence texts, single-event narrations, and simple
    // cause-effect clauses from being overrated as ILR 2.
    // All three MUST be in the JSON schema (properties + required).
    singleSentence:        !!signals.singleSentence,
    singleEventExplained:  !!signals.singleEventExplained,
    multipleDistinctIdeas: !!signals.multipleDistinctIdeas,
  };
}

// ── Compound signal predicates ────────────────────────────────────────────────
//
// These predicates are derived from normalizeSignals() output and are used by
// both discourseFloor() and modalityRules.js.  Exported so modalityRules can
// reuse them without re-implementing the same logic.

/**
 * Returns true when the passage requires genuine paragraph-level integration.
 *
 * KEY TIGHTENING: chronologicalSequence and explicitRelationships alone are
 * ILR 1+ signals (short connected discourse), NOT ILR 2 signals.
 *
 * - A simple timeline of personal events ("Ahmed woke up, went to school,
 *   played sports, came home") is ILR 1+ even if it spans many sentences,
 *   because the reader only tracks a time sequence — not a main idea with
 *   integrated supporting details.
 * - chronologicalSequence ONLY reaches ILR 2 when ALSO combined with
 *   detailIntegration — i.e., the sequence includes explanatory or descriptive
 *   expansion that the reader must integrate, not just ordered events.
 *
 * Only these combinations qualify as paragraph-level integration:
 *   1. paragraphLevelDiscourse (direct signal)
 *   2. factualReportingChain (multi-sentence attribution chain)
 *   3. detailIntegration combined with multi-sentence context
 *   4. explicitRelationships spanning multiple sentences (not single sentence)
 *   NOTE: chronologicalSequence alone is ILR 1+, NOT ILR 2.
 */
export function hasParagraphLevelIntegration(s) {
  // 1. Direct paragraph-level signal — most reliable ILR 2 indicator
  if (s.paragraphLevelDiscourse) return true;
  // 2. Full attribution/detail chain across multiple sentences
  if (s.factualReportingChain) return true;
  // 3. Detail integration — only paragraph-level if NOT confined to a single sentence
  if (s.detailIntegration && !s.singleSentence) return true;
  // 4. Explicit logical/causal/temporal relationships — only paragraph-level when
  //    multiple sentences are genuinely connected AND the passage is not a single sentence
  if (s.explicitRelationships && s.multipleSentencesConnected && !s.singleSentence) return true;
  // NOTE: chronologicalSequence alone does NOT trigger ILR 2 floor.
  // Simple chronological narration (personal events, daily timeline) is ILR 1+.
  // Only reaches ILR 2 when combined with detailIntegration (handled above via
  // condition 3: detailIntegration && !singleSentence).
  return false;
}

/** Returns true when the passage has short connected discourse but NOT paragraph-level. */
export function hasShortConnectedDiscourse(s) {
  return s.multipleSentencesConnected || s.crossSentenceDependency;
}

/**
 * Returns true when the passage is limited to short, disconnected sentences:
 * all five ILR 1 ceiling signals are true and no integration signals are present.
 */
export function isShortDisconnectedOnly(s) {
  return (
    s.isolatedFacts              &&
    s.shortStatements            &&
    s.minimalCohesion            &&
    s.noParagraphDevelopment     &&
    s.noMultiSentenceIntegration &&
    !s.paragraphLevelDiscourse   &&
    !s.multipleSentencesConnected &&
    !s.factualReportingChain     &&
    !s.chronologicalSequence     &&
    !s.explicitRelationships     &&
    !s.detailIntegration         &&
    !s.crossSentenceDependency
  );
}

/**
 * isShortConnectedOnly
 * True when the passage has short connected discourse (sentence-to-sentence
 * links) but LACKS any paragraph-level integration.
 * Used by ceiling R5 to enforce the ILR 1+ cap.
 */
export function isShortConnectedOnly(s) {
  return hasShortConnectedDiscourse(s) && !hasParagraphLevelIntegration(s);
}

/**
 * meetsIlr2Conditions
 * Returns true when the passage satisfies the FULL entry conditions for ILR 2:
 *   (a) paragraph-level integration is present (at least one paragraph signal)
 *   (b) at least one discourse relationship or integration signal is present
 *   (c) at least one of: factual reporting chain, explicit relationships +
 *       integration, paragraph development + integration, or any inference level
 *
 * If this returns false for a passage that reached ILR 2 via a floor gate,
 * ceiling R6 will push it back down to ILR 1+.
 *
 * Toggled by LEVEL_CAPS.ENABLE_2_GATE_CAP.
 */
export function meetsIlr2Conditions(s) {
  if (!LEVEL_CAPS.ENABLE_2_GATE_CAP) return true;

  // Structural prerequisites — must all pass before anything else
  if (!hasParagraphLevelIntegration(s)) return false;
  if (s.singleSentence) return false;
  if (s.singleEventExplained && !s.multipleDistinctIdeas) return false;

  // Require at least one genuine inference or abstraction demand
  const hasInference = s.moderateInference || s.significantInference || s.heavyInference;
  const hasAbstraction = s.abstractReasoning;

  // Require meaningful discourse development beyond mere fact accumulation:
  // factual reporting chain, or explicit relationships with paragraph integration,
  // or paragraph-level discourse combined with detail integration.
  const hasDiscourseRelationship = (
    (s.factualReportingChain && s.multipleDistinctIdeas) ||
    (s.explicitRelationships && (s.detailIntegration || s.paragraphLevelDiscourse)) ||
    (s.paragraphLevelDiscourse && s.detailIntegration)
  );

  return (hasInference || hasAbstraction) || hasDiscourseRelationship;
}

/**
 * meetsIlr2PlusConditions
 * Returns true when the passage satisfies at least one of the ILR 2+ criteria
 * listed in LEVEL_CAPS.ILR2PLUS_CRITERIA.
 *
 * If this returns false, ceiling R7 caps the level at ILR 2.
 * Toggled globally by LEVEL_CAPS.ENABLE_2_CAP.
 */
export function meetsIlr2PlusConditions(s) {
  if (!LEVEL_CAPS.ENABLE_2_CAP) return true;
  const C = LEVEL_CAPS.ILR2PLUS_CRITERIA;
  if (C.HEAVY_INFERENCE         && s.heavyInference) return true;
  if (C.SIGNIFICANT_INFERENCE   && s.significantInference) return true;
  if (C.STANCE_WITH_ABSTRACTION && s.stanceDetection && s.abstractReasoning) return true;
  if (C.STANCE_WITH_MULTI_PARA  && s.stanceDetection && s.multiparagraphArgument) return true;
  if (C.ABSTRACT_WITH_MULTI_PARA&& s.abstractReasoning && s.multiparagraphArgument) return true;
  if (C.STANCE_WITH_PARA_DEP    && s.stanceDetection && s.paragraphDependency) return true;
  return false;
}

// ── Discourse floor gate ──────────────────────────────────────────────────────
//
// Determines the minimum ILR level warranted by the comprehension signals
// detected in the passage.  Returns { gatedMinimumLevel, floorReason }.
//
// IMPORTANT: discourse type (argumentative, analytical, etc.) plays NO role
// in any floor gate.  Only content-derived signals determine the floor.
// Analytical commentary, opinion/editorial, and argumentative essay can
// all appear at ILR 1+ through ILR 3 depending on what the text actually
// demands from the reader.
//
// Gate order (first match wins):
//   1.  ILR 3 floor — dense abstract reasoning, non-factual
//   2.  ILR 2+ floor — non-factual + significant inference + feature count
//   3.  ILR 2  floor — paragraph-level integration signals (any one)
//   4.  ILR 1+ floor — short connected discourse signals (no paragraph-level)
//   5.  Factual early-return (no floor for factual + moderate inference)
//   6.  ILR 2  floor — moderate inference + feature count (non-factual)
//   7.  ILR 2  fallback paragraph-level check
//   8.  ILR 1+ fallback connected-discourse check
//   9.  Default floor: "1"

export function discourseFloor(discourseType, signals) {
  const s = normalizeSignals(signals);

  const advancedFeatureCount = countTrue([
    s.moderateInference || s.significantInference || s.heavyInference,
    s.abstractReasoning,
    s.historicalComparison,
    s.multiparagraphArgument,
    s.stanceDetection,
    s.paragraphDependency,
    s.conceptualVocabulary,
    s.embeddedStructure,
  ]);

  // Discourse type is recorded for display only — it does NOT feed any gate.
  const isFactual = FACTUAL_TYPES.includes(discourseType);

  // ── Gate 1: ILR 3 floor ───────────────────────────────────────────────────
  //
  // Blocked when the passage is explanatory text or a simple argument — such
  // texts cannot be ILR 3 regardless of inference and abstraction levels.
  // Also requires the three new ILR 3 discriminator signals (layeredReasoning,
  // implicitMeaning, nuancedPerspective) so that clear analytical passages
  // with heavy inference do not receive an unwarranted ILR 3 floor.
  if (
    !isFactual &&
    !s.isExplanatoryText &&
    !s.isSimpleArgument &&
    s.heavyInference &&
    s.abstractReasoning &&
    s.paragraphDependency &&
    s.layeredReasoning &&
    s.implicitMeaning &&
    s.nuancedPerspective &&
    advancedFeatureCount >= GATE.ILR3_FLOOR_FEATURE_MIN
  ) {
    return {
      gatedMinimumLevel: "3",
      gateTriggered: "ILR3_FLOOR",
      floorReason:
        "The passage requires sustained processing of abstract reasoning, heavy multi-layer inference, and paragraph-level dependency across the full text. Comprehension cannot be achieved through explicit content alone or through local integration of adjacent sentences; the reader must construct complex implied meaning, integrate layered non-linear reasoning, and interpret authorial perspective embedded in rhetorical choices rather than explicitly stated. An ILR 3 minimum is consistent with the interpretive demands present.",
    };
  }

  // ── Gate 2: ILR 2+ floor (non-factual, significant inference) ───────────
  if (!isFactual && s.significantInference && advancedFeatureCount >= GATE.ILR2PLUS_NONFACTUAL_FEATURE_MIN) {
    return {
      gatedMinimumLevel: "2+",
      gateTriggered: "ILR2PLUS_NONFACTUAL_FLOOR",
      floorReason:
        "The text presents non-factual discourse requiring significant inference. The reader must construct meaning that is not fully conveyed by explicitly stated content, integrating authorial intent, implied reasoning, or unstated connections across the passage. An ILR 2+ minimum is consistent with these interpretive demands.",
    };
  }

  // ── Gates 5 & 6: two-tier integration split ───────────────────────────────
  //
  // PARAGRAPH-LEVEL INTEGRATION → floor ILR 2  (gate 5)
  //   Signals: paragraphLevelDiscourse, factualReportingChain, chronologicalSequence,
  //            explicitRelationships, detailIntegration
  //
  // SHORT CONNECTED DISCOURSE → floor ILR 1+  (gate 6)
  //   Signals: multipleSentencesConnected, crossSentenceDependency
  //   Only fires when no paragraph-level signal is present.

  if (hasParagraphLevelIntegration(s)) {
    const triggeredBy = [
      s.paragraphLevelDiscourse && "paragraphLevelDiscourse",
      s.factualReportingChain   && "factualReportingChain",
      s.chronologicalSequence   && "chronologicalSequence",
      s.explicitRelationships   && "explicitRelationships",
      s.detailIntegration       && "detailIntegration",
    ].filter(Boolean).join(", ");
    return {
      gatedMinimumLevel: "2",
      gateTriggered: "ILR2_PARAGRAPH_FLOOR",
      floorReason:
        `Comprehension requires paragraph-level integration of information distributed across multiple sentences. The reader must track the main idea and connect supporting details to form a coherent understanding of the full passage — processing that is consistent with ILR 2 comprehension requirements. (Contributing signals: ${triggeredBy})`,
    };
  }

  if (hasShortConnectedDiscourse(s)) {
    // SIMPLE SEQUENTIAL / ROUTINE GUARD
    // Temporal sequences ("then", "after", "at noon"), routine narrations,
    // timeline descriptions, and activity lists do NOT require sentence-to-sentence
    // tracking — each event is processed independently.
    //
    // Fires when ALL of these hold:
    //   noMultiSentenceIntegration = true   (model: no combining needed)
    //   minimalCohesion            = true   (model: ideas are juxtaposed)
    //   crossSentenceDependency    = false  (no hold-and-connect)
    //   explicitRelationships      = false  (no causal / contrastive / explanatory bond)
    //   moderateInference          = false  (no bridging inference)
    //
    // NOTE: chronologicalSequence is intentionally NOT a bypass condition —
    // temporal sequence ("then", "after") does NOT constitute cohesive discourse.
    if (
      s.noMultiSentenceIntegration &&
      s.minimalCohesion            &&
      !s.crossSentenceDependency   &&
      !s.explicitRelationships     &&
      !s.moderateInference
    ) {
      return {
        gatedMinimumLevel: "1",
        gateTriggered: "ILR1_SIMPLE_SEQUENTIAL_CAP",
        floorReason:
          "Simple sequential / routine pattern: sentences share a topic or temporal order " +
          "but the model explicitly signals no multi-sentence integration is required and minimal cohesion. " +
          "No cross-sentence dependency, causal/contrastive/explanatory bond, or bridging inference is present. " +
          "Temporal sequence alone ('then', 'after', 'at noon') does not constitute connected discourse. " +
          "The reader processes each statement independently — ILR 1 is the correct level.",
      };
    }

    const triggeredBy = [
      s.multipleSentencesConnected && "multipleSentencesConnected",
      s.crossSentenceDependency    && "crossSentenceDependency",
    ].filter(Boolean).join(", ");
    return {
      gatedMinimumLevel: "1+",
      gateTriggered: "ILR1PLUS_CONNECTED_FLOOR",
      floorReason:
        `Comprehension requires limited but necessary sentence-to-sentence integration. The reader must connect information across adjacent sentences and track short discourse relationships that are not self-evident within any single sentence — processing that is consistent with ILR 1+ comprehension requirements. (Contributing signals: ${triggeredBy})`,
    };
  }

  // ── Gate 7: factual early-return (no floor for moderate inference) ────────
  //
  // NOTE: Single-sentence passages and single-event explanations without
  // multiple distinct ideas are guarded from the ILR 2 floor even when
  // moderate inference is present — they remain at ILR 1+ maximum.
  if (s.moderateInference && advancedFeatureCount >= GATE.ILR2_INFERENCE_FEATURE_MIN) {
    if (isFactual) {
      return {
        gatedMinimumLevel: "1",
        gateTriggered: "FACTUAL_NO_FLOOR",
        floorReason:
          "No discourse floor applied: factual discourse type is governed by ceiling constraints rather than minimum floors. Structural signals present on this text reflect grammatical or syntactic complexity and do not independently establish an inference-based comprehension floor.",
      };
    }
    // Single-sentence or single-event without multiple ideas → cap at 1+
    if (s.singleSentence || (s.singleEventExplained && !s.multipleDistinctIdeas)) {
      return {
        gatedMinimumLevel: "1+",
        gateTriggered: "ILR1PLUS_SINGLE_SENTENCE_FLOOR",
        floorReason:
          "The passage contains connected discourse with moderate inference but is structurally limited to a single sentence or a single event without multiple distinct ideas. These structural constraints cap the discourse floor at ILR 1+; paragraph-level integration across multiple distinct ideas is required to establish an ILR 2 minimum.",
      };
    }
    return {
      gatedMinimumLevel: "2",
      gateTriggered: "ILR2_INFERENCE_FLOOR",
      floorReason:
        "The passage requires moderate inference and presents multiple discourse-demand features. The reader must construct meaning that extends beyond sentence-level explicit content, integrating the main idea with supporting detail and tracking implicit connections across the passage. An ILR 2 minimum is consistent with these comprehension requirements.",
    };
  }

  // ── Default floor ─────────────────────────────────────────────────────────
  return {
    gatedMinimumLevel: "1",
    gateTriggered: "DEFAULT_FLOOR",
    floorReason:
      "No cross-sentence integration signals are present. Comprehension does not require tracking discourse relationships across sentence boundaries, integrating main ideas with supporting detail, or constructing implicit meaning. An ILR 1 placement is structurally consistent with the discourse demands of this passage.",
  };
}
