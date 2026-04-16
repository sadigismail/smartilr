// ─────────────────────────────────────────────────────────────────────────────
// engine/resultFormatter.js
//
// Structures the final API response object.  All output fields are assembled
// here, including computed confidence score and dimension scores.
//
// Change this file to add, rename, or reorder response fields without touching
// gate or scoring logic.
// ─────────────────────────────────────────────────────────────────────────────

import { CONFIDENCE_WEIGHTS, CONFIDENCE_CAPS } from "../config/scoringConfig.js";
import { levelIndex, levelToFloat } from "./ilrRules.js";
import { buildLevelSummary, finalizeReport } from "./explanationEngine.js";
import { computeThreeLayers } from "./threeLayers.js"; // fallback if not pre-computed
import { computeNumericScoring } from "./numericScoring.js";
import { computeItemDifficulty } from "./itemDifficulty.js";
import {
  computeReadingBranch,
  computeListeningBranch,
  buildCrossModalityNote,
} from "./modalityBranches.js";
import { computeRubricJustification } from "./rubricEngine.js";
import { computeConfidenceIndicator } from "./confidenceEngine.js";
import { computeWhyNotHigher } from "./whyNotHigher.js";

// ── Safe report payload ───────────────────────────────────────────────────────
//
// ILR_LABELS and SAFE_LEVEL_DESCRIPTORS use numeric keys (0, 0.5, 1 … 5)
// because finalLevel in the pipeline is a string ("3+", "4") and must be
// converted via levelToFloat() before lookup.
//
const ILR_LABELS = Object.freeze({
  0:   "ILR 0",
  0.5: "ILR 0+",
  1:   "ILR 1",
  1.5: "ILR 1+",
  2:   "ILR 2",
  2.5: "ILR 2+",
  3:   "ILR 3",
  3.5: "ILR 3+",
  4:   "ILR 4",
  4.5: "ILR 4+",
  5:   "ILR 5",
});

const SAFE_LEVEL_DESCRIPTORS = Object.freeze({
  0:   { title: "Why This Passage Is ILR 0",  summary: "The passage does not yet require sentence-level comprehension." },
  0.5: { title: "Why This Passage Is ILR 0+", summary: "The passage relies on memorized phrases or short chunks with minimal connected meaning." },
  1:   { title: "Why This Passage Is ILR 1",  summary: "The passage requires simple sentence-level comprehension with explicit meaning." },
  1.5: { title: "Why This Passage Is ILR 1+", summary: "The passage requires basic connected-sentence comprehension and limited relation tracking." },
  2:   { title: "Why This Passage Is ILR 2",  summary: "The passage requires paragraph-level integration, multiple supporting ideas, and moderate inference." },
  2.5: { title: "Why This Passage Is ILR 2+", summary: "The passage requires supported reasoning across extended discourse with stronger abstraction or implication." },
  3:   { title: "Why This Passage Is ILR 3",  summary: "The passage requires abstract reasoning, implicit meaning construction, and layered multi-paragraph interpretation." },
  3.5: { title: "Why This Passage Is ILR 3+", summary: "The passage exceeds ILR 3 through sustained abstraction and cross-paragraph inference demand." },
  4:   { title: "Why This Passage Is ILR 4",  summary: "The passage requires layered conceptual argument, implicit stance, and high conceptual density across the text." },
  4.5: { title: "Why This Passage Is ILR 4+", summary: "The passage adds rhetorical nuance and stylistic sophistication to already dense, layered conceptual discourse." },
  5:   { title: "Why This Passage Is ILR 5",  summary: "The passage reflects native-level intellectual discourse with multiple simultaneous interpretive layers and no scaffolding." },
});

/**
 * Enrich a completed result object with safe display fields and defensive
 * fallbacks so that the frontend never crashes on a 3+ / 4 / 4+ / 5 result.
 *
 * finalLevel is a string ("3+", "4+") — convert to float before lookup.
 */
function buildSafeIlrReportPayload(result) {
  const rawLevel = levelToFloat(result.finalLevel) ?? 0;
  const descriptor =
    SAFE_LEVEL_DESCRIPTORS[rawLevel] ||
    SAFE_LEVEL_DESCRIPTORS[Math.floor(rawLevel)] ||
    {
      title:   `Why This Passage Is ${ILR_LABELS[rawLevel] ?? "ILR " + rawLevel}`,
      summary: "This level was assigned based on the combined discourse, inference, and structural evidence.",
    };

  const UPPER_BAND = new Set(["3", "3+", "4", "4+", "5"]);
  const summaryText = UPPER_BAND.has(result.finalLevel)
    ? buildLevelSummary(result.finalLevel)
    : descriptor.summary;

  return {
    ...result,
    assignedLevelLabel: ILR_LABELS[rawLevel] ?? `ILR ${result.finalLevel}`,
    levelTitle:         descriptor.title,
    // Defensive fallbacks — prevent rendering crashes when optional fields
    // are absent (e.g. on very old or partial responses).
    whyHigher:        result.whyHigher        ?? "",
    whyNotHigher:     result.whyNotHigher     ?? "",
    evidence:         Array.isArray(result.evidence)  ? result.evidence  : [],
    gateLog:          Array.isArray(result.hardGateLog) ? result.hardGateLog : [],
    likelyRange:      result.likelyRange      ?? (ILR_LABELS[rawLevel] ?? `ILR ${result.finalLevel}`),
    confidenceLabel:  result.confidenceLabel  ?? "Moderate",
  };
}

// ── Confidence score ──────────────────────────────────────────────────────────
//
// A score in [0.50, 1.00] indicating how cleanly the model and gate logic agree.
// 1.00 = model and gates agreed on the same level with no overrides.
// Lower values indicate that one or more gate rules overrode the model.

export function computeConfidence(rawModelLevel, finalLevel, {
  ceilingApplied      = false,
  hardFloorApplied    = false,
  listeningFloorApplied = false,
  hardGateDemotionSteps = 0,
} = {}) {
  let confidence = 1.0;

  const diff = Math.abs(levelIndex(finalLevel) - levelIndex(rawModelLevel));
  confidence -= diff * CONFIDENCE_WEIGHTS.PER_LEVEL_DIFF;

  if (ceilingApplied)          confidence -= CONFIDENCE_WEIGHTS.CEILING_APPLIED;
  if (hardFloorApplied)        confidence -= CONFIDENCE_WEIGHTS.FLOOR_APPLIED;
  if (listeningFloorApplied)   confidence -= CONFIDENCE_WEIGHTS.LISTENING_FLOOR_APPLIED;
  // Hard gate demotions each reduce confidence by the same amount as a ceiling.
  if (hardGateDemotionSteps > 0) {
    confidence -= hardGateDemotionSteps * CONFIDENCE_WEIGHTS.CEILING_APPLIED;
  }

  confidence = Math.max(CONFIDENCE_WEIGHTS.MIN_CONFIDENCE, Math.min(1.0, confidence));
  return Math.round(confidence * 100) / 100;
}

// ── Confidence caps ───────────────────────────────────────────────────────────
//
// Applied AFTER the decay computation above.  Two policies:
//
//   Policy A — "Never 100% without strong signals"
//     Per-level check: are the key positive signals for this level clearly
//     present, and are neighboring levels clearly rejected?  If not, cap at
//     CONFIDENCE_CAPS.DEFAULT_MAX (97%).
//
//   Policy B — "ILR 2 vs 2+: interpretation-depth cap"
//     Counts four positive interpretation-depth indicators that distinguish
//     ILR 2+ from ILR 2.  The fewer present, the lower the confidence cap:
//       4 → no Policy B cap       (strong ILR 2+)
//       3 → WEAK_2PLUS_MINOR 92%  (solid, one criterion absent)
//       2 → WEAK_2PLUS_MAJOR 85%  (moderate ILR 2+)
//     0–1 → LOW_2PLUS        78%  ("low ILR 2+", barely above ILR 2)
//
//   Policy C — "Explicit Low ILR 2+ pattern"
//     When ALL FOUR structural weakness conditions are simultaneously true for
//     a 2+ assignment, the passage is explicitly labeled "Low ILR 2+" and the
//     cap is floored at LOW_2PLUS (78%) regardless of Policy B count:
//       (1) single paragraph:   !multiparagraphArgument && !paragraphDependency
//       (2) limited viewpoint:  !stanceDetection && !nuancedPerspective
//       (3) moderate inference: moderateInference && !significantInference && !heavyInference
//       (4) linear reasoning:   !layeredReasoning
//
// Accepts raw detectedSignals; uses !! coercion for robustness.

function isStronglyAtLevel(level, s) {
  switch (level) {
    case "1":
      // Clear sentence-level text: recognition only, no connected discourse
      return !!(s.noConnectedSentences || (s.isolatedFacts && s.shortStatements));

    case "1+":
      // Short connected discourse — clearly connected sentences but no
      // paragraph-level integration and no meaningful inference demand
      return !!(
        s.multipleSentencesConnected &&
        !s.paragraphLevelDiscourse &&
        !s.moderateInference &&
        !s.abstractReasoning
      );

    case "2":
      // Paragraph-level factual / reporting discourse — clearly at 2, clearly
      // below 2+: no abstraction, no significant inference, no stance
      return !!(
        (s.paragraphLevelDiscourse || s.factualReportingChain ||
          s.chronologicalSequence || s.explicitRelationships || s.detailIntegration) &&
        !s.abstractReasoning &&
        !s.significantInference &&
        !s.stanceDetection
      );

    case "2+":
      // Multi-paragraph abstract argumentation clearly above ILR 2 AND
      // clearly below ILR 3 (no layered/implicit signals present)
      return !!(
        (s.multiparagraphArgument || s.paragraphDependency) &&
        s.abstractReasoning &&
        (s.significantInference || s.heavyInference || s.stanceDetection) &&
        !s.isExplanatoryText &&
        !s.isSimpleArgument &&
        !s.layeredReasoning &&   // ILR 3 clearly rejected
        !s.implicitMeaning       // ILR 3 clearly rejected
      );

    case "3":
      // All ILR 3 positive discriminators clearly present and no exclusions
      return !!(
        s.layeredReasoning &&
        s.implicitMeaning &&
        s.nuancedPerspective &&
        s.heavyInference &&
        s.abstractReasoning &&
        !s.isExplanatoryText &&
        !s.isSimpleArgument
      );

    default:
      return false;
  }
}

/**
 * Counts how many of the four interpretation-depth indicators that distinguish
 * ILR 2+ from ILR 2 are present in the passage signals.
 *
 * The four indicators (positive signals for 2+):
 *   1. depthInterpretation  — significantInference || heavyInference
 *        Active interpretation beyond tracking an explanation; reader cannot
 *        follow the text without inferring something not explicitly written.
 *   2. viewpointOrCritique  — stanceDetection
 *        Author viewpoint, evaluation, or critique is present and must be
 *        identified by the reader (not just described by the text).
 *   3. conceptualReasoning  — abstractReasoning
 *        Abstract conceptual framework, not just concrete or factual reporting.
 *   4. implicationBeyond    — conceptualVocabulary || implicitMeaning
 *        Meaning is implied beyond what any individual sentence directly states;
 *        abstract vocabulary carries interpretive weight.
 *
 * Contrast with ILR 2 signals:
 *   paragraph explanation, moderate abstraction, straightforward reasoning,
 *   limited viewpoint — none of the above apply.
 */
function count2PlusDepthIndicators(s) {
  let depth = 0;
  // 1. Interpretation beyond explanation — reader must actively infer
  if (s.significantInference || s.heavyInference) depth++;
  // 2. Viewpoint or critique — authorial stance not just described but present
  if (s.stanceDetection)                          depth++;
  // 3. Conceptual reasoning — abstract framework, not purely factual/concrete
  if (s.abstractReasoning)                        depth++;
  // 4. Implication beyond explicit — meaning implied in vocabulary or structure
  if (s.conceptualVocabulary || s.implicitMeaning) depth++;
  return depth;
}

/**
 * Returns true when ALL FOUR structural-weakness conditions are simultaneously
 * present in a passage assigned ILR 2+.  This is the "Low ILR 2+" pattern:
 *
 *   (1) Single paragraph  — no multi-paragraph structure or dependency
 *   (2) Limited viewpoint — no stance or nuanced perspective detected
 *   (3) Moderate inference only — not significant or heavy inference
 *   (4) Linear reasoning  — no layered (non-linear) reasoning present
 *
 * A passage matching this pattern crossed the 2+ gate threshold but still
 * exhibits mostly ILR 2 characteristics.  It should be labeled "Low ILR 2+"
 * and confidence should be reduced to LOW_2PLUS (78%).
 */
export function isLow2PlusPattern(finalLevel, s) {
  if (finalLevel !== "2+") return false;
  const singleParagraph   = !s.multiparagraphArgument && !s.paragraphDependency;
  const limitedViewpoint  = !s.stanceDetection && !s.nuancedPerspective;
  const moderateInferOnly = !!s.moderateInference && !s.significantInference && !s.heavyInference;
  const linearReasoning   = !s.layeredReasoning;
  return singleParagraph && limitedViewpoint && moderateInferOnly && linearReasoning;
}

/**
 * Returns a cap (0–1.0) to apply to the decay-computed confidence.
 * The returned value is the MAXIMUM allowed confidence for the given level
 * and signals.  Use: finalConfidence = Math.min(decayConfidence, cap).
 */
export function computeConfidenceCap(finalLevel, signals = {}) {
  const s = signals; // raw model signals; !! coercions used in helpers above
  let cap = 1.00;

  // Policy A: cap at 97% unless the level is "strongly satisfied"
  if (!isStronglyAtLevel(finalLevel, s)) {
    cap = Math.min(cap, CONFIDENCE_CAPS.DEFAULT_MAX);
  }

  // Policy B: ILR 2+ interpretation-depth cap
  //
  // The more interpretation-depth indicators present, the higher the cap.
  //   4 indicators → no Policy B cap (strong ILR 2+, only Policy A applies)
  //   3 indicators → 92%  solid, one criterion absent
  //   2 indicators → 85%  moderate ILR 2+
  //   0–1          → 78%  "low ILR 2+" — barely above ILR 2, lower confidence
  if (finalLevel === "2+") {
    const depthCount = count2PlusDepthIndicators(s);
    if (depthCount >= 4) {
      // strong 2+ — no Policy B reduction; Policy A still applies
    } else if (depthCount === 3) {
      cap = Math.min(cap, CONFIDENCE_CAPS.WEAK_2PLUS_MINOR);   // 92%
    } else if (depthCount === 2) {
      cap = Math.min(cap, CONFIDENCE_CAPS.WEAK_2PLUS_MAJOR);   // 85%
    } else {
      // 0 or 1 depth indicator → "low ILR 2+"
      cap = Math.min(cap, CONFIDENCE_CAPS.LOW_2PLUS);          // 78%
    }
  }

  // Policy C: Explicit "Low ILR 2+" structural pattern
  //
  // When all four structural weakness signals fire simultaneously, guarantee
  // the LOW_2PLUS cap regardless of the Policy B depth count.
  if (isLow2PlusPattern(finalLevel, s)) {
    cap = Math.min(cap, CONFIDENCE_CAPS.LOW_2PLUS);            // 78%
  }

  return cap;
}

// ── Dimension scores ──────────────────────────────────────────────────────────
//
// Returns a set of 0–10 scores summarising key linguistic dimensions.
// These are computed from the normalised signal booleans and listening
// categorical fields.  All scores are rounded to one decimal place.
//
// Dimensions:
//   discourseIntegration  — how much cross-sentence / cross-paragraph tracking is needed
//   inferenceLoad         — how much implicit meaning must be constructed
//   vocabularyComplexity  — lexical density, specialisation, structural packing
//   structuralComplexity  — discourse type sophistication
//   deliveryComplexity    — (listening only) speech rate + redundancy + delivery form

export function computeDimensionScores(signals = {}, modelResult = {}) {
  const s  = signals;
  const mode = (modelResult.mode || "reading").toLowerCase();

  // ── discourseIntegration (0–10) ───────────────────────────────────────────
  let discourseIntegration = 0;
  if (s.noConnectedSentences) {
    discourseIntegration = 0;
  } else if (
    s.isolatedFacts && s.shortStatements && s.minimalCohesion &&
    s.noParagraphDevelopment && s.noMultiSentenceIntegration
  ) {
    discourseIntegration = 2;
  } else if (s.multipleSentencesConnected || s.crossSentenceDependency) {
    discourseIntegration = 4;
    if (s.explicitRelationships || s.chronologicalSequence) discourseIntegration += 1;
  }
  if (s.paragraphLevelDiscourse || s.factualReportingChain || s.detailIntegration) {
    discourseIntegration = Math.max(discourseIntegration, 6);
  }
  if (s.multiparagraphArgument || s.paragraphDependency) {
    discourseIntegration = Math.max(discourseIntegration, 8);
  }
  if (s.heavyInference && s.paragraphDependency && s.multiparagraphArgument) {
    discourseIntegration = 10;
  }

  // ── inferenceLoad (0–10) ──────────────────────────────────────────────────
  let inferenceLoad = 0;
  if (s.moderateInference)   inferenceLoad += 3;
  if (s.significantInference) inferenceLoad = Math.max(inferenceLoad, 6);
  if (s.heavyInference)       inferenceLoad = Math.max(inferenceLoad, 9);
  if (s.abstractReasoning)    inferenceLoad = Math.min(10, inferenceLoad + 1);
  if (s.stanceDetection)      inferenceLoad = Math.min(10, inferenceLoad + 1);

  // ── vocabularyComplexity (0–10) ───────────────────────────────────────────
  let vocabularyComplexity = 0;
  if (s.conceptualVocabulary)  vocabularyComplexity += 3;
  if (s.embeddedStructure)     vocabularyComplexity += 3;
  if (s.historicalComparison)  vocabularyComplexity += 2;
  if (s.abstractReasoning)     vocabularyComplexity += 1;
  if (s.multiparagraphArgument)vocabularyComplexity += 1;
  vocabularyComplexity = Math.min(10, vocabularyComplexity);

  // ── structuralComplexity (0–10) ───────────────────────────────────────────
  // Based on discourse type and additional structural signals.
  const discourseType = (modelResult.discourseType || "").toLowerCase();
  let structuralComplexity = 0;
  if (discourseType.includes("factual report") || discourseType.includes("simple narration")) {
    structuralComplexity = 2;
  } else if (discourseType.includes("simple description")) {
    structuralComplexity = 1;
  } else if (discourseType.includes("opinion") || discourseType.includes("editorial")) {
    structuralComplexity = 6;
  } else if (discourseType.includes("analytical")) {
    structuralComplexity = 7;
  } else if (discourseType.includes("argumentative")) {
    structuralComplexity = 8;
  }
  if (s.historicalComparison)   structuralComplexity = Math.min(10, structuralComplexity + 1);
  if (s.stanceDetection)        structuralComplexity = Math.min(10, structuralComplexity + 1);
  if (s.paragraphDependency)    structuralComplexity = Math.min(10, structuralComplexity + 1);

  // ── deliveryComplexity (0–10, listening only) ─────────────────────────────
  let deliveryComplexity = null;
  if (mode === "listening") {
    const lsDelivery  = (modelResult.lsDelivery  || "").toLowerCase();
    const lsSpeechRate= (modelResult.lsSpeechRate || "").toLowerCase();
    const lsRedundancy= (modelResult.lsRedundancy || "").toLowerCase();

    const deliveryScore = { clear: 2, natural: 5, dense: 8 }[lsDelivery] ?? 4;
    const rateScore     = { slow: 1, moderate: 3, natural: 5, fast: 8 }[lsSpeechRate] ?? 4;
    const redundScore   = { high: 1, medium: 4, low: 8 }[lsRedundancy] ?? 4;

    deliveryComplexity = Math.round(
      ((deliveryScore * 0.4) + (rateScore * 0.35) + (redundScore * 0.25)) * 10
    ) / 10;
    deliveryComplexity = Math.min(10, Math.max(0, deliveryComplexity));
  }

  return {
    discourseIntegration:  Math.round(discourseIntegration  * 10) / 10,
    inferenceLoad:         Math.round(inferenceLoad          * 10) / 10,
    vocabularyComplexity:  Math.round(vocabularyComplexity   * 10) / 10,
    structuralComplexity:  Math.round(structuralComplexity   * 10) / 10,
    ...(deliveryComplexity !== null ? { deliveryComplexity } : {}),
  };
}

// ── Result assembly ───────────────────────────────────────────────────────────
//
// Merges the raw model result with all gate decisions and computed scores
// into the final response object returned by the API.

export function formatResult(modelResult, {
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
  ilrDescriptorJustification,
  scopeOfRating,
  hardGateLog             = [],
  hardGateDemotedFrom     = null,
  hardGateDemotionSteps   = 0,
  threeLayers:            preComputedThreeLayers = null,
  modalityAdj:            preComputedModalityAdj = null,
  mode = "reading",
  deliveryAnalysis        = null,
  boundaryApplied         = false,  // used only for confidence calculation
  consistencyResult       = null,   // Step 4 output from consistencyEngine.js
  exclusionCeilingApplied      = false,  // Step 5a: explanatory/simple-argument hard ceiling
  exclusionCeilingReason       = null,
  ilr2RoutineCeilingApplied    = false,  // Step 5b: routine-description ILR 2 ceiling
  temporalOnlyCeilingApplied   = false,  // Step 5c: temporal-only ILR 1 hard cap
  shortPassageCapApplied       = false,  // Step 5f: short-passage structural cap (< 70 words)
}) {
  // ── Step 6a: decay-based numeric confidence ──────────────────────────────
  let decayedConfidence = computeConfidence(rawModelLevel, finalLevel, {
    ceilingApplied,
    hardFloorApplied,
    listeningFloorApplied,
    hardGateDemotionSteps,
  });

  // Apply consistency penalty (Step 4 → Step 6 bridge).
  // The penalty is 0 when the signal profile is consistent; non-zero when the
  // consistency check flagged concerns about the boundary-assigned level.
  // Floored at 0.50 to match the MIN_CONFIDENCE bound.
  if (consistencyResult?.confidencePenalty > 0) {
    decayedConfidence = Math.max(0.50, decayedConfidence - consistencyResult.confidencePenalty);
  }

  const normalizedSignals = modelResult.detectedSignals || {};

  // Apply caps (Policy A: 100% guard; Policy B: 2+ borderline cap).
  const confidenceCap = computeConfidenceCap(finalLevel, normalizedSignals);
  const confidence    = Math.round(Math.min(decayedConfidence, confidenceCap) * 100) / 100;

  // Compute the levelLabel early so it can be passed to numericScoring.
  const levelLabel = isLow2PlusPattern(finalLevel, normalizedSignals)
    ? "Low ILR 2+"
    : `ILR ${finalLevel}`;

  const numericScoring = computeNumericScoring(
    normalizedSignals,
    modelResult,
    mode,
    finalLevel,
    levelLabel,
    hardGateLog,
  );

  // secondaryLevelLabel — optional qualifier shown alongside the level badge.
  // When the short-passage cap fired the passage cannot carry a "Low ILR 2+"
  // qualifier; any such label is suppressed.  Otherwise the label is derived
  // from the numeric combined score for 1+ and 2+ boundary cases.
  const secondaryLevelLabel = computeSecondaryLevelLabel(
    finalLevel,
    shortPassageCapApplied,
    numericScoring.combinedScore ?? 0,
  );

  // Policy D: borderline numeric-score confidence cap.
  //
  // When the numeric scoring panel detects that the combined score is within
  // 0.20 of a band boundary, apply an additional confidence cap to prevent
  // over-stating certainty for passages that are numerically close to an
  // adjacent ILR level.
  //
  // "lower" borderline → BORDERLINE_LOWER (0.82)  — close to level below
  // "upper" borderline → BORDERLINE_UPPER (0.88)  — close to level above
  //
  // The most restrictive cap across all policies wins.
  let cappedConfidence = confidence;
  if (numericScoring.borderline?.type === "lower") {
    cappedConfidence = Math.min(cappedConfidence, CONFIDENCE_CAPS.BORDERLINE_LOWER);
  } else if (numericScoring.borderline?.type === "upper") {
    cappedConfidence = Math.min(cappedConfidence, CONFIDENCE_CAPS.BORDERLINE_UPPER);
  }
  const finalConfidence = Math.round(cappedConfidence * 100) / 100;

  // ── Step 6b: confidence indicator — categorical label + likely range ────────
  const confidenceIndicator = computeConfidenceIndicator({
    finalLevel,
    rawModelLevel,
    finalConfidence,
    borderlineType:       numericScoring.borderline?.type ?? null,
    ceilingApplied,
    hardGateDemotionSteps,
    boundaryApplied,
    mode,
    deliveryAnalysis,
    consistencyWarnings:  consistencyResult?.warnings ?? [],
    passageWordCount:     modelResult.passageWordCount ?? null,
  });

  // Why Not Higher Level — deterministic bullet list of missing features for
  // the next ILR level.  Null only when finalLevel is already ILR 3.
  // When the short-passage structural cap fired, replace with fixed bullets
  // that explain exactly why a brief factual report cannot reach ILR 2.
  let whyNotHigher = computeWhyNotHigher(finalLevel, normalizedSignals);

  if (shortPassageCapApplied && whyNotHigher) {
    whyNotHigher = {
      ...whyNotHigher,
      title: "Why Not ILR 2",
      items: [
        "The passage is very short and does not sustain paragraph-level development.",
        "Meaning is largely explicit and does not require significant inference.",
        "The discourse is factual and sequential rather than analytically developed.",
        "Structural complexity is limited and does not support a higher-level assignment.",
      ],
    };
  }

  // Append length-dampening note to whyNotHigher when it fired, so teachers
  // understand that short passage length constrained the promotion thresholds.
  const lengthDampening = modelResult.lengthDampening || null;
  if (lengthDampening?.dampeningApplied && whyNotHigher?.items) {
    whyNotHigher.items.push(
      "Short passage length reduced discourse reliability; higher-level promotion was limited."
    );
  }

  const dimensionScores   = computeDimensionScores(normalizedSignals, {
    ...modelResult,
    mode,
  });

  // Use pre-computed threeLayers from scoringEngine if available (avoids double computation).
  const threeLayers = preComputedThreeLayers
    ?? computeThreeLayers(normalizedSignals, modelResult, mode);

  // Item Difficulty Predictor — companion analysis, does not affect ILR level.
  const itemDifficulty = computeItemDifficulty(normalizedSignals);

  // Auto Rubric Justification — structured teacher-facing rubric.
  // Generated deterministically from finalLevel + signals + mode; no new AI call.
  // Mode is passed so Discourse Organisation justification uses reading/listening
  // language appropriately, ensuring internal consistency with the modality branch.
  const rubricJustification = computeRubricJustification(
    finalLevel,
    normalizedSignals,
    modelResult,
    mode
  );

  // Modality Branches — explicit reading or listening analysis dimensions.
  // Both branches are always computed so the cross-modality note can compare them.
  // The active branch for the current mode is the primary display; the other is
  // available to the frontend for cross-modality comparison context.
  const discourseType = (modelResult.discourseType || "simple description").toLowerCase();
  const readingBranch  = computeReadingBranch(normalizedSignals, discourseType, modelResult.passageWordCount);
  const listeningBranch = computeListeningBranch(normalizedSignals, modelResult);
  const crossModalityNote = buildCrossModalityNote(finalLevel, normalizedSignals, modelResult, mode);

  // Modality adjustment — use pre-computed result if available.
  const modalityAdj = preComputedModalityAdj ?? {
    adjustedLevel:            finalLevel,
    adjustment:               0,
    modalityIndex:            0,
    contributingFactors:      [],
    modalityExplanation:      "",
    modalityDimensionScores:  {},
    modalityAdjustmentApplied: false,
    modalityAdjustmentReason:  null,
  };

  const result = {
    // ── Spread original model output ──────────────────────────────────
    ...modelResult,

    // ── Override / augment fields ─────────────────────────────────────
    ilrDescriptorJustification,
    scopeOfRating,

    // ── Level fields ──────────────────────────────────────────────────
    rawModelLevel,
    gatedMinimumLevel,
    displayLevel:  finalLevel,
    finalLevel,
    assignedLevel: finalLevel,

    // levelLabel: human-readable level label.
    // "Low ILR 2+" when all four structural-weakness conditions fire together
    // on a 2+ assignment; "ILR <level>" otherwise.
    levelLabel,

    // secondaryLevelLabel: score-derived qualifier for boundary cases.
    // "Low ILR 2"  — when level is 1+ but combinedScore >= 2.0 (upper boundary)
    // "Low ILR 2+" — when level is 2+ but combinedScore <= 2.3 (lower boundary)
    // ""            — suppressed when shortPassageCapApplied; otherwise empty
    secondaryLevelLabel,
    shortPassageCapApplied,

    // ── Gate decision audit trail ─────────────────────────────────────
    hardFloorApplied,
    gateTriggered,
    floorReason,
    ceilingApplied,
    ceilingLabel,
    ceilingReason,
    listeningFloorApplied,
    listeningFloorLabel,
    listeningFloorReason,
    // Step 5a: explanatory-text / simple-argument hard ceiling (2+ cap).
    // When true, the level was demoted from ≥ ILR 3 to ILR 2+ because
    // isExplanatoryText or isSimpleArgument is present.
    exclusionCeilingApplied,
    exclusionCeilingReason,
    // Step 5b: routine-description ILR 2 ceiling.
    // When true, the level was demoted from ≥ ILR 2 because the passage
    // has noMultiSentenceIntegration + minimalCohesion and no genuine
    // cross-sentence dependency or inference — independent routine statements
    // cannot reach ILR 2.
    ilr2RoutineCeilingApplied,
    // Step 5c: temporal-only ILR 1 hard cap.
    // When true, the level was demoted to ILR 1 because the passage's only
    // apparent cohesion is temporal/chronological ordering ("then", "after",
    // "at noon", "later", "finally") — no genuine cross-sentence processing
    // (pronoun tracking, causal/contrastive bond, inference) is required, AND
    // both the vocabulary abstraction score and discourse-length score confirm
    // low complexity.  This guard is model-error-resistant and fires even when
    // the model incorrectly set minimalCohesion=false for temporal markers.
    temporalOnlyCeilingApplied,

    // ── Hard gate system results ──────────────────────────────────────
    // hardGateLog: ordered array of gate evaluation objects.  Each entry
    //   has { gate, label, passed, threshold, passCount, totalConditions,
    //         conditions, failedConditions, description }.
    // hardGateDemotedFrom: the level before demotion (null if no demotion).
    // hardGateDemotionSteps: number of levels demoted (0 if no demotion).
    hardGateLog,
    hardGateDemotedFrom,
    hardGateDemotionSteps,

    // ── Consistency check audit trail (Step 4) ────────────────────────
    // consistent:        true when the signal profile matches the level.
    // consistencyWarnings: plain-text concerns (empty when consistent).
    // confidencePenalty: numeric deduction applied to Step 6 confidence.
    // consistencyNote:   single-sentence summary of the check outcome.
    consistencyCheck: {
      consistent:         consistencyResult?.consistent       ?? true,
      warnings:           consistencyResult?.warnings         ?? [],
      confidencePenalty:  consistencyResult?.confidencePenalty ?? 0,
      note:               consistencyResult?.note             ?? "",
    },

    // ── Listening Delivery Analysis ───────────────────────────────────
    // deliveryAnalysis is non-null only in listening mode.
    // deliveryDifficulty from the module overrides the model's raw
    // listeningDifficulty field (which is already spread via modelResult).
    deliveryAnalysis,
    // Canonical listening difficulty — module output takes precedence.
    listeningDifficulty: deliveryAnalysis?.deliveryDifficulty
      ?? modelResult.listeningDifficulty
      ?? null,

    // ── Computed scores (legacy dimension set) ────────────────────────
    confidence: finalConfidence,

    // ── Confidence Indicator ──────────────────────────────────────────
    // Categorical label, likely range, and signal clustering summary.
    // Built deterministically from all pipeline signals — no extra AI call.
    //
    //   confidenceLabel:   "High" | "Medium" | "Low"
    //   likelyRange:       "1+ to 2" | "2" (string, for display)
    //   likelyRangeRaw:    ["1+", "2"]      (array, for programmatic use)
    //   signalCluster:     "strong" | "mixed" | "weak"
    //   confidenceReasons: string[]  (max 5 items, teacher-facing)
    ...confidenceIndicator,
    // Append length-dampening confidence bullet when applicable.
    confidenceReasons: lengthDampening?.dampeningApplied
      ? [
          ...(confidenceIndicator.confidenceReasons ?? []),
          "Short passage length reduced discourse reliability; higher-level promotion was limited.",
        ]
      : (confidenceIndicator.confidenceReasons ?? []),

    dimensionScores,

    // ── Three-layer scoring ───────────────────────────────────────────
    // Each layer is computed independently from the others.
    // Higher scores (0–10) indicate greater complexity or demand.
    // combinedScore is a weighted average of the three sub-scores;
    // weights are configurable in thresholds.js → THREE_LAYER.WEIGHTS.
    threeLayers,

    // ── Modality adjustment ───────────────────────────────────────────
    // Dimensional modality scores and adjustment result.
    // modalityAdjustmentApplied: true when the index exceeded the threshold
    //   and the level was pushed up one step.
    // modalityIndex: the weighted modality difficulty score (0–10).
    // modalityDimensionScores: the 5 per-dimension scores used to compute it.
    // contributingFactors: array of { dimension, label, score, level, hint }.
    // modalityExplanation: teacher-facing paragraph describing which factors
    //   affected (or did not affect) the final rating.
    modalityAdjustmentApplied:  modalityAdj.modalityAdjustmentApplied,
    modalityAdjustmentReason:   modalityAdj.modalityAdjustmentReason,
    modalityIndex:              modalityAdj.modalityIndex,
    modalityDimensionScores:    modalityAdj.modalityDimensionScores,
    contributingFactors:        modalityAdj.contributingFactors,
    modalityExplanation:        modalityAdj.modalityExplanation,

    // ── Numeric scoring, Item Difficulty, Auto Rubric ─────────────────
    // rubricJustification is delivered automatically via /api/enrich/:jobId.
    // numericScoring and itemDifficulty are delivered on-demand via
    // /api/lazy-compute/:computeJobId — only when the user expands
    // sections 6 or 7 — so we do not compute them until needed.
    numericScoring:      null,   // populated by /api/lazy-compute (on expand)
    itemDifficulty:      null,   // populated by /api/lazy-compute (on expand)
    rubricJustification: null,   // populated by /api/enrich (auto)

    // Internal: extracted by server before response is sent; never reaches client.
    _enrichPayload:  { rubricJustification },
    _computePayload: { numericScoring, itemDifficulty },

    // ── Modality Branch Analysis ─────────────────────────────────────
    // readingBranch:   7 reading-specific dimensions (score 0–5 each).
    // listeningBranch: 8 listening-specific dimensions (score 0–5 each).
    // Both are always computed; the active branch drives Section 4.
    readingBranch,
    listeningBranch,

    // Cross-modality comparison note and estimate.
    //   { note, currentMode, otherMode, currentLevel,
    //     estimatedOtherLevel, isSameLevel, direction }
    crossModalityNote,

    // ── Normalized why-section fields ─────────────────────────────────
    // Reading uses whyNotAbove / whyNotBelow;
    // listening uses whyNotHigherLevel / whyNotLowerLevel.
    // Expose canonical names so the frontend only handles one set.
    // applyLevelText() (called below) overrides whyNotHigherLevel for
    // upper-band levels; lower levels keep the model-generated string.
    whyNotHigherLevel:
      modelResult.whyNotHigherLevel
      || modelResult.whyNotAbove
      || "",
    whyNotLowerLevel:
      modelResult.whyNotLowerLevel  || modelResult.whyNotBelow  || "",

    // ── Why Not Higher Level ──────────────────────────────────────────
    // Deterministic list of missing features for the next ILR level.
    // { nextLevel, title, items[] } or null when already at ILR 3.
    whyNotHigher,

    // ── Length dampening metadata ─────────────────────────────────────
    // Null when the passage was long enough that no dampening was needed.
    // { dampeningApplied, dampeningTier, notes[] } when it fired.
    lengthDampening,

    // ── Safeguard metadata ────────────────────────────────────────────
    ratingSafeguardsApplied: true,
    safeguardScope: "all_languages",
    safeguardNote: "Rating safeguards are applied consistently across all supported languages.",
  };

  // ── Pipeline order (important) ───────────────────────────────────────────────
  //
  //   1. enforceReportConsistency  — consistency safety-net (may demote level)
  //   2. finalizeReport            — writes upper-band text; nulls stale fields
  //   3. normalizeShortPassageCappedResult — cap-specific overrides (MUST be last
  //      so finalizeReport cannot overwrite deterministic 1+ content)
  //   4. scrubResidualTwoPlusLabels — text-field scrub
  //   5. sanitizeAssignedLevelFields — phantom-field delete
  //   6. buildSafeIlrReportPayload  — defensive fallbacks + output

  // ── DEBUG: trace every pipeline step ────────────────────────────────────────
  const _dbg = {
    path: [],
    buildStamp: "2026-04-05-v11-debug",
    inputFinalLevel:         finalLevel,
    inputShortPassageCap:    shortPassageCapApplied,
    inputRawModelLevel:      rawModelLevel,
    preNormLevelLabel:       result.levelLabel,
    preNormLikelyRange:      result.likelyRange,
    preNormWhyNotHigherLevel: result.whyNotHigherLevel,
    preNormWhyNotAbove:      result.whyNotAbove,
    preNormLevelJust:        (result.levelJustificationSummary || "").slice(0, 80),
    preNormConfReasonsCount: (result.confidenceReasons || []).length,
  };

  _dbg.path.push("REPORT_PATH_A:formatResult_entered");

  const afterConsistency = enforceReportConsistency(result);
  _dbg.path.push("REPORT_PATH_B:enforceReportConsistency_done");
  _dbg.afterConsistencyFinalLevel = afterConsistency.finalLevel;

  const processed = finalizeReport(afterConsistency);
  _dbg.path.push("REPORT_PATH_C:finalizeReport_done");
  _dbg.afterFinalizeLevelJust    = (processed.levelJustificationSummary || "").slice(0, 80);
  _dbg.afterFinalizeWhyNotHigher = (processed.whyNotHigherLevel || "").slice(0, 80);

  _dbg.afterConsistencyDemotionApplied = processed._consistencyDemotionApplied;
  _dbg.afterConsistencyDemotionTarget  = processed._consistencyDemotionTarget;

  const beforeNormCap   = processed.shortPassageCapApplied;
  const beforeNormDemot = processed._consistencyDemotionApplied;
  normalizeShortPassageCappedResult(processed);
  _dbg.path.push(beforeNormCap
    ? "REPORT_PATH_D:normalizeShortPassageCap_FIRED"
    : beforeNormDemot
      ? "REPORT_PATH_D:normalizeConsistencyDemotion_FIRED"
      : "REPORT_PATH_D:normalize_skipped");
  _dbg.afterNormFinalLevel      = processed.finalLevel;
  _dbg.afterNormLevelLabel      = processed.levelLabel;
  _dbg.afterNormLikelyRange     = processed.likelyRange;
  _dbg.afterNormLevelJust       = (processed.levelJustificationSummary || "").slice(0, 80);
  _dbg.afterNormWhyNotHigherLevel = (processed.whyNotHigherLevel || "");
  _dbg.afterNormWhyNotAbove     = (processed.whyNotAbove || "");
  _dbg.afterNormConfReasonCount = (processed.confidenceReasons || []).length;
  _dbg.afterNormConfReasons     = (processed.confidenceReasons || []).slice(0, 3);

  scrubResidualTwoPlusLabels(processed);
  _dbg.path.push("REPORT_PATH_E:scrubResidual_done");

  sanitizeAssignedLevelFields(processed);
  _dbg.path.push("REPORT_PATH_F:sanitizeAssignedLevel_done");

  console.log("[SmartILR][formatResult] debug trace:", JSON.stringify(_dbg, null, 2));

  processed._debug = _dbg;

  return buildSafeIlrReportPayload(processed);
}

// ── sanitizeAssignedLevelFields ───────────────────────────────────────────────
//
// Always-run cleanup (not cap-specific). Nulls out field names that have no
// defined role in the result schema but that a renderer could mistakenly use
// as an alternate level source (rawLevel, modelLevel, preCapLevel, etc.).
// Mirrors the getAssignedLevelText() contract: the only canonical level is
// finalLevel / assignedLevel.

function sanitizeAssignedLevelFields(result) {
  // Delete (not null) so these keys are entirely absent from the payload.
  // Any renderer that checks `key in result` or iterates the object will not
  // see them at all.  The only canonical level is finalLevel / assignedLevel.
  const PHANTOM_FIELDS = [
    "secondaryLevel", "secondaryLevelLabel",
    "modelLevel", "rawLevel",
    "boundaryLevel", "preCapLevel", "postGateLevel",
    "promotedLevel", "altLevel", "lowHighLabel",
  ];
  for (const f of PHANTOM_FIELDS) delete result[f];
  return result;
}

// ── computeSecondaryLevelLabel ────────────────────────────────────────────────
//
// Score-derived qualifier for boundary-zone assignments.
//
//   shortPassageCapApplied true → "" (suppress; the cap itself is the explanation)
//   level "1+", combinedScore >= 2.0 → "Low ILR 2"  (near the 2 boundary from below)
//   level "2+", combinedScore <= 2.3 → "Low ILR 2+"  (near the 2 boundary from above)
//   otherwise → ""

function computeSecondaryLevelLabel(finalLevel, shortPassageCapApplied, numericScore) {
  if (shortPassageCapApplied) return "";
  if (finalLevel === "1+" && numericScore >= 2.0) return "Low ILR 2";
  if (finalLevel === "2+" && numericScore <= 2.3) return "Low ILR 2+";
  return "";
}

// ── normalizeShortPassageCappedResult ────────────────────────────────────────
//
// When the short-passage structural cap (Step 5f) has fired, the assigned
// finalLevel is already "1+". This function ensures every alternate level
// field, secondary label, and derived text field on the result object also
// reflects "1+" so that no "ILR 2+" string leaks through to the frontend.
//
// Mutates `result` in-place; returns the same object for chaining.

function normalizeShortPassageCappedResult(result) {
  // Fire when the short-passage structural cap triggered, OR when
  // enforceReportConsistency demoted/capped a 2+ result.
  // When the consistency engine capped at ILR 2 (not 1+), the level fields
  // are already correct — only the bullet/whyNotHigher cleanup is needed.
  const isShortCap         = !!result.shortPassageCapApplied;
  const isConsistencyDemot = !!result._consistencyDemotionApplied;
  const demotTarget        = result._consistencyDemotionTarget ?? "1+"; // "1+" or "2"
  if (!isShortCap && !isConsistencyDemot) return result;

  // 1) Force level aliases — SHORT-PASSAGE CAP or DEMOT-TO-1+ only ────────────
  // When the consistency engine capped at "2", level fields are already correct.
  if (isShortCap || (isConsistencyDemot && demotTarget === "1+")) {
    result.finalLevel         = isShortCap ? "1+" : demotTarget;
    result.assignedLevel      = result.finalLevel;
    result.displayLevel       = result.finalLevel;
    result.finalAssignedLevel = result.finalLevel;
    result.level              = result.finalLevel;
    result.levelLabel         = `ILR ${result.finalLevel}`;
  }

  // 2) Wipe all alternate / secondary display labels (always) ───────────────
  const BLANK_FIELDS = [
    "secondaryLevelLabel", "secondaryAssignedLevel", "alternateLevel",
    "altLevel", "displaySublevel", "boundaryLevelLabel", "lowHighBandLabel",
    "nearbyLevelLabel", "promotedLevelLabel", "rawModelLevelLabel",
    "modelEstimatedLevelLabel", "preCapLevelLabel", "postBoundaryLevelLabel",
    "ceilingLevelLabel", "floorLevelLabel", "debugLevelLabel",
  ];
  for (const f of BLANK_FIELDS) result[f] = "";

  // 3) Likely range — SHORT-PASSAGE CAP or DEMOT-TO-1+ only ─────────────────
  if (isShortCap || (isConsistencyDemot && demotTarget === "1+")) {
    result.likelyRange    = "ILR 1 to 1+";
    result.likelyRangeMin = "1";
    result.likelyRangeMax = "1+";
  }

  // 4) Deterministic explanation prose — SHORT-PASSAGE CAP ONLY ──────────────
  if (isShortCap) {
    result.assignedLevelExplanation =
      "The assigned ILR rating applies to the original target-language text. " +
      "The passage is a short factual report with explicitly stated information. " +
      "The reader mainly follows directly stated events and relationships with " +
      "minimal inferencing demands.";

    result.levelJustificationSummary =
      "The passage is rated at ILR Level 1+ because it is a short factual " +
      "report with explicitly stated information and minimal inferencing demands.";
    result.levelSummary = result.levelJustificationSummary;
    result.summary      = result.levelJustificationSummary;
  }

  // 5) Remove confidence-reason bullets that reference 2+ assignment ─────────
  const CONF_STRIP = [
    /ILR 2\+\s+assigned/i,
    /extended discourse requirement may not be met/i,
    /upper-level requirement for supported reasoning is unconfirmed/i,
  ];
  const cleanedReasons = [];
  for (const r of (result.confidenceReasons ?? [])) {
    if (!CONF_STRIP.some(rx => rx.test(r))) cleanedReasons.push(r);
  }
  result.confidenceReasons = cleanedReasons;

  // 6) Why-not-higher block ─────────────────────────────────────────────────
  if (isShortCap) {
    // Short-passage cap → short-passage-specific items targeting ILR 2.
    result.whyNotHigherTitle = "Why Not ILR 2";
    result.whyNotHigherLevel = "2";
    result.whyNotAbove       = "2";
    result.whyNotHigher      = {
      nextLevel: "2",
      title: "Why Not ILR 2",
      items: [
        "The passage is very short and does not sustain developed discourse.",
        "Meaning is largely explicit and does not require significant inference.",
        "The discourse is factual and sequential rather than analytically developed.",
        "Structural complexity is limited and does not support a higher-level assignment.",
      ],
      conclusion:
        "This passage does not reach ILR 2 because it does not require " +
        "significant inference or interpretation beyond explicitly stated information.",
    };
  } else if (isConsistencyDemot) {
    // enforceReportConsistency already wrote the correct whyNotHigher block.
    // Only confirm the top-level scalar fields match the object.
    const wnh = result.whyNotHigher;
    if (wnh && typeof wnh === "object") {
      result.whyNotHigherTitle = wnh.title;
      result.whyNotHigherLevel = wnh.nextLevel;
      result.whyNotAbove       = wnh.nextLevel;
    }
  }

  return result;
}

// ── scrubResidualTwoPlusLabels ────────────────────────────────────────────────
//
// Safety pass: removes any bare "ILR 2+" line that may still appear inside
// free-text string fields after normalizeShortPassageCappedResult has run.
//
// Mutates `result` in-place; returns the same object for chaining.

function scrubResidualTwoPlusLabels(result) {
  if (!result.shortPassageCapApplied) return result;

  const TEXT_FIELDS = [
    "assignedLevelExplanation", "levelJustificationSummary",
    "levelSummary", "summary", "displayHeader", "headerText", "reportText",
    "ilrDescriptorJustification",
  ];

  for (const key of TEXT_FIELDS) {
    if (typeof result[key] === "string") {
      result[key] = result[key]
        .replace(/\nILR 2\+\n/g, "\n")
        .replace(/^ILR 2\+\s*$/gm, "");
    }
  }

  return result;
}

// ── enforceReportConsistency ─────────────────────────────────────────────────
//
// Final safety net: if any report text says "does not reach ILR 2+" while
// the assigned level IS 2+, the level must be pulled down to "1+".
// This catches the rare case where the model's justification text was written
// for a different level than the one ultimately assigned.
//
// Runs immediately before buildSafeIlrReportPayload/finalizeReport so that
// all downstream text assembly starts from a consistent finalLevel.

function enforceReportConsistency(result) {
  const ILR_RANK = { "0": 0, "0+": 1, "1": 2, "1+": 3, "2": 4, "2+": 5, "3": 6, "3+": 7, "4": 8, "4+": 9, "5": 10 };
  const rank = lvl => ILR_RANK[String(lvl)] ?? 0;

  const assigned = result.finalLevel || result.assignedLevel || "0";

  // Check all text fields that might carry a "does not reach ILR 2+" claim.
  const corpus = [
    result.ilrDescriptorJustification || "",
    result.whyNotHigherLevel          || "",
    typeof result.whyNotHigher === "object" ? (result.whyNotHigher?.items || []).join(" ") : "",
  ].join(" ");

  const contradicts2Plus = /does not reach ILR\s*(?:Level\s*)?2\+/i.test(corpus);

  if (contradicts2Plus && rank(assigned) >= rank("2+")) {
    // ── Sub-score guard: is this passage still ILR 2 worthy? ─────────────────
    //
    // The model may write "does not reach ILR 2+" (targeting the PLUS band)
    // while the passage genuinely supports plain ILR 2.  Use the same signal
    // formulas as the numeric scoring panel (scoreMainIdeaIntegration and
    // scoreVocabularyAbstraction) to decide:
    //
    //   cohesionScore ≥ 3.0  OR  abstractionScore ≥ 2.0
    //     → cap at ILR 2, not 1+  (passage still merits the base band)
    //   otherwise
    //     → demote to ILR 1+ (passage is genuinely sub-2)
    //
    const sigs = result.detectedSignals || {};

    // Inline mirror of scoreMainIdeaIntegration (0–5 scale):
    let cohesionScore = 1.5;
    if (sigs.multipleSentencesConnected) cohesionScore = Math.max(cohesionScore, 2.0);
    if (sigs.explicitRelationships)      cohesionScore = Math.max(cohesionScore, 2.5);
    if (sigs.detailIntegration)          cohesionScore = Math.max(cohesionScore, 3.5);
    if (sigs.factualReportingChain && sigs.paragraphLevelDiscourse) cohesionScore = Math.max(cohesionScore, 4.0);
    if (sigs.detailIntegration && sigs.multiparagraphArgument)      cohesionScore = Math.max(cohesionScore, 5.0);

    // Inline mirror of scoreVocabularyAbstraction (0–5 scale):
    let abstractionScore = 0.5;
    if (sigs.historicalComparison) abstractionScore = Math.max(abstractionScore, 2.0);
    if (sigs.abstractReasoning)    abstractionScore = Math.max(abstractionScore, 2.5);
    if (sigs.conceptualVocabulary) abstractionScore = Math.max(abstractionScore, 3.5);

    const ilr2Worthy = cohesionScore >= 3.0 || abstractionScore >= 2.0;

    if (ilr2Worthy) {
      // ── Cap at ILR 2 — passage merits the base band, not the plus ──────────
      result.finalLevel         = "2";
      result.assignedLevel      = "2";
      result.displayLevel       = "2";
      result.finalAssignedLevel = "2";
      result.level              = "2";
      result.levelLabel         = "ILR 2";
      delete result.secondaryLevelLabel;
      result.likelyRange    = "ILR 1+ to 2";
      result.likelyRangeMin = "1+";
      result.likelyRangeMax = "2";
      result.likelyRangeRaw = ["1+", "2"];

      // Why-not-higher correctly targets 2+ (the level the model already
      // said the passage cannot reach — text is the ground truth here).
      result.whyNotHigherTitle = "Why Not ILR 2+";
      result.whyNotHigherLevel = "2+";
      result.whyNotAbove       = "2+";
      result.whyNotHigher      = {
        nextLevel:       "2+",
        title:           "Why Not ILR 2+",
        items: [
          "ILR 2+ requires sustained viewpoint, evaluative reasoning, and layered interpretive demands beyond what this passage presents.",
          "The passage conveys its meaning through relatively explicit discourse without the density or implication required at the 2+ band.",
          "Reaching ILR 2+ demands denser, less predictable text in which stance or implied meaning must be actively constructed by the reader.",
        ],
        conclusion:
          "The passage demonstrates ILR 2 organization and cohesion but does not " +
          "reach the interpretive density and stance required for ILR 2+.",
      };

      // Strip stale "ILR 2+ assigned" confidence bullets
      if (Array.isArray(result.confidenceReasons)) {
        result.confidenceReasons = result.confidenceReasons.filter(
          r => !/ILR 2\+\s+assigned/i.test(r)
        );
      }

      result._consistencyDemotionApplied = true;
      result._consistencyDemotionTarget  = "2";

      console.log(
        `[SmartILR] enforceReportConsistency: 2+ → ILR 2 cap applied ` +
        `(cohesion=${cohesionScore.toFixed(1)}, abstraction=${abstractionScore.toFixed(1)}, ilr2Worthy=true)`
      );
    } else {
      // ── Demote to ILR 1+ — passage is genuinely below ILR 2 ───────────────
      result.finalLevel         = "1+";
      result.assignedLevel      = "1+";
      result.displayLevel       = "1+";
      result.finalAssignedLevel = "1+";
      result.level              = "1+";

      result.levelLabel = "ILR 1+";
      delete result.secondaryLevelLabel;
      const STALE_LABEL_FIELDS = [
        "secondaryAssignedLevel", "alternateLevel", "altLevel", "displaySublevel",
        "boundaryLevelLabel", "lowHighBandLabel", "nearbyLevelLabel",
        "promotedLevelLabel", "rawModelLevelLabel", "modelEstimatedLevelLabel",
        "preCapLevelLabel", "postBoundaryLevelLabel", "ceilingLevelLabel",
        "floorLevelLabel", "debugLevelLabel",
      ];
      for (const f of STALE_LABEL_FIELDS) result[f] = "";

      result.likelyRange    = "ILR 1 to 1+";
      result.likelyRangeMin = "1";
      result.likelyRangeMax = "1+";
      result.likelyRangeRaw = ["1", "1+"];

      if (Array.isArray(result.confidenceReasons)) {
        result.confidenceReasons = result.confidenceReasons.filter(
          r => !/ILR 2\+\s+assigned/i.test(r)
        );
      }

      result.whyNotHigherTitle = "Why Not ILR 2";
      result.whyNotHigherLevel = "2";
      result.whyNotAbove       = "2";
      result.whyNotHigher      = {
        nextLevel:       "2",
        title:           "Why Not ILR 2",
        items: [
          "ILR 2 requires the ability to handle a wide variety of communicative tasks, including narration, description, and explanation across a range of topics.",
          "The passage shows structural or lexical limitations that prevent consistent performance at the ILR 2 band.",
          "Sustained, accurate use of cohesive devices and paragraph-level organization is required for ILR 2 but not yet reliably demonstrated here.",
        ],
        conclusion:
          "This passage does not reach ILR 2 because it does not demonstrate " +
          "the breadth, precision, and organizational control required at that level.",
      };

      result._consistencyDemotionApplied = true;
      result._consistencyDemotionTarget  = "1+";

      console.log(
        `[SmartILR] enforceReportConsistency: 2+ → 1+ demotion applied ` +
        `(cohesion=${cohesionScore.toFixed(1)}, abstraction=${abstractionScore.toFixed(1)}, ilr2Worthy=false)`
      );
    }
  }

  return result;
}
