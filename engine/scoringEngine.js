// ─────────────────────────────────────────────────────────────────────────────
// engine/scoringEngine.js
//
// Primary orchestrator for ILR placement.
//
// Pipeline — 8 explicit steps, identical for reading and listening:
//
//   Step 1 — FEATURE EXTRACTION
//             normalizeSignals + ls* synthesis (listening)
//
//   Step 2 — PROVISIONAL SCORE ESTIMATION
//             discourseFloor → gatedMinimumLevel
//             maxLevel(rawModelLevel, gatedMinimumLevel)
//             applyReadingCeilings / applyListeningRules
//             applyHardGates
//
//   Step 3 — ILR BOUNDARY ENGINE
//             applyBoundaryEngine — authoritative signal-based level decision
//
//   Step 4 — CONSISTENCY CHECK
//             checkConsistency — validates signal profile vs. assigned level;
//             produces a confidencePenalty; does NOT change the level
//
//   Step 5 — FINAL LEVEL ASSIGNMENT
//             finalLevel = boundaryEngine.finalLevel
//             (no numeric index or weighted average touches this value)
//
//   Step 6 — CONFIDENCE
//             computeConfidence (numeric) → computeConfidenceIndicator (label)
//             applies consistencyPenalty from Step 4
//
//   Step 7 — WHY NOT HIGHER LEVEL
//             computeWhyNotHigher — deterministic signal-based explanation
//
//   Step 8 — LISTENING DIFFICULTY  (listening mode only)
//             analyzeListeningDelivery — separate from ILR language level
//
// Steps 6–8 execute inside formatResult (resultFormatter.js), which receives
// all pipeline artifacts as parameters.  The modality adjustment (threeLayers /
// modalityAdjustment) is computed for report transparency only and does not
// feed back into finalLevel.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeSignals, discourseFloor, maxLevel, levelIndex } from "./ilrRules.js";
import {
  scoreVocabularyAbstraction,
  scoreDiscourseOrganization,
  scoreInference,
  scoreMainIdea,
  scoreSupportingDetail,
  scoreTonePurpose,
} from "./rubricEngine.js";
import { applyReadingCeilings, applyListeningRules } from "./modalityRules.js";
import { applyHardGates } from "./hardGates.js";
import { computeThreeLayers } from "./threeLayers.js";
import { computeModalityAdjustment } from "./modalityAdjustment.js";
import { applyBoundaryEngine } from "./boundaryEngine.js";
import { checkConsistency } from "./consistencyEngine.js";
import { analyzeListeningDelivery } from "./listeningDeliveryAnalysis.js";
import {
  buildJustification,
  injectMandatoryPhrases,
  buildScopeOfRating,
} from "./explanationEngine.js";
import { formatResult, isLow2PlusPattern } from "./resultFormatter.js";
import { LEVELS } from "../config/scoringConfig.js";

// ── applyFinalIlrCeiling ──────────────────────────────────────────────────────
//
// Last-step safeguard: clamps the final ILR level to the legal range [0+, 5].
// NO per-mode ceiling is applied here — all mode-specific discourse ceilings
// are handled upstream in modalityRules.js.
//
// To re-enable a hard ceiling (e.g. for a restricted scoring variant), change
// the maxLevel / minLevel constants below.  Do NOT add Math.min/max calls
// elsewhere in the pipeline.
//
// ── Short-passage score dampening ─────────────────────────────────────────
//
// Short passages give the model fewer surface features to evaluate, so raw
// rubric-proxy scores tend to be inflated relative to what a fuller text at
// the same level would earn.  Apply two graduated dampening tiers and a hard
// ceiling so that brevity cannot push a passage to a higher ILR level.
//
// Tier 1 (<120 words): moderate dampening
//   discourseScore     × 0.65 → capped at 3.4
//   abstractionScore   × 0.70 → capped at 3.6
//   sentenceComplexity × 0.75
//
// Tier 2 (<70 words): additional dampening (applied on top of tier 1)
//   discourseScore     × 0.55
//   abstractionScore   × 0.60
//   sentenceComplexity × 0.65
//
// Both tiers fire cumulatively for very-short passages (< 70 words).

function applyLengthDampening(scores = {}, passageWordCount = 0) {
  const adjusted = { ...scores };
  let dampeningApplied = false;
  let dampeningTier    = null;
  const notes          = [];

  if (!passageWordCount || typeof passageWordCount !== "number") {
    return { scores: adjusted, meta: { dampeningApplied: false, dampeningTier: null, notes: [] } };
  }

  // Tier 1: short passage (<120 words) — moderate dampening + hard ceilings.
  if (passageWordCount < 120) {
    dampeningApplied = true;
    dampeningTier    = "tier1";
    if (typeof adjusted.discourseScore    === "number") adjusted.discourseScore    = Math.min(adjusted.discourseScore    * 0.65, 3.4);
    if (typeof adjusted.abstractionScore  === "number") adjusted.abstractionScore  = Math.min(adjusted.abstractionScore  * 0.70, 3.6);
    if (typeof adjusted.sentenceComplexity === "number") adjusted.sentenceComplexity = adjusted.sentenceComplexity * 0.75;
    notes.push("Short passage length reduced discourse reliability; higher-level promotion was limited.");
  }

  // Tier 2: very short passage (<70 words) — applied on top of tier 1.
  if (passageWordCount < 70) {
    dampeningApplied = true;
    dampeningTier    = "tier2";
    if (typeof adjusted.discourseScore    === "number") adjusted.discourseScore    = Math.min(adjusted.discourseScore    * 0.55, 3.4);
    if (typeof adjusted.abstractionScore  === "number") adjusted.abstractionScore  = Math.min(adjusted.abstractionScore  * 0.60, 3.6);
    if (typeof adjusted.sentenceComplexity === "number") adjusted.sentenceComplexity = adjusted.sentenceComplexity * 0.65;
    notes.push("Very short passage length further reduced confidence in sustained higher-level discourse.");
  }

  return { scores: adjusted, meta: { dampeningApplied, dampeningTier, notes } };
}

function applyFinalIlrCeiling(level, _mode = "reading") {
  const MIN_ILR = LEVELS[0];                   // "0+"
  const MAX_ILR = LEVELS[LEVELS.length - 1];   // "5"

  const idx    = LEVELS.indexOf(level);
  const minIdx = LEVELS.indexOf(MIN_ILR);
  const maxIdx = LEVELS.indexOf(MAX_ILR);

  if (idx < 0)       return MAX_ILR;            // unknown level → clamp to max (will surface as anomaly)
  if (idx > maxIdx)  return MAX_ILR;
  if (idx < minIdx)  return MIN_ILR;
  return level;
}

// ── clampLevelJump ────────────────────────────────────────────────────────────
//
// Prevents the boundary engine from jumping more than 1 level-index step above
// the pre-boundary provisional level.  Both arguments are numeric level indices
// (LEVELS.indexOf(level)).  Returns a clamped numeric index.
//
function clampLevelJump(baseLevel, boundaryLevel) {
  const maxJump = 1;
  if (boundaryLevel > baseLevel + maxJump) {
    return baseLevel + maxJump;
  }
  return boundaryLevel;
}

// ── applyFinalPlacement ───────────────────────────────────────────────────────
//
// Takes a raw model result object (direct JSON from the AI model) and a mode
// string ("reading" | "listening"), and returns the final structured result.
//
// The model result must conform to the JSON schema defined in prompts.js.

export function applyFinalPlacement(modelResult, mode = "reading") {

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 1 — FEATURE EXTRACTION
  // ════════════════════════════════════════════════════════════════════════════
  //
  // normalizeSignals coerces the model's detectedSignals object into a uniform
  // boolean set used by every downstream module.
  //
  // For listening, ls* structural classifiers (lsStructure, lsInference,
  // lsDiscourseLength) are synthesized into the same boolean signal set so
  // that the boundary engine, hard gates, and consistency check run on
  // identical inputs regardless of modality.

  const rawModelLevel = modelResult.rawModelLevel || "1+";
  const discourseType = modelResult.discourseType  || "simple description";
  const signals       = normalizeSignals(modelResult.detectedSignals || {});

  if (mode === "listening") {
    const lsStr  = (modelResult.lsStructure       || "").toLowerCase().trim();
    const lsInf  = (modelResult.lsInference       || "").toLowerCase().trim();
    const lsDisc = (modelResult.lsDiscourseLength || "").toLowerCase().trim();

    if (lsStr === "analytical" && lsInf === "significant" && lsDisc === "extended") {
      // ILR 3 listening — full discourse-depth signal set
      signals.multiparagraphArgument  = true;
      signals.paragraphDependency     = true;
      signals.layeredReasoning        = true;
      signals.implicitMeaning         = true;
      signals.heavyInference          = true;
      signals.abstractReasoning       = true;
      signals.stanceDetection         = true;
      signals.nuancedPerspective      = true;
      signals.significantInference    = true;
      signals.conceptualVocabulary    = true;
      signals.embeddedStructure       = true;
      signals.paragraphLevelDiscourse = true;
      signals.detailIntegration       = true;
      signals.multipleDistinctIdeas   = true;
      signals.crossSentenceDependency = true;
      signals.isExplanatoryText       = false;
      signals.isSimpleArgument        = false;
    } else if (lsStr === "analytical" &&
               (lsInf === "significant" || lsInf === "moderate")) {
      // ILR 2+ listening — stance and inference signals
      signals.stanceDetection         = true;
      signals.significantInference    = signals.significantInference || lsInf === "significant";
      signals.moderateInference       = signals.moderateInference    || lsInf === "moderate";
      signals.paragraphDependency     = true;
      signals.paragraphLevelDiscourse = true;
      signals.detailIntegration       = true;
      signals.multipleDistinctIdeas   = true;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 2 — PROVISIONAL SCORE ESTIMATION
  // ════════════════════════════════════════════════════════════════════════════
  //
  // Gate pipeline: discourse floor → modality ceiling/floor rules → hard gates.
  // The result is a provisionalLevel — the best signal-constrained estimate
  // before the boundary engine makes its authoritative ruling.

  // 2a. Discourse floor
  const {
    gatedMinimumLevel,
    gateTriggered,
    floorReason,
  } = discourseFloor(discourseType, signals);

  // 2b. Apply floor to raw model level
  let provisionalLevel = maxLevel(rawModelLevel, gatedMinimumLevel);

  // 2c. Modality ceiling / floor rules
  let ceilingApplied        = false;
  let ceilingLabel          = null;
  let ceilingReason         = null;
  let listeningFloorApplied = false;
  let listeningFloorLabel   = null;
  let listeningFloorReason  = null;

  if (mode === "reading") {
    const reading    = applyReadingCeilings(provisionalLevel, discourseType, signals);
    provisionalLevel = reading.finalLevel;
    ceilingApplied   = reading.ceilingApplied;
    ceilingLabel     = reading.ceilingLabel;
    ceilingReason    = reading.ceilingReason;
  }

  let _listeningDebug = null;

  if (mode === "listening") {
    const listening       = applyListeningRules(provisionalLevel, modelResult);
    provisionalLevel      = listening.finalLevel;
    ceilingApplied        = listening.ceilingApplied;
    ceilingLabel          = listening.ceilingLabel;
    ceilingReason         = listening.ceilingReason;
    listeningFloorApplied = listening.listeningFloorApplied;
    listeningFloorLabel   = listening.listeningFloorLabel;
    listeningFloorReason  = listening.listeningFloorReason;
    _listeningDebug       = listening._debug ?? null;

    // Emit pre-boundary trace so enum mismatches are visible in logs
    console.log(
      "[SmartILR][LISTEN-PRE-BOUNDARY]" +
      ` lsDiscourseLength_raw="${_listeningDebug?.lsDiscourseLength_raw}"` +
      ` lsDiscourseLength_used="${_listeningDebug?.lsDiscourseLength_used}"` +
      ` lsInference_raw="${_listeningDebug?.lsInference_raw}"` +
      ` lsInference_used="${_listeningDebug?.lsInference_used}"` +
      ` lsStructure_used="${_listeningDebug?.lsStructure_used}"` +
      ` levelIn="${_listeningDebug?.levelIn}"` +
      ` levelAfterRules="${provisionalLevel}"` +
      ` CEILING_4_FIRED=${_listeningDebug?.CEILING_4_FIRED}` +
      ` CEILING_8_FIRED=${_listeningDebug?.CEILING_8_FIRED}` +
      ` CEILING_1_FIRED=${_listeningDebug?.CEILING_1_FIRED}` +
      ` CEILING_2_FIRED=${_listeningDebug?.CEILING_2_FIRED}` +
      ` CEILING_3_FIRED=${_listeningDebug?.CEILING_3_FIRED}` +
      ` CEILING_5_FIRED=${_listeningDebug?.CEILING_5_FIRED}` +
      ` CEILING_6_FIRED=${_listeningDebug?.CEILING_6_FIRED}` +
      ` CEILING_7_FIRED=${_listeningDebug?.CEILING_7_FIRED}` +
      ` FLOOR_A_FIRED=${_listeningDebug?.FLOOR_A_FIRED}` +
      ` FLOOR_B_FIRED=${_listeningDebug?.FLOOR_B_FIRED}` +
      ` FLOOR_C_FIRED=${_listeningDebug?.FLOOR_C_FIRED}`
    );
  }

  // 2d. Hard gate checks
  const {
    finalLevel: hardGatedLevel,
    demotedFrom:   hardGateDemotedFrom,
    demotionSteps: hardGateDemotionSteps,
    gateLog:       hardGateLog,
  } = applyHardGates(provisionalLevel, signals);

  provisionalLevel = hardGatedLevel;

  // Whether the gate pipeline raised the level above the raw model estimate
  const hardFloorApplied = levelIndex(provisionalLevel) > levelIndex(rawModelLevel);

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 3 — ILR BOUNDARY ENGINE
  // ════════════════════════════════════════════════════════════════════════════
  //
  // Walks the six ILR level-transition boundaries bottom-up and returns the
  // highest level the passage clearly crosses.  This is the authoritative
  // signal-based level decision.  When the gate pipeline and the boundary
  // conditions disagree, the boundary level wins.
  //
  // No numeric index, weighted average, or modality adjustment feeds into
  // this step.  The boundary conditions are purely Boolean signal checks.

  const boundaryResult = applyBoundaryEngine(provisionalLevel, signals, mode);
  const boundaryLevel  = boundaryResult.finalLevel;

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 5 — FINAL LEVEL ASSIGNMENT
  // ════════════════════════════════════════════════════════════════════════════
  //
  // finalLevel = clampLevelJump(gateLevel, boundaryLevel)
  //
  // The boundary engine is authoritative but cannot jump more than one
  // level-index step above the hard-gate result (gateLevel = hardGatedLevel).
  // boundaryLevel is preserved as the raw (unclamped) boundary engine output
  // for audit transparency in the report.

  let finalLevel = LEVELS[
    clampLevelJump(levelIndex(hardGatedLevel), levelIndex(boundaryLevel))
  ] ?? boundaryLevel;

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 5b — ROUTINE DESCRIPTION MINIMUM GATE
  // ════════════════════════════════════════════════════════════════════════════
  //
  // Safety net: if the passage is a routine-description-only text
  // (noMultiSentenceIntegration + minimalCohesion + no genuine dependency or
  // inference signal), it cannot be ILR 2 or above.
  //
  // The ILR 2 gate in hardGates.js already enforces this.  This step is an
  // explicit final-pass safety net that catches any case where the gate was
  // bypassed or the level was re-elevated after gate processing.
  //
  // If triggered, finalLevel is clamped to "1+" and the 1+ gate re-validates
  // to potentially demote further to "1".
  //
  // This prevents the logical contradiction where the report text says the
  // passage does not meet ILR 2 criteria while the assigned level is "2".

  let ilr2RoutineCeilingApplied = false;

  if (levelIndex(finalLevel) >= levelIndex("2")) {
    const isRoutineDescriptionOnly =
      signals.noMultiSentenceIntegration &&
      signals.minimalCohesion            &&
      !signals.crossSentenceDependency   &&
      !signals.moderateInference;

    if (isRoutineDescriptionOnly) {
      ilr2RoutineCeilingApplied = true;
      finalLevel = "1+";
      // Further demote to ILR 1: same guard as checkIlr1PlusGate.
      // Temporal sequence alone ("then", "after") does NOT warrant ILR 1+;
      // only genuine relationship bonds (causal, contrastive, explanatory),
      // cross-sentence dependency, or bridging inference justify 1+.
      const isRoutineDescriptionOnly1Plus =
        signals.noMultiSentenceIntegration &&
        signals.minimalCohesion            &&
        !signals.crossSentenceDependency   &&
        !signals.explicitRelationships     &&
        !signals.moderateInference;
      if (isRoutineDescriptionOnly1Plus) {
        finalLevel = "1";
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 5c — TEMPORAL-ONLY CEILING (ILR 1 hard cap)
  // ════════════════════════════════════════════════════════════════════════════
  //
  // A passage is "temporal-only" when its apparent cohesion comes exclusively
  // from chronological ordering markers ("then", "after", "at noon", "later",
  // "in the morning", "finally") — no genuine cross-sentence processing is
  // required.  Each event or action is independently intelligible.
  //
  // The previous guards (Steps 5b, checkIlr1PlusGate) rely on the model
  // correctly setting minimalCohesion=true and noMultiSentenceIntegration=true.
  // When the model treats temporal markers as cohesive devices and sets those
  // flags incorrectly, those guards do not fire.
  //
  // This step is a model-error-resistant fallback: it evaluates temporalOnly
  // from the presence/absence of genuine ILR 1+ signals, INDEPENDENT of
  // minimalCohesion and multipleSentencesConnected.  It then confirms low
  // complexity using rubric-score proxies at a fixed ILR 1 base level
  // (avoiding circular dependency) before clamping finalLevel to "1".
  //
  // Conditions (all must be true):
  //   temporalOnly: (chronologicalSequence OR multipleSentencesConnected) AND
  //                 no genuine ILR 1+ signal present
  //   abstraction:  scoreVocabularyAbstraction(signals, "1") < 1.2
  //                 → no abstractReasoning, conceptualVocabulary, or layeredReasoning
  //   discourseLength: scoreDiscourseOrganization(signals, "1") < 1.8
  //                 → no multi-paragraph development combination

  let temporalOnlyCeilingApplied = false;

  if (levelIndex(finalLevel) > levelIndex("1")) {
    // temporalOnly: the passage's only apparent cohesion is temporal/thematic
    // ordering — no genuine cross-sentence processing required.
    const temporalOnly =
      (signals.chronologicalSequence || signals.multipleSentencesConnected) &&
      !signals.crossSentenceDependency  &&
      !signals.explicitRelationships    &&
      !signals.moderateInference        &&
      !signals.significantInference     &&
      !signals.detailIntegration        &&
      !signals.paragraphLevelDiscourse  &&
      !signals.factualReportingChain    &&
      !signals.paragraphDependency;

    // Rubric proxy scores computed at a FIXED "1" base level to avoid
    // circular dependency.  Thresholds from user spec:
    //   abstraction    < 1.2 → no abstractReasoning (+0.9), conceptualVocabulary (+0.7),
    //                          or layeredReasoning (+0.4) — all would push score ≥ 1.4
    //   discourseLength < 1.8 → not having multi-paragraph signal combinations that
    //                           sum to ≥ 0.8 above the 1.0 base
    const abstractionScore    = scoreVocabularyAbstraction(signals, "1");
    const discourseLengthScore = scoreDiscourseOrganization(signals, "1");

    if (temporalOnly && abstractionScore < 1.2 && discourseLengthScore < 1.8) {
      temporalOnlyCeilingApplied = true;
      finalLevel = "1";
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 5a — EXPLANATORY / SIMPLE-ARGUMENT HARD CEILING
  // ════════════════════════════════════════════════════════════════════════════
  //
  // If the passage has been flagged as explanatory text (isExplanatoryText) or
  // a simple explicit argument (isSimpleArgument), it cannot be ILR 3 or above.
  // The prompt and hard gates already enforce this signal-by-signal, but as a
  // final safety net: any candidate level ≥ "3" is clamped to "2+" here.
  // This converts the consistency-engine diagnostic warning into a hard ceiling.
  // ILR 3+ and above are unaffected as long as neither exclusion flag is set.

  let exclusionCeilingApplied = false;
  let exclusionCeilingReason  = null;

  if (levelIndex(finalLevel) >= levelIndex("3") &&
      (signals.isExplanatoryText || signals.isSimpleArgument)) {
    exclusionCeilingApplied = true;
    exclusionCeilingReason  =
      signals.isExplanatoryText && signals.isSimpleArgument
        ? "Both isExplanatoryText and isSimpleArgument are true — passage is an " +
          "explicit argument or explanatory text; ILR 3 cannot be assigned. " +
          "Level capped at ILR 2+."
        : signals.isExplanatoryText
          ? "isExplanatoryText=true — passage primary function is explanation or " +
            "structured argumentation; ILR 3 cannot be assigned. Level capped at ILR 2+."
          : "isSimpleArgument=true — passage presents a clear explicit argument " +
            "with stated claim, evidence, and conclusion; ILR 3 cannot be assigned. " +
            "Level capped at ILR 2+.";
    finalLevel = "2+";
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 5d — ILR 3 DISCOURSE-DEPTH CALIBRATION
  // ════════════════════════════════════════════════════════════════════════════
  //
  // ILR 3 requires strong evidence across all defining discourse dimensions.
  // If the final level is "3" but any of the seven rubric-score proxies falls
  // below its ILR-3 threshold, the passage does not fully satisfy the defining
  // Level 3 discourse features and is demoted to "2+".
  //
  // Scores are computed at a fixed "3" baseline (levelBase = 3.4).
  // Thresholds match the calibration spec:
  //   abstractionScore     < 4     (requires abstractReasoning or conceptualVocabulary)
  //   inferenceDemand      < 3     (requires at least moderate inference signals)
  //   discourseLengthScore < 3     (requires multi-paragraph organisation)
  //   sentenceComplexityScore < 3  (requires paragraph-level main-idea development)
  //   cohesionScore        < 3     (requires cross-sentence dependency or detail integration)
  //   argumentDepth        <= 2    (requires nuanced stance or layered reasoning)
  //   viewpointCount       <= 1    (requires at least two distinct perspective signals)

  let ilr3CalibrationApplied = false;

  if (finalLevel === "3") {
    const wordCount = modelResult.passageWordCount || Infinity;

    let abstractionScore_3      = scoreVocabularyAbstraction(signals, "3", modelResult);
    let inferenceDemand_3       = scoreInference(signals, "3");
    let discourseLengthScore_3  = scoreDiscourseOrganization(signals, "3");
    let sentenceComplexityScore = scoreMainIdea(signals, "3");
    const cohesionScore_3       = scoreSupportingDetail(signals, "3");
    const argumentDepth_3       = scoreTonePurpose(signals, "3");
    const viewpointCount_3      = [
      signals.nuancedPerspective,
      signals.stanceDetection,
      signals.multiparagraphArgument,
      signals.layeredReasoning,
    ].filter(Boolean).length;

    // Apply length dampening to the three length-sensitive scores before
    // checking the ILR-3 thresholds.  Short passages have fewer features for
    // the model to evaluate, so raw scores are reliably inflated.
    const damped3 = applyLengthDampening({
      discourseScore:    discourseLengthScore_3,
      abstractionScore:  abstractionScore_3,
      sentenceComplexity: sentenceComplexityScore,
    }, wordCount);
    discourseLengthScore_3  = damped3.scores.discourseScore;
    abstractionScore_3      = damped3.scores.abstractionScore;
    sentenceComplexityScore = damped3.scores.sentenceComplexity;
    if (damped3.meta.dampeningApplied) modelResult.lengthDampening = damped3.meta;

    if (
      abstractionScore_3      < 4  ||
      inferenceDemand_3       < 3  ||
      discourseLengthScore_3  < 3  ||
      sentenceComplexityScore < 3  ||
      cohesionScore_3         < 3  ||
      argumentDepth_3         <= 2 ||
      viewpointCount_3        <= 1
    ) {
      ilr3CalibrationApplied = true;
      finalLevel = "2+";
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 5e — LEVEL 2 → 2+ PROMOTION
  // ════════════════════════════════════════════════════════════════════════════
  //
  // Promotes Level 2 to 2+ when the rubric profile shows explicit cross-sentence
  // analytical linking that pushes the passage above routine ILR 2.
  //
  // Weighted: each of the four signal checks contributes one point.
  // Promotion fires when at least 3 of the 4 are satisfied (majority).
  //
  //   cohesionScore    >= 3.2   — strong cross-sentence dependency and detail integration
  //   abstractionScore >= 3.4   — vocabulary and reasoning above routine ILR 2
  //   connector check           — at least one form of explicit cross-sentence linking
  //                               (connectorCount≥2, contrastive, or causal bond)
  //   inferenceDemand  >= 2     — some inferential load required of the reader
  //
  // Connector sub-signals are derived from the existing signals schema:
  //   connectorCount  ← count of distinct cross-sentence bonding signals
  //                     (explicitRelationships + multipleSentencesConnected)
  //   hasContrast     ← explicitRelationships covers contrastive relations
  //   hasCauseEffect  ← explicitRelationships covers causal relations

  if (finalLevel === "2") {
    const wordCount2       = modelResult.passageWordCount || Infinity;
    const cohesionScore_2  = scoreSupportingDetail(signals, "2");
    const inferenceDemand_2 = scoreInference(signals, "2");

    // Apply length dampening to abstraction before testing the promotion gate.
    const damped2 = applyLengthDampening({
      abstractionScore: scoreVocabularyAbstraction(signals, "2", modelResult),
    }, wordCount2);
    const abstractionScore_2 = damped2.scores.abstractionScore;
    if (damped2.meta.dampeningApplied && !modelResult.lengthDampening) {
      modelResult.lengthDampening = damped2.meta;
    }

    const connectorCount = (signals.explicitRelationships     ? 1 : 0) +
                           (signals.multipleSentencesConnected ? 1 : 0);
    const hasContrast    = !!signals.explicitRelationships;
    const hasCauseEffect = !!signals.explicitRelationships;

    let promoteScore = 0;
    if (cohesionScore_2    >= 3.2)                                    promoteScore++;
    if (abstractionScore_2 >= 3.4)                                    promoteScore++;
    if (connectorCount >= 2 || hasContrast || hasCauseEffect)         promoteScore++;
    if (inferenceDemand_2  >= 2)                                      promoteScore++;

    if (promoteScore >= 3) {
      finalLevel = "2+";
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // POST-BOUNDARY LISTENING CEILING RE-ENFORCEMENT
  // ════════════════════════════════════════════════════════════════════════════
  //
  // applyListeningRules() runs BEFORE the boundary engine and all signal-based
  // promotion gates (Steps 5a–5e above).  Those steps re-derive a level from
  // signals and can override the ceiling even when it correctly fired.
  //
  // The ILR 2→2+ promotion gate (Step 5e) is the primary offender: it takes
  // finalLevel="2" (correctly capped) and re-promotes to "2+" based on
  // cohesion/abstraction/connector signal scores that don't know about the
  // listening ceiling.
  //
  // This guard is the authoritative enforcement point for CEILING-8.  It reads
  // lsDiscourseLength and lsInference directly from modelResult (the same values
  // applyListeningRules used) and re-applies the ceiling unconditionally after
  // all promotion gates have run.
  //
  // Gate conditions (identical to CEILING-8 in modalityRules.js):
  //   • mode === "listening"             — only for listening passages
  //   • lsDiscourseLength ≠ "extended"  — not a sustained multi-segment sample
  //   • lsInference ≠ "significant"     — listener not constructing implicit meaning
  //   • finalLevel > ILR 2              — ceiling is actually needed
  if (mode === "listening") {
    const _lsDL  = (modelResult.lsDiscourseLength || "").toLowerCase().trim();
    const _lsInf = (modelResult.lsInference       || "").toLowerCase().trim();

    const _ceiling8PostNeeded =
      _lsDL !== "extended" &&
      _lsInf !== "significant" &&
      levelIndex(finalLevel) > levelIndex("2");

    console.log(
      "[SmartILR][CEILING-8-POST]" +
      ` lsDiscourseLength="${_lsDL}"` +
      ` lsInference="${_lsInf}"` +
      ` finalLevelBeforeCap="${finalLevel}"` +
      ` CEILING_8_POST_FIRES=${_ceiling8PostNeeded}`
    );

    if (_ceiling8PostNeeded) {
      finalLevel     = "2";
      ceilingApplied = true;
      ceilingLabel   = "CEILING-8";
      ceilingReason  =
        `[Post-boundary enforcement] The spoken sample is short or paragraph-level ` +
        `(lsDiscourseLength: ${_lsDL}) with non-significant inference demand ` +
        `(lsInference: ${_lsInf}). Signal-based promotion gates ran after the ` +
        "pre-boundary listening ceiling and re-promoted the level; this guard " +
        "re-enforces the ceiling. ILR 2+ requires sustained analytical organization, " +
        "evaluative stance, and elevated inference demand throughout the full discourse. " +
        "Maximum level is ILR 2.";
    }
  }

  // Log final level for listening trace
  if (mode === "listening") {
    console.log(
      "[SmartILR][LISTEN-FINAL]" +
      ` FINAL_LEVEL_BEFORE_RENDER="${finalLevel}"` +
      ` ceilingApplied=${ceilingApplied}` +
      ` ceilingLabel="${ceilingLabel}"`
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 5f — SHORT-PASSAGE STRUCTURAL CAP
  // ════════════════════════════════════════════════════════════════════════════
  //
  // Passages shorter than 60 words cannot reliably demonstrate the sustained
  // discourse features that ILR 2 or above requires.  If the rubric proxy
  // scores at the "2" baseline also confirm low complexity, the level is hard-
  // capped at "1+" regardless of what earlier steps assigned.
  //
  // Conditions (ALL must be true):
  //   passageWordCount < 70
  //   discourseScore   < 2   (scoreDiscourseOrganization at "2" baseline)
  //   abstractionScore < 2   (scoreVocabularyAbstraction  at "2" baseline)
  //   sentenceComplexity < 2.2  (scoreMainIdea at "2" baseline)
  //
  // Cap target: "1+" — not "1", because a sub-70-word passage can still show
  // sentence-to-sentence linking that warrants the plus.

  let shortPassageCapApplied = false;

  if (levelIndex(finalLevel) >= levelIndex("2")) {
    const spWordCount = modelResult.passageWordCount;
    if (typeof spWordCount === "number" && spWordCount < 70) {
      const spDisc  = scoreDiscourseOrganization(signals, "2");
      const spAbst  = scoreVocabularyAbstraction(signals, "2", modelResult);
      const spSent  = scoreMainIdea(signals, "2");

      if (spDisc < 2 && spAbst < 2.5 && spSent < 2.2) {
        finalLevel = "1+";
        shortPassageCapApplied = true;
        console.log(
          `[SmartILR] SHORT_PASSAGE_CAP: wordCount=${spWordCount}` +
          ` disc=${spDisc.toFixed(2)} abst=${spAbst.toFixed(2)} sent=${spSent.toFixed(2)}` +
          ` → capped at 1+`
        );
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 4 — CONSISTENCY CHECK
  // ════════════════════════════════════════════════════════════════════════════
  //
  // Validates that the clamped final level is internally consistent with
  // the dominant signal cluster.  Detects assignments that sit at odds with
  // the overall evidence pattern (e.g., 2+ assigned but no multi-paragraph
  // structure signals present).
  //
  // Output: { consistent, warnings, confidencePenalty, note }
  // The confidencePenalty (0–0.20) is forwarded to Step 6.
  // The level is NOT changed here.

  const consistencyResult = checkConsistency(finalLevel, signals);

  // ── Modality dimension scores (audit / report transparency only) ─────────
  //
  // computeThreeLayers and computeModalityAdjustment are retained exclusively
  // for the instructor-facing report.  Their numeric outputs do NOT feed back
  // into finalLevel, confidence, or any downstream gate.
  const threeLayers = computeThreeLayers(signals, modelResult, mode);

  const modalityAdj = mode === "listening"
    ? {
        adjustedLevel:             finalLevel, // unchanged — delivery rated separately
        adjustment:                0,
        modalityIndex:             0,
        contributingFactors:       [],
        modalityExplanation:
          "Listening mode: delivery conditions are rated separately as Listening " +
          "Delivery Difficulty (Easy / Moderate / Difficult) and do not affect the " +
          "ILR language level. The ILR level reflects linguistic complexity only.",
        modalityDimensionScores:   {},
        modalityAdjustmentApplied: false,
        modalityAdjustmentReason:  null,
      }
    : computeModalityAdjustment(
        finalLevel,
        threeLayers.modalityDifficulty,
        mode,
        ceilingApplied
      );
  // NOTE: modalityAdj.adjustedLevel is intentionally NOT written back to
  // finalLevel.  The field is present only for audit transparency in the report.

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 6 — CONFIDENCE
  // (executed inside formatResult → computeConfidenceIndicator)
  // ════════════════════════════════════════════════════════════════════════════
  //
  // Passes consistencyResult.confidencePenalty so the consistency check can
  // reduce confidence without touching the level.

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 7 — WHY NOT HIGHER LEVEL
  // (executed inside formatResult → computeWhyNotHigher)
  // ════════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════════
  // STEP 8 — LISTENING DIFFICULTY  (listening mode only)
  // (executed inside formatResult → analyzeListeningDelivery)
  // ════════════════════════════════════════════════════════════════════════════
  //
  // Evaluates seven delivery dimensions independently of the ILR language level.
  // The result is a separate Listening Difficulty label (Easy / Moderate /
  // Difficult) that appears as its own section in the report.
  const deliveryAnalysis = mode === "listening"
    ? analyzeListeningDelivery(modelResult)
    : null;

  const scopeOfRating = buildScopeOfRating(mode);

  // ── Final ceiling safeguard ──────────────────────────────────────────────
  // Clamps to legal ILR range [0+, 5]. No per-mode ceiling here — all
  // discourse ceilings were already applied upstream in modalityRules.js.
  finalLevel = applyFinalIlrCeiling(finalLevel, mode);

  // ════════════════════════════════════════════════════════════════════════════
  // FINAL LOW LEVEL SAFETY CAP
  // ════════════════════════════════════════════════════════════════════════════
  //
  // Hard cap that runs AFTER every gate, boundary engine pass, and ceiling
  // safeguard.  Unlike Step 5c (which detects temporal-only passages by
  // requiring positive temporal signals), this cap is purely ABSENCE-based:
  // it does not require chronologicalSequence or multipleSentencesConnected
  // to be set.  It fires whenever ALL structural complexity signals are absent
  // AND the rubric proxy scores at a fixed ILR 1 base confirm low complexity.
  //
  // Mapping from user-spec pseudo-conditions:
  //   noCauseEffect             → !signals.explicitRelationships
  //   noContrast                → !signals.explicitRelationships
  //   noExplanation             → !signals.explicitRelationships
  //   noSupportingDetailStructure → !signals.detailIntegration &&
  //                                  !signals.paragraphLevelDiscourse
  //   passageType "simple narration" → !signals.multiparagraphArgument &&
  //                                    !signals.stanceDetection        &&
  //                                    !signals.layeredReasoning
  //   discourseLength < 1.8    → scoreDiscourseOrganization(signals,"1") < 1.8
  //   abstraction    < 1.2    → scoreVocabularyAbstraction(signals,"1")  < 1.2
  // ════════════════════════════════════════════════════════════════════════════
  {
    const capDiscourseScore   = scoreDiscourseOrganization(signals, "1");
    const capAbstractionScore = scoreVocabularyAbstraction(signals, "1");

    const LOW_LEVEL_CAP_APPLIED =
      levelIndex(finalLevel) > levelIndex("1") &&
      !signals.explicitRelationships   &&
      !signals.detailIntegration       &&
      !signals.paragraphLevelDiscourse &&
      !signals.multiparagraphArgument  &&
      !signals.stanceDetection         &&
      !signals.layeredReasoning        &&
      capDiscourseScore   < 1.8        &&
      capAbstractionScore < 1.2;

    console.log(
      `[SmartILR] LOW_LEVEL_CAP_APPLIED=${LOW_LEVEL_CAP_APPLIED}` +
      ` | finalLevel=${finalLevel}` +
      ` | discourse=${capDiscourseScore.toFixed(2)}` +
      ` | abstraction=${capAbstractionScore.toFixed(2)}` +
      ` | explicitRelationships=${!!signals.explicitRelationships}` +
      ` | detailIntegration=${!!signals.detailIntegration}` +
      ` | paragraphLevelDiscourse=${!!signals.paragraphLevelDiscourse}` +
      ` | multiparagraphArgument=${!!signals.multiparagraphArgument}` +
      ` | stanceDetection=${!!signals.stanceDetection}` +
      ` | layeredReasoning=${!!signals.layeredReasoning}`
    );

    if (LOW_LEVEL_CAP_APPLIED) {
      finalLevel = "1";
      temporalOnlyCeilingApplied = true;
    }
  }

  // ── Explanation layer ────────────────────────────────────────────────────
  // Built AFTER the final low-level cap so that mandatory phrases always
  // reflect the definitive finalLevel (not the pre-cap value).
  // For ILR 3 and above, buildJustification() is the authoritative source.
  // For levels below 3, the model's own text is used with mandatory phrase injection.
  // Exception: when the short-passage structural cap fired, a deterministic
  // factual-brief justification replaces the model's text entirely so no
  // contradictory "does not reach 1+" or inflated abstraction language appears.
  const UPPER_BAND = new Set(["3", "3+", "4", "4+", "5"]);
  const baseJustification = shortPassageCapApplied
    ? "The passage is rated at ILR Level 1+ because it is a short factual report with explicitly stated information and minimal inferencing demands. The reader primarily follows directly stated events and relationships without needing to reconstruct unstated connections."
    : UPPER_BAND.has(finalLevel)
      ? buildJustification(finalLevel, signals)
      : (modelResult.ilrDescriptorJustification || "");
  const ilrDescriptorJustification = injectMandatoryPhrases(
    finalLevel,
    baseJustification
  );

  // ── Assemble result ──────────────────────────────────────────────────────
  return formatResult(modelResult, {
    finalLevel,
    rawModelLevel,
    gatedMinimumLevel,
    gateTriggered,
    floorReason,
    hardFloorApplied,
    ceilingApplied,
    ceilingLabel,
    ceilingReason,
    listeningFloorApplied,
    listeningFloorLabel,
    listeningFloorReason,
    _listeningDebug,
    ilrDescriptorJustification,
    scopeOfRating,
    hardGateLog,
    hardGateDemotedFrom,
    hardGateDemotionSteps,
    threeLayers,
    modalityAdj,
    mode,
    boundaryApplied: boundaryResult?.boundaryApplied ?? false,
    consistencyResult,   // Step 4 output — forwarded to confidence (Step 6)
    deliveryAnalysis,
    exclusionCeilingApplied,
    exclusionCeilingReason,
    ilr2RoutineCeilingApplied,
    temporalOnlyCeilingApplied,
    shortPassageCapApplied,
  });
}
