// ─────────────────────────────────────────────────────────────────────────────
// engine/hardGates.js
//
// Explicit minimum-gate logic for each ILR level.  Each gate checks whether
// the detected signals justify the proposed level.  If a gate fails, the level
// is demoted to the next lower level and the reason is logged.
//
// Gate order matters: gates are checked from highest level downward so that
// each demotion is evaluated against the newly lowered level.
//
// Gate functions all accept a normalized signals object (from normalizeSignals)
// and return:
//   { gate, passed, conditions, failedConditions?, passCount?, totalConditions? }
//
// applyHardGates() is the main entry point.  It returns:
//   { finalLevel, demotedFrom, gateLog }
//
// All config booleans live in thresholds.js → LEVEL_CAPS.
// ─────────────────────────────────────────────────────────────────────────────

import { levelIndex } from "./ilrRules.js";
import { LEVEL_CAPS } from "../config/gateConfig.js";

// ── ILR 1 characterisation gate ──────────────────────────────────────────────
//
// "Most" = at least 3 of 5 conditions must be true.
// This is a characterisation check: if fewer than 3 are true when the
// proposed level is ILR 1, the material may not reach ILR 1 at all.
// Demotion to ILR 0+ is only triggered when the text has no connected
// sentences at all (that extreme case is better guarded here than by
// requiring individual callers to re-check noConnectedSentences).
//
// Logged for transparency in every result; demotion is conservative.

export function checkIlr1Gate(s) {
  const conditions = {
    // Each sentence can be understood by reading explicit details alone.
    explicitDetailsSufficient: !s.heavyInference && !s.significantInference,
    // Content is concrete and routine — no abstraction, no specialised domain.
    concreteAndRoutine: !s.abstractReasoning && !s.conceptualVocabulary,
    // Little or no inference: reader never needs to construct implicit meaning.
    littleOrNoInference: !s.moderateInference && !s.significantInference && !s.heavyInference,
    // No paragraph-level integration: no need to hold a paragraph idea in mind.
    noParagraphIntegration:
      !s.paragraphLevelDiscourse && !s.factualReportingChain && !s.detailIntegration,
    // No meaningful relation-tracking: sentences are not connected by logic or reference.
    noRelationTracking: !s.crossSentenceDependency && !s.explicitRelationships,
  };

  const passCount = Object.values(conditions).filter(Boolean).length;
  const passed    = passCount >= 3;

  return {
    gate:             "ILR_1_GATE",
    label:            "ILR 1 characterisation",
    passed,
    passCount,
    totalConditions:  5,
    threshold:        "≥ 3 of 5",
    conditions,
    failedConditions: Object.entries(conditions).filter(([, v]) => !v).map(([k]) => k),
    description:
      "ILR 1 texts present explicit, concrete, routine information requiring no " +
      "inference or cross-sentence integration. Gate passes when at least 3 of " +
      "5 characterisation conditions are true.",
  };
}

// ── ILR 1+ minimum gate ───────────────────────────────────────────────────────
//
// At least ONE of these must be true to justify ILR 1+.
// If none is true, the text is not providing connected discourse; demote to ILR 1.

export function checkIlr1PlusGate(s) {
  // ILR 1+ requires at least ONE of these FOUR genuine discourse-connection signals.
  // Temporal sequence alone ("then", "after", "at noon") does NOT qualify —
  // those are event-listing devices, not cohesive connections that require
  // cross-sentence processing.
  const conditions = {
    // 1. Pronoun reference / hold-and-connect: reader must hold a referent from
    //    sentence N to resolve sentence N+1.  Genuine semantic dependency.
    crossSentenceDependency: !!s.crossSentenceDependency,

    // 2. Causal, contrastive, or explanatory relationship: "because", "however",
    //    "although", "as a result", "in contrast", "for example" — logical bonds
    //    that require integrating the meaning of two sentences.
    //    NOTE: chronologicalSequence ("then", "after", "at noon") is intentionally
    //    excluded — temporal listing does not constitute a logical discourse relation.
    genuineRelationshipTracked: !!s.explicitRelationships,

    // 3. Limited inference: reader must construct meaning not explicit in any
    //    single sentence — meaning that bridges sentences together.
    limitedInferenceNeeded: !!s.moderateInference,

    // 4. Main idea + supporting detail: paragraph-level structure emerging,
    //    reader must combine a central claim with distributed evidence.
    mainIdeaSupportPresent:
      !!(s.detailIntegration || s.paragraphLevelDiscourse || s.factualReportingChain),
  };

  // SIMPLE SEQUENTIAL / ROUTINE GUARD
  // Temporal sequences, routine narrations, timeline descriptions, and activity
  // lists do NOT require sentence-to-sentence tracking — the reader processes
  // each event independently. This guard fires when:
  //   noMultiSentenceIntegration = true  (model: no combining needed)
  //   minimalCohesion            = true  (model: ideas are juxtaposed)
  //   crossSentenceDependency    = false (no hold-and-connect)
  //   explicitRelationships      = false (no causal/contrastive/explanatory bond)
  //   moderateInference          = false (no bridging inference)
  // NOTE: chronologicalSequence intentionally OMITTED from this guard —
  // temporal sequence ("then", "after") does NOT bypass the cap.
  const isSimpleSequentialOrRoutine =
    s.noMultiSentenceIntegration &&
    s.minimalCohesion            &&
    !s.crossSentenceDependency   &&
    !s.explicitRelationships     &&
    !s.moderateInference;

  const passed = !isSimpleSequentialOrRoutine && Object.values(conditions).some(Boolean);

  return {
    gate:                      "ILR_1PLUS_GATE",
    label:                     "ILR 1+ minimum gate",
    passed,
    threshold:                 "≥ 1 of 4",
    passCount:                 Object.values(conditions).filter(Boolean).length,
    totalConditions:           4,
    conditions,
    failedConditions:          passed ? [] : Object.keys(conditions),
    isSimpleSequentialOrRoutine,
    description:
      "ILR 1+ requires at least one of: (1) cross-sentence pronoun reference / " +
      "hold-and-connect, (2) explicit causal, contrastive, or explanatory relationship " +
      "(NOT temporal sequence alone), (3) limited bridging inference, or " +
      "(4) main idea + supporting detail structure. " +
      "Temporal sequences, routine narrations, and activity lists are blocked by " +
      "the simple-sequential guard and demoted to ILR 1.",
  };
}

// ── ILR 2 minimum gate ────────────────────────────────────────────────────────
//
// ALL five conditions must be true to justify ILR 2.
// If any fails, the text cannot support paragraph-level comprehension; demote to ILR 1+.

export function checkIlr2Gate(s) {
  const conditions = {
    // 1. Paragraph-level processing — the reader must build understanding across
    //    multiple sentences as a coherent unit, NOT just process a single sentence
    //    with subordinate clauses or a single cause-effect pair.
    //    Requires actual paragraph signal AND not a single-sentence passage.
    paragraphLevelProcessing:
      (s.paragraphLevelDiscourse || s.factualReportingChain || s.detailIntegration) &&
      !s.singleSentence,

    // 2. More than one supporting idea — the passage develops multiple distinct
    //    propositions, themes, or supporting points.  A single event, single claim,
    //    or single cause-effect pair does NOT meet this condition.
    multipleDistinctIdeas:
      !!s.multipleDistinctIdeas,

    // 3. Main idea + support integration — reader must integrate a central idea
    //    with supporting details distributed across sentences.
    //    NOTE: chronologicalSequence is intentionally excluded — a simple
    //    sequence of events (personal timeline, daily routine narration) does
    //    NOT require integrating a main idea with supporting details and is
    //    ILR 1+ at most. Only detailIntegration/paragraphLevelDiscourse/
    //    factualReportingChain indicate genuine paragraph-level integration.
    mainIdeaIntegration:
      s.detailIntegration       ||
      s.paragraphLevelDiscourse ||
      s.factualReportingChain,

    // 4. Inference or abstraction demand — the reader needs at least moderate
    //    inference OR abstract reasoning.  Explicit fact accumulation alone
    //    (no inference, no abstraction) cannot reach ILR 2.
    inferenceOrAbstraction:
      s.moderateInference    ||
      s.significantInference ||
      s.heavyInference       ||
      s.abstractReasoning,

    // 5. Discourse development beyond simple narration — the passage shows more
    //    than a simple list, a short chronological event, or a cause-effect clause.
    //    At least one higher-level discourse or interpretive feature must be present.
    discourseDevelopmentPresent:
      s.paragraphLevelDiscourse ||
      s.factualReportingChain   ||
      s.moderateInference       ||
      s.significantInference    ||
      s.heavyInference          ||
      s.abstractReasoning       ||
      s.stanceDetection         ||
      s.conceptualVocabulary,

    // 6. Not a routine-description-only passage — independent routine statements
    //    (thematic unity, no integration, minimal cohesion) cannot reach ILR 2
    //    regardless of what other signals are present.  This guard catches cases
    //    where the model mis-fires paragraphLevelDiscourse or multipleDistinctIdeas
    //    on a simple routine text.
    //    TRUE when the passage is NOT a routine-description-only pattern.
    notRoutineDescriptionOnly:
      !(s.noMultiSentenceIntegration &&
        s.minimalCohesion            &&
        !s.crossSentenceDependency   &&
        !s.moderateInference),
  };

  const failedConditions = Object.entries(conditions).filter(([, v]) => !v).map(([k]) => k);
  const passed = failedConditions.length === 0;

  return {
    gate:             "ILR_2_GATE",
    label:            "ILR 2 minimum gate",
    passed,
    threshold:        "all 6 of 6",
    passCount:        Object.values(conditions).filter(Boolean).length,
    totalConditions:  6,
    conditions,
    failedConditions,
    description:
      "ILR 2 requires (1) paragraph-level processing across multiple sentences " +
      "(not a single sentence with clauses), (2) more than one distinct supporting " +
      "idea, (3) main-idea + support integration, (4) at least moderate inference " +
      "or abstract reasoning, (5) discourse development beyond simple narration, and " +
      "(6) NOT a routine-description-only passage (independent routine statements with " +
      "minimal cohesion and no multi-sentence integration cannot reach ILR 2 regardless " +
      "of other signals). All six conditions must hold.",
  };
}

// ── ILR 2+ minimum gate ───────────────────────────────────────────────────────
//
// ALL four conditions must be true (and ILR 2 gate must also have passed).
// If any fails, the text does not support the elevated interpretive demand
// of ILR 2+; demote to ILR 2.

export function checkIlr2PlusGate(s, ilr2GatePassed) {
  if (!ilr2GatePassed) {
    return {
      gate:             "ILR_2PLUS_GATE",
      label:            "ILR 2+ minimum gate",
      passed:           false,
      threshold:        "all 4 of 4 (and ILR 2 gate must pass first)",
      passCount:        0,
      totalConditions:  4,
      conditions:       {},
      failedConditions: ["ILR_2_GATE_PREREQUISITE_FAILED"],
      description:
        "ILR 2+ cannot be assigned unless ILR 2 conditions are fully met. " +
        "The ILR 2 gate did not pass, so ILR 2+ is blocked.",
    };
  }

  const conditions = {
    // Interpretive demand is elevated beyond straightforward paragraph
    // comprehension: significant/heavy inference, stance, or abstraction.
    higherInterpretiveDemand:
      s.significantInference || s.heavyInference ||
      s.stanceDetection      || s.abstractReasoning,
    // Viewpoint, tone, stance, or layered reasoning plays a larger role
    // than in a standard ILR 2 passage.
    viewpointOrLayeredReasoning:
      s.stanceDetection || s.abstractReasoning ||
      s.multiparagraphArgument || s.paragraphDependency,
    // Discourse is denser or less predictable than a standard ILR 2 text:
    // specialised vocabulary, embedded syntax, multi-paragraph argument, or
    // historical/comparative framing.
    denseOrLessPredictable:
      s.conceptualVocabulary  || s.embeddedStructure ||
      s.multiparagraphArgument || s.historicalComparison,
    // Abstraction or implication is stronger than at ILR 2: reader must go
    // beyond surface meaning to construct the author's full intent.
    strongerAbstractionOrImplication:
      s.abstractReasoning    || s.significantInference ||
      s.heavyInference       || s.stanceDetection,
  };

  const failedConditions = Object.entries(conditions).filter(([, v]) => !v).map(([k]) => k);
  const passed = failedConditions.length === 0;

  return {
    gate:             "ILR_2PLUS_GATE",
    label:            "ILR 2+ minimum gate",
    passed,
    threshold:        "all 4 of 4",
    passCount:        Object.values(conditions).filter(Boolean).length,
    totalConditions:  4,
    conditions,
    failedConditions,
    description:
      "ILR 2+ requires higher interpretive demand, viewpoint or layered reasoning, " +
      "denser/less predictable discourse, and stronger abstraction or implication " +
      "than a standard ILR 2 text. All four conditions must hold.",
  };
}

// ── ILR 3 discourse-depth protection gate ────────────────────────────────────
//
// Fast pre-check before the full ILR 3 gate.
// ILR 3 requires: abstraction OR layered reasoning AND implicit meaning AND
// the passage must NOT be a simple explicit argument or explanatory text.
// A pros/cons structure with explicit reasoning is ILR 2+ at most.

export function checkIlr3DiscourseDepthGate(s) {
  const conditions = {
    // Abstraction OR layered reasoning — minimum entry signal.
    abstractionOrLayeredReasoning:
      !!(s.abstractReasoning || s.layeredReasoning),
    // Meaning must be substantially implicit — pros/cons passages where both
    // sides and the conclusion are stated cannot satisfy this condition.
    implicitMeaningPresent:
      !!s.implicitMeaning,
    // Authorial perspective must be indirect and embedded, not explicitly stated.
    // If the author's stance is directly expressed, this fails — caps at 2+.
    nuancedPerspectivePresent:
      !!s.nuancedPerspective,
    // Passage must NOT be primarily explanatory/descriptive text.
    notExplanatoryText:
      !s.isExplanatoryText,
    // Passage must NOT be a simple explicit argument (e.g., structured pros/cons,
    // policy discussion with stated conclusion, bicycle-lane analysis).
    notSimpleArgument:
      !s.isSimpleArgument,
  };

  const failedConditions = Object.entries(conditions)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  const passed = failedConditions.length === 0;

  return {
    gate:             "ILR_3_DISCOURSE_DEPTH_GATE",
    label:            "ILR 3 discourse-depth protection",
    passed,
    threshold:        "all 5 of 5",
    passCount:        Object.values(conditions).filter(Boolean).length,
    totalConditions:  5,
    conditions,
    failedConditions,
    demotionReason:   passed
      ? null
      : "ILR 3 conditions not met. Passage demoted to ILR 2+. " +
        "ILR 3 requires implicit meaning, nuanced (embedded) perspective, " +
        "abstraction or layered reasoning, and must not be explanatory text " +
        "or a simple explicit argument (policy analysis, pros/cons, editorial).",
    description:
      "ILR 3 discourse-depth protection: requires abstractReasoning OR layeredReasoning, " +
      "implicitMeaning=true, nuancedPerspective=true, isExplanatoryText=false, " +
      "and isSimpleArgument=false. Explicit pros/cons, policy discussions, and " +
      "analytical commentary with stated conclusions are capped at ILR 2+.",
  };
}

// ── ILR 3 minimum gate ────────────────────────────────────────────────────────
//
// ALL six conditions must be true. Each maps to a prompt hard rule.
//
// ILR 3 requires:
//   1. Layered (non-linear) reasoning — prompt rule: layeredReasoning=false blocks "3"
//   2. Implicit meaning — meaning NOT stated; prompt rule: implicitMeaning=false blocks "3"
//   3. Nuanced (embedded) perspective — prompt rule: nuancedPerspective=false blocks "3"
//   4. Significant or heavy inference — reader must resolve unstated assumptions
//   5. NOT explanatory text — structured exposition caps at 2+
//   6. NOT a simple explicit argument — pros/cons, policy analysis, bicycle-lane
//      discussions with stated conclusions cap at 2+
//
// Only passages where meaning genuinely cannot be paraphrased from what is written
// can satisfy all six conditions.

export function checkIlr3Gate(s) {
  const conditions = {
    // 1. Layered (non-linear) reasoning is required. Abstract reasoning alone
    //    (sequential argument, even if sophisticated) is ILR 2+ at most.
    //    Prompt rule: "layeredReasoning=false → rawModelLevel cannot be '3'".
    layeredReasoningPresent:
      !!s.layeredReasoning,
    // 2. Meaning is substantially NOT stated — reader must construct it.
    //    Explicit pros/cons passages where both sides and conclusion are stated fail here.
    //    Prompt rule: "implicitMeaning=false → rawModelLevel cannot be '3'".
    implicitMeaningPresent:
      !!s.implicitMeaning,
    // 3. Authorial perspective is indirect and embedded (rhetorical choices, irony,
    //    understatement) — NOT an explicitly stated position or evaluative commentary.
    //    Prompt rule: "nuancedPerspective=false → rawModelLevel cannot be '3'".
    nuancedPerspectivePresent:
      !!s.nuancedPerspective,
    // 4. Reader must actively resolve unstated underlying assumptions.
    inferenceResolvesAssumptions:
      !!(s.significantInference || s.heavyInference),
    // 5. Passage is NOT primarily explanatory or descriptive text.
    //    Policy analysis, comparative analysis, organized argument → isExplanatoryText=true → 2+ max.
    notExplanatoryText:
      !s.isExplanatoryText,
    // 6. Passage is NOT a simple explicit argument.
    //    Bicycle-lane pros/cons, urban-planning policy, any passage where the main
    //    claim, evidence, and conclusion are all stated → isSimpleArgument=true → 2+ max.
    notSimpleArgument:
      !s.isSimpleArgument,
  };

  const failedConditions = Object.entries(conditions).filter(([, v]) => !v).map(([k]) => k);
  const passed = failedConditions.length === 0;

  return {
    gate:             "ILR_3_GATE",
    label:            "ILR 3 minimum gate",
    passed,
    threshold:        "all 6 of 6",
    passCount:        Object.values(conditions).filter(Boolean).length,
    totalConditions:  6,
    conditions,
    failedConditions,
    description:
      "ILR 3 requires: (1) layeredReasoning=true, (2) implicitMeaning=true, " +
      "(3) nuancedPerspective=true, (4) significantInference OR heavyInference, " +
      "(5) isExplanatoryText=false, (6) isSimpleArgument=false. " +
      "Explicit pros/cons, policy discussions, and analytical commentary with " +
      "stated conclusions are capped at ILR 2+. All six conditions must hold.",
  };
}

// ── ILR 3+ minimum gate ───────────────────────────────────────────────────────
//
// PREREQUISITE: ILR 3 gate must have passed (level3_confirmed == true).
// Two conditions must both be true simultaneously:
//   1. Sustained cross-paragraph abstraction — more pervasive than baseline ILR 3
//   2. Cross-paragraph inference — meaning built by connecting separate paragraphs

export function checkIlr3PlusGate(s, ilr3GatePassed) {
  if (!ilr3GatePassed) {
    return {
      gate:             "ILR_3PLUS_GATE",
      label:            "ILR 3+ minimum gate",
      passed:           false,
      threshold:        "all 2 of 2 (ILR 3 gate must pass first)",
      passCount:        0,
      totalConditions:  2,
      conditions:       {},
      failedConditions: ["ILR_3_GATE_PREREQUISITE_FAILED"],
      description:
        "ILR 3+ cannot be assigned unless ILR 3 is confirmed. " +
        "The ILR 3 gate did not pass, so ILR 3+ is blocked.",
    };
  }
  const conditions = {
    sustainedCrossParagraphAbstraction: !!s.sustainedAbstraction,
    crossParagraphInferenceDemand:      !!s.crossParagraphInference,
    implicitMeaningOrStance:            !!(s.implicitMeaning || s.stanceDetection),
  };
  const failedConditions = Object.entries(conditions).filter(([, v]) => !v).map(([k]) => k);
  const passed = failedConditions.length === 0;
  return {
    gate:             "ILR_3PLUS_GATE",
    label:            "ILR 3+ minimum gate",
    passed,
    threshold:        "all 3 of 3",
    passCount:        Object.values(conditions).filter(Boolean).length,
    totalConditions:  3,
    conditions,
    failedConditions,
    description:
      "ILR 3+ requires ILR 3 confirmed plus sustainedAbstraction, " +
      "crossParagraphInference, and either implicitMeaning or stanceDetection. " +
      "All three must hold.",
  };
}

// ── ILR 4 minimum gate ────────────────────────────────────────────────────────
//
// PREREQUISITE: ILR 3+ gate must have passed.
// All 3 conditions must be true (ILR 3+ confirmed is the prerequisite):
//   1. conceptualDensity   — multiple conceptual relations compressed into limited space
//   2. implicitMeaning     — substantial meaning is withheld and must be constructed
//   3. layeredReasoning    — sub-arguments mutually qualify each other

export function checkIlr4Gate(s, ilr3PlusGatePassed) {
  if (!ilr3PlusGatePassed) {
    return {
      gate:             "ILR_4_GATE",
      label:            "ILR 4 minimum gate",
      passed:           false,
      threshold:        "all 3 of 3 (ILR 3+ gate must pass first)",
      passCount:        0,
      totalConditions:  3,
      conditions:       {},
      failedConditions: ["ILR_3PLUS_GATE_PREREQUISITE_FAILED"],
      description:      "ILR 4 requires ILR 3+ to be confirmed first.",
    };
  }
  const conditions = {
    conceptualDensity: !!s.conceptualDensity,
    implicitMeaning:   !!s.implicitMeaning,
    layeredReasoning:  !!s.layeredReasoning,
  };
  const passCount        = Object.values(conditions).filter(Boolean).length;
  const failedConditions = Object.entries(conditions).filter(([, v]) => !v).map(([k]) => k);
  const passed = failedConditions.length === 0;
  return {
    gate:             "ILR_4_GATE",
    label:            "ILR 4 minimum gate",
    passed,
    threshold:        "all 3 of 3",
    passCount,
    totalConditions:  3,
    conditions,
    failedConditions,
    description:
      "ILR 4 requires ILR 3+ confirmed plus all 3: conceptualDensity, " +
      "implicitMeaning, and layeredReasoning.",
  };
}

// ── ILR 4+ minimum gate ───────────────────────────────────────────────────────
//
// PREREQUISITE: ILR 4 gate must have passed.
// Three conditions must all be true:
//   1. Rhetorical nuance — irony, understatement, deliberate ambiguity, implication
//   2. Stylistic sophistication — literary/disciplinary style choices carry meaning
//   3. Non-linear structure — layeredReasoning confirmed (same as ILR 4 requirement)

export function checkIlr4PlusGate(s, ilr4GatePassed) {
  if (!ilr4GatePassed) {
    return {
      gate:             "ILR_4PLUS_GATE",
      label:            "ILR 4+ minimum gate",
      passed:           false,
      threshold:        "all 3 of 3 (ILR 4 gate must pass first)",
      passCount:        0,
      totalConditions:  3,
      conditions:       {},
      failedConditions: ["ILR_4_GATE_PREREQUISITE_FAILED"],
      description:      "ILR 4+ requires ILR 4 to be confirmed first.",
    };
  }
  const conditions = {
    rhetoricalNuance:        !!s.rhetoricalNuance,
    stylisticSophistication: !!s.stylisticSophistication,
    nonLinearStructure:      !!s.layeredReasoning,
  };
  const failedConditions = Object.entries(conditions).filter(([, v]) => !v).map(([k]) => k);
  const passed = failedConditions.length === 0;
  return {
    gate:             "ILR_4PLUS_GATE",
    label:            "ILR 4+ minimum gate",
    passed,
    threshold:        "all 3 of 3",
    passCount:        Object.values(conditions).filter(Boolean).length,
    totalConditions:  3,
    conditions,
    failedConditions,
    description:
      "ILR 4+ requires rhetorical nuance (irony, understatement, strategic ambiguity), " +
      "stylistic sophistication (literary or disciplinary choices that carry meaning), and " +
      "confirmed non-linear discourse structure. All three must hold.",
  };
}

// ── ILR 5 minimum gate ────────────────────────────────────────────────────────
//
// PREREQUISITE: ILR 4+ gate must have passed.
// Three conditions must all be true:
//   1. Full native-speaker intellectual discourse — no scaffolding, no concession
//   2. Multiple simultaneous interpretive layers — text cannot be resolved to one reading
//   3. Complete absence of structural scaffolding — reader supplies all context

export function checkIlr5Gate(s, ilr4PlusGatePassed) {
  if (!ilr4PlusGatePassed) {
    return {
      gate:             "ILR_5_GATE",
      label:            "ILR 5 minimum gate",
      passed:           false,
      threshold:        "all 3 of 3 (ILR 4+ gate must pass first)",
      passCount:        0,
      totalConditions:  3,
      conditions:       {},
      failedConditions: ["ILR_4PLUS_GATE_PREREQUISITE_FAILED"],
      description:      "ILR 5 requires ILR 4+ to be confirmed first.",
    };
  }
  const conditions = {
    intellectualNativeDiscourse: !!s.intellectualNativeDiscourse,
    multiLayerMeaning:           !!s.multiLayerMeaning,
    noScaffolding:               !!s.noScaffolding,
  };
  const failedConditions = Object.entries(conditions).filter(([, v]) => !v).map(([k]) => k);
  const passed = failedConditions.length === 0;
  return {
    gate:             "ILR_5_GATE",
    label:            "ILR 5 minimum gate",
    passed,
    threshold:        "all 3 of 3",
    passCount:        Object.values(conditions).filter(Boolean).length,
    totalConditions:  3,
    conditions,
    failedConditions,
    description:
      "ILR 5 (the highest rating) requires full native-speaker intellectual discourse with " +
      "no scaffolding, multiple simultaneous interpretive layers that cannot be collapsed into " +
      "one reading, and complete absence of structural support. All three must hold.",
  };
}

// ── applyHardGates ────────────────────────────────────────────────────────────
//
// Main entry point.  Receives the level after ceiling/floor rules and the
// normalised signals object, then applies all gates in order from highest
// downward.  Each gate failure demotes the level by one step.
//
// Returns:
//   finalLevel    — the level after all gate checks
//   demotedFrom   — original level before any demotion (or null)
//   demotionSteps — number of levels demoted
//   gateLog       — ordered array of gate result objects

export function applyHardGates(proposedLevel, signals) {
  if (!LEVEL_CAPS.ENABLE_HARD_GATES) {
    return { finalLevel: proposedLevel, demotedFrom: null, demotionSteps: 0, gateLog: [] };
  }

  const s        = signals;
  const gateLog  = [];
  let finalLevel = proposedLevel;
  let demotedFrom = null;

  // ── ILR 1 characterisation (logged at all levels; demotion is conservative) ─
  const ilr1Result = checkIlr1Gate(s);
  // Only log ILR 1 gate when the final level is actually ILR 1 (or 0+) — it is
  // informational at higher levels.
  if (levelIndex(finalLevel) <= levelIndex("1")) {
    gateLog.push(ilr1Result);
    // Demote to 0+ only if no connected sentences exist at all AND gate fails.
    if (!ilr1Result.passed && s.noConnectedSentences && levelIndex(finalLevel) > levelIndex("0+")) {
      demotedFrom = finalLevel;
      finalLevel  = "0+";
    }
  }

  // ── ILR 1+ gate (applied when proposed level ≥ 1+) ───────────────────────
  if (levelIndex(finalLevel) >= levelIndex("1+")) {
    const result = checkIlr1PlusGate(s);
    gateLog.push(result);
    if (!result.passed && levelIndex(finalLevel) >= levelIndex("1+")) {
      demotedFrom = demotedFrom ?? finalLevel;
      finalLevel  = "1";
    }
  }

  // ── ILR 2 gate (applied when proposed level ≥ 2, after 1+ gate may demote) ─
  if (levelIndex(finalLevel) >= levelIndex("2")) {
    const result = checkIlr2Gate(s);
    gateLog.push(result);
    if (!result.passed) {
      demotedFrom = demotedFrom ?? finalLevel;
      finalLevel  = "1+";
      // Re-validate at ILR 1+.  The 1+ gate ran before the ILR 2 gate and
      // may have passed on surface connectivity (multipleSentencesConnected).
      // Now that ILR 2 has been rejected, re-check whether the routine-description
      // guard — or any other 1+ blocking condition — should further demote to ILR 1.
      const recheckResult = checkIlr1PlusGate(s);
      gateLog.push({
        ...recheckResult,
        gate:  "ILR_1PLUS_RECHECK",
        label: "ILR 1+ re-validation after ILR 2 gate failure",
      });
      if (!recheckResult.passed) {
        finalLevel = "1";
      }
    }
  }

  // ── ILR 2+ gate (applied when proposed level ≥ 2+, after 2 gate may demote) ─
  if (levelIndex(finalLevel) >= levelIndex("2+")) {
    const ilr2Passed = gateLog.find(g => g.gate === "ILR_2_GATE")?.passed ?? true;
    const result     = checkIlr2PlusGate(s, ilr2Passed);
    gateLog.push(result);
    if (!result.passed) {
      demotedFrom = demotedFrom ?? finalLevel;
      finalLevel  = "2";
    }
  }

  // ── ILR 3 discourse-depth gate (fires first — fast structural pre-check) ───
  //
  // Checks the four minimum structural prerequisites for ILR 3 discourse depth:
  //   1. Multi-paragraph structure (not a single paragraph or block)
  //   2. Non-linear layered reasoning (not sequential argument)
  //   3. Implicit meaning (not explicit/stated argument)
  //   4. Heavy inference demand (not limited or moderate)
  //
  // If ANY one fails: immediately demote to ILR 2+ and skip the full gate.
  // The demotion reason is: "ILR 3 conditions not fully met.
  //   Downgraded to ILR 2+ due to limited discourse depth."
  if (LEVEL_CAPS.ENABLE_3_GATE_CAP && levelIndex(finalLevel) >= levelIndex("3")) {
    const depthResult = checkIlr3DiscourseDepthGate(s);
    gateLog.push(depthResult);
    if (!depthResult.passed) {
      demotedFrom = demotedFrom ?? finalLevel;
      finalLevel  = "2+";
    }
  }

  // ── ILR 3 full gate (all 10 conditions) — only runs if depth gate passed ──
  // All ten conditions must pass simultaneously.  If any one fails, the
  // passage cannot sustain ILR 3 interpretive demand; demote to ILR 2+.
  if (LEVEL_CAPS.ENABLE_3_GATE_CAP && levelIndex(finalLevel) >= levelIndex("3")) {
    const result = checkIlr3Gate(s);
    gateLog.push(result);
    if (!result.passed) {
      demotedFrom = demotedFrom ?? finalLevel;
      finalLevel  = "2+";
    }
  }

  // ── ILR 3+ gate ──────────────────────────────────────────────────────────────
  // Requires ILR 3 confirmed + sustained_abstraction + cross_paragraph_inference.
  if (levelIndex(finalLevel) >= levelIndex("3+")) {
    const ilr3Passed = gateLog.find(g => g.gate === "ILR_3_GATE")?.passed ?? false;
    const result = checkIlr3PlusGate(s, ilr3Passed);
    gateLog.push(result);
    if (!result.passed) {
      demotedFrom = demotedFrom ?? finalLevel;
      finalLevel  = "3";
    }
  }

  // ── ILR 4 gate ───────────────────────────────────────────────────────────────
  // Requires ILR 3+ confirmed + layered_argument + implicit_stance + conceptual_density.
  if (levelIndex(finalLevel) >= levelIndex("4")) {
    const ilr3PlusPassed = gateLog.find(g => g.gate === "ILR_3PLUS_GATE")?.passed ?? false;
    const result = checkIlr4Gate(s, ilr3PlusPassed);
    gateLog.push(result);
    if (!result.passed) {
      demotedFrom = demotedFrom ?? finalLevel;
      finalLevel  = "3+";
    }
  }

  // ── ILR 4+ gate ──────────────────────────────────────────────────────────────
  // Requires ILR 4 confirmed + rhetorical_nuance + stylistic_sophistication + non_linear_structure.
  if (levelIndex(finalLevel) >= levelIndex("4+")) {
    const ilr4Passed = gateLog.find(g => g.gate === "ILR_4_GATE")?.passed ?? false;
    const result = checkIlr4PlusGate(s, ilr4Passed);
    gateLog.push(result);
    if (!result.passed) {
      demotedFrom = demotedFrom ?? finalLevel;
      finalLevel  = "4";
    }
  }

  // ── ILR 5 gate ───────────────────────────────────────────────────────────────
  // Requires ILR 4+ confirmed + intellectual_native_discourse + multi_layer_meaning + no_scaffolding.
  if (levelIndex(finalLevel) >= levelIndex("5")) {
    const ilr4PlusPassed = gateLog.find(g => g.gate === "ILR_4PLUS_GATE")?.passed ?? false;
    const result = checkIlr5Gate(s, ilr4PlusPassed);
    gateLog.push(result);
    if (!result.passed) {
      demotedFrom = demotedFrom ?? finalLevel;
      finalLevel  = "4+";
    }
  }

  const demotionSteps = demotedFrom
    ? Math.max(0, levelIndex(demotedFrom) - levelIndex(finalLevel))
    : 0;

  return { finalLevel, demotedFrom, demotionSteps, gateLog };
}
