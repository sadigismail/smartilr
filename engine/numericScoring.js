// ─────────────────────────────────────────────────────────────────────────────
// engine/numericScoring.js
//
// Computes the numeric scoring panel (0.0–5.0 per dimension) and teacher
// summary.  All weights live in config/numericScoringConfig.js.
//
// CRITICAL: numeric scores are INFORMATIONAL ONLY.
//   - They do not assign or change the ILR level.
//   - Gates decide the level first; scores provide transparency.
//   - Never pass scores back into gate logic.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CORE_WEIGHTS,
  READING_WEIGHTS,
  LISTENING_WEIGHTS,
  TASK_WEIGHTS,
  DIMENSION_LABELS,
  SCORE_BANDS,
  LEVEL_EXPECTED_MIN,
} from "../config/numericScoringConfig.js";

// ── Utilities ─────────────────────────────────────────────────────────────────

function clamp(v, lo = 0.0, hi = 5.0) { return Math.max(lo, Math.min(hi, v)); }
function r1(v)                          { return Math.round(v * 10) / 10; }

// ── Core dimension scorers ────────────────────────────────────────────────────

function scoreMainIdeaIntegration(s) {
  if (s.noConnectedSentences) return 0.0;
  if (s.isolatedFacts && s.noParagraphDevelopment && !s.multipleSentencesConnected) return 0.5;
  if (s.multiparagraphArgument && s.paragraphDependency && s.heavyInference) return 5.0;
  let v = 1.5;
  if (s.multipleSentencesConnected || s.crossSentenceDependency) v = Math.max(v, 2.0);
  if (s.paragraphLevelDiscourse || s.detailIntegration)          v = Math.max(v, 3.0);
  if (s.multiparagraphArgument || s.paragraphDependency)         v = Math.max(v, 4.0);
  return v;
}

function scoreDetailExplicitness(s) {
  // Higher = more detail to track and integrate across the text.
  if (s.noConnectedSentences || (s.isolatedFacts && s.simpleAdditiveText)) return 0.5;
  let v = 1.5;
  if (s.multipleSentencesConnected) v = Math.max(v, 2.0);
  if (s.explicitRelationships)      v = Math.max(v, 2.5);
  if (s.detailIntegration)          v = Math.max(v, 3.5);
  if (s.factualReportingChain && s.paragraphLevelDiscourse) v = Math.max(v, 4.0);
  if (s.detailIntegration && s.multiparagraphArgument)      v = Math.max(v, 5.0);
  return v;
}

function scoreInferenceLoad(s) {
  if (s.noConnectedSentences || (s.isolatedFacts && s.minimalCohesion)) return 0.0;
  if (s.heavyInference && s.implicitMeaning && s.layeredReasoning) return 5.0;
  let v = 1.0;
  if (s.moderateInference)   v = Math.max(v, 2.5);
  if (s.significantInference) v = Math.max(v, 3.5);
  if (s.heavyInference)       v = Math.max(v, 4.5);
  if (s.abstractReasoning)    v = Math.min(5.0, v + 0.3);
  if (s.implicitMeaning)      v = Math.min(5.0, v + 0.2);
  return v;
}

function scoreDiscourseOrganization(s) {
  if (s.noConnectedSentences) return 0.0;
  if (s.simpleAdditiveText || (s.isolatedFacts && !s.multipleSentencesConnected)) return 0.5;
  if (s.multiparagraphArgument && s.layeredReasoning) return 5.0;
  let v = 1.5;
  if (s.chronologicalSequence) v = Math.max(v, 2.5);
  if (s.paragraphLevelDiscourse || s.explicitRelationships) v = Math.max(v, 3.0);
  if (s.multiparagraphArgument) v = Math.max(v, 4.0);
  return v;
}

function scoreVocabularyAbstraction(s) {
  let v = 0.5;
  if (s.historicalComparison) v = Math.max(v, 2.0);
  if (s.abstractReasoning)    v = Math.max(v, 2.5);
  if (s.conceptualVocabulary) v = Math.max(v, 3.5);
  if (s.conceptualVocabulary && s.abstractReasoning)              v = Math.max(v, 4.0);
  if (s.conceptualVocabulary && s.abstractReasoning && s.implicitMeaning) v = Math.max(v, 5.0);
  // Consistency cap: explicit argument or explanatory text — topic may be abstract
  // but discourse does not require implicit interpretation. Cap at 3.5 ("High")
  // so the score stays consistent with the ILR 2+ ceiling applied in Step 5a.
  if (s.isSimpleArgument || s.isExplanatoryText) v = Math.min(v, 3.5);
  return v;
}

function scoreSentenceClauseComplexity(s) {
  if (s.noConnectedSentences || s.simpleAdditiveText) return 0.5;
  let v = 1.0;
  if (s.multipleSentencesConnected) v = Math.max(v, 1.5);
  if (s.crossSentenceDependency)    v = Math.max(v, 2.5);
  if (s.embeddedStructure)          v = Math.max(v, 3.5);
  if (s.embeddedStructure && s.paragraphDependency)              v = Math.max(v, 4.5);
  if (s.embeddedStructure && s.paragraphDependency && s.heavyInference) v = 5.0;
  return v;
}

function scoreInterpretationDepth(s) {
  if (s.noConnectedSentences || s.simpleAdditiveText) return 0.5;
  if (s.layeredReasoning && s.implicitMeaning && s.nuancedPerspective) return 5.0;
  let v = 1.0;
  if (s.moderateInference) v = Math.max(v, 2.0);
  if (s.significantInference || s.stanceDetection) v = Math.max(v, 3.0);
  if (s.heavyInference || (s.stanceDetection && s.abstractReasoning)) v = Math.max(v, 4.0);
  if (s.layeredReasoning)  v = Math.min(5.0, v + 0.5);
  if (s.implicitMeaning)   v = Math.min(5.0, v + 0.5);
  return v;
}

// ── Reading modality scorers ──────────────────────────────────────────────────

function scoreParagraphDensity(s) {
  if (s.noConnectedSentences || s.noParagraphDevelopment) return 0.0;
  if (s.simpleAdditiveText) return 0.5;
  let v = 1.5;
  if (s.paragraphLevelDiscourse) v = Math.max(v, 3.0);
  if (s.multiparagraphArgument)  v = Math.max(v, 4.0);
  if (s.multiparagraphArgument && s.paragraphDependency) v = Math.max(v, 5.0);
  return v;
}

function scoreReferenceTracking(s) {
  if (s.noConnectedSentences) return 0.0;
  let v = 1.0;
  if (s.crossSentenceDependency) v = Math.max(v, 2.5);
  if (s.explicitRelationships || s.detailIntegration) v = Math.max(v, 3.0);
  if (s.paragraphDependency)     v = Math.max(v, 4.0);
  if (s.paragraphDependency && s.implicitMeaning) v = Math.max(v, 5.0);
  return v;
}

function scoreConnectorLoad(s) {
  if (s.noConnectedSentences || s.simpleAdditiveText) return 0.5;
  let v = 1.5;
  if (s.explicitRelationships || s.chronologicalSequence) v = Math.max(v, 2.5);
  if (s.multiparagraphArgument || s.paragraphLevelDiscourse) v = Math.max(v, 3.0);
  if (s.paragraphDependency && s.abstractReasoning) v = Math.max(v, 4.0);
  if (s.layeredReasoning) v = Math.max(v, 5.0);
  return v;
}

function scoreTextualOrganization(s) {
  if (s.noConnectedSentences || s.simpleAdditiveText) return 0.5;
  let v = 1.5;
  if (s.chronologicalSequence) v = Math.max(v, 2.5);
  if (s.factualReportingChain || s.paragraphLevelDiscourse) v = Math.max(v, 3.0);
  if (s.multiparagraphArgument) v = Math.max(v, 4.0);
  if (s.multiparagraphArgument && s.layeredReasoning) v = Math.max(v, 5.0);
  return v;
}

// ── Listening modality scorers ────────────────────────────────────────────────

function scoreSpeechRate(mr) {
  // Higher = faster = more demanding
  switch (mr.lsSpeechRate) {
    case "slow":     return 1.0;
    case "moderate": return 2.5;
    case "natural":  return 3.5;
    case "fast":     return 5.0;
    default:         return 2.5;
  }
}

function scoreAudioClarity(mr) {
  // Higher = denser delivery = more demanding
  switch (mr.lsDelivery) {
    case "clear":   return 1.5;
    case "natural": return 3.0;
    case "dense":   return 4.5;
    default:        return 3.0;
  }
}

function scoreNumberOfSpeakers(mr) {
  const dt = (mr.discourseType || "").toLowerCase();
  if (dt.includes("interview") || dt.includes("conversation")) return 3.5;
  if (dt.includes("monologue") || dt.includes("lecture") || dt.includes("news")) return 2.0;
  return 2.5;
}

function scoreRedundancySupport(mr) {
  // Higher = lower redundancy = less support = harder
  switch (mr.lsRedundancy) {
    case "high":   return 1.5;
    case "medium": return 3.0;
    case "low":    return 4.5;
    default:       return 3.0;
  }
}

function scoreSegmentationDifficulty(mr) {
  let v = 1.5;
  switch (mr.lsDiscourseLength) {
    case "short":    v = 1.5; break;
    case "paragraph": v = 2.5; break;
    case "extended": v = 4.0; break;
  }
  switch (mr.lsStructure) {
    case "analytical": v = Math.min(5.0, v + 1.0); break;
    case "narrative":  v = Math.min(5.0, v + 0.5); break;
  }
  return v;
}

// ── Task-demand scorers ───────────────────────────────────────────────────────

function scoreLiteralDetailDemand(s) {
  if (s.noConnectedSentences) return 0.0;
  let v = 1.0;
  if (s.isolatedFacts && s.shortStatements) v = 1.5;
  if (s.detailIntegration || s.explicitRelationships) v = Math.max(v, 3.0);
  if (s.factualReportingChain && s.paragraphLevelDiscourse) v = Math.max(v, 4.0);
  if (s.detailIntegration && s.multiparagraphArgument) v = Math.max(v, 5.0);
  return v;
}

function scoreParaphraseRecognition(s) {
  if (s.noConnectedSentences || s.simpleAdditiveText) return 0.5;
  let v = 1.5;
  if (s.paragraphLevelDiscourse && s.moderateInference) v = Math.max(v, 3.0);
  if (s.multiparagraphArgument  && s.significantInference) v = Math.max(v, 4.0);
  if (s.layeredReasoning        && s.heavyInference) v = Math.max(v, 5.0);
  return v;
}

function scoreInferentialDemand(s) {
  // Task-demand framing of inference; same underlying signals as inferenceLoad.
  return scoreInferenceLoad(s);
}

function scoreToneAttitudeDemand(s) {
  let v = 0.5;
  if (s.stanceDetection) v = Math.max(v, 3.0);
  if (s.stanceDetection && s.abstractReasoning) v = Math.max(v, 4.0);
  if (s.nuancedPerspective && s.layeredReasoning) v = Math.max(v, 5.0);
  return v;
}

function scorePurposeRecognition(s) {
  let v = 1.0;
  if (s.stanceDetection || s.abstractReasoning) v = Math.max(v, 3.0);
  if (s.stanceDetection && s.multiparagraphArgument) v = Math.max(v, 4.0);
  if (s.nuancedPerspective && s.implicitMeaning) v = Math.max(v, 5.0);
  return v;
}

function scoreCompareContrastDemand(s) {
  let v = 0.5;
  if (s.historicalComparison) v = Math.max(v, 3.0);
  if (s.historicalComparison && s.multiparagraphArgument) v = Math.max(v, 4.0);
  if (s.historicalComparison && s.layeredReasoning) v = Math.max(v, 5.0);
  return v;
}

function scoreSynthesisDemand(s) {
  let v = 0.5;
  if (s.paragraphDependency || s.multiparagraphArgument) v = Math.max(v, 3.0);
  if (s.paragraphDependency && s.heavyInference)         v = Math.max(v, 4.0);
  if (s.layeredReasoning    && s.implicitMeaning)        v = Math.max(v, 5.0);
  return v;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * computeNumericScoring
 *
 * @param {object} signals    — normalised detectedSignals from ilrRules.normalizeSignals()
 * @param {object} modelResult — raw model result (for lsSpeechRate, discourseType, etc.)
 * @param {string} mode       — "reading" | "listening"
 * @param {string} finalLevel — gate-assigned ILR level ("1", "1+", "2", "2+", "3", …)
 * @param {string} levelLabel — human-readable label ("ILR 2+", "Low ILR 2+", …)
 * @param {Array}  hardGateLog — from hardGates.applyHardGates()
 *
 * Returns:
 *   core          — { [key]: score }  — 7 core dimension scores
 *   modality      — { [key]: score }  — 4 reading or 5 listening scores
 *   taskDemand    — { [key]: score }  — 7 task-demand scores
 *   combinedScore — weighted average across all applicable dimensions
 *   scoreBandGuidance — ILR band that the combined score falls into (guidance only)
 *   isListening   — boolean
 *   allDimensions — flat array of { key, label, group, score, weight }
 *   gateSummary   — simplified gate pass/fail list
 *   teacherSummary — { finalLevel, combinedScore, scoreBandGuidance,
 *                      strongestIndicators, limitingIndicators }
 */
export function computeNumericScoring(
  signals,
  modelResult,
  mode,
  finalLevel,
  levelLabel,
  hardGateLog = [],
) {
  const s          = signals      || {};
  const mr         = modelResult  || {};
  const isListening = (mode || "reading").toLowerCase() === "listening";

  // ── Compute raw scores ──────────────────────────────────────────────────────
  const core = {
    mainIdeaIntegration:      r1(clamp(scoreMainIdeaIntegration(s))),
    detailExplicitness:       r1(clamp(scoreDetailExplicitness(s))),
    inferenceLoad:            r1(clamp(scoreInferenceLoad(s))),
    discourseOrganization:    r1(clamp(scoreDiscourseOrganization(s))),
    vocabularyAbstraction:    r1(clamp(scoreVocabularyAbstraction(s))),
    sentenceClauseComplexity: r1(clamp(scoreSentenceClauseComplexity(s))),
    interpretationDepth:      r1(clamp(scoreInterpretationDepth(s))),
  };

  const modality = isListening ? {
    speechRate:             r1(clamp(scoreSpeechRate(mr))),
    audioClarity:           r1(clamp(scoreAudioClarity(mr))),
    numberOfSpeakers:       r1(clamp(scoreNumberOfSpeakers(mr))),
    redundancySupport:      r1(clamp(scoreRedundancySupport(mr))),
    segmentationDifficulty: r1(clamp(scoreSegmentationDifficulty(mr))),
  } : {
    paragraphDensity:    r1(clamp(scoreParagraphDensity(s))),
    referenceTracking:   r1(clamp(scoreReferenceTracking(s))),
    connectorLoad:       r1(clamp(scoreConnectorLoad(s))),
    textualOrganization: r1(clamp(scoreTextualOrganization(s))),
  };

  const taskDemand = {
    literalDetailDemand:   r1(clamp(scoreLiteralDetailDemand(s))),
    paraphraseRecognition: r1(clamp(scoreParaphraseRecognition(s))),
    inferentialDemand:     r1(clamp(scoreInferentialDemand(s))),
    toneAttitudeDemand:    r1(clamp(scoreToneAttitudeDemand(s))),
    purposeRecognition:    r1(clamp(scorePurposeRecognition(s))),
    compareContrastDemand: r1(clamp(scoreCompareContrastDemand(s))),
    synthesisDemand:       r1(clamp(scoreSynthesisDemand(s))),
  };

  // ── Weighted combined score ─────────────────────────────────────────────────
  const modalityWeights = isListening ? LISTENING_WEIGHTS : READING_WEIGHTS;
  let combined = 0;
  for (const [k, v] of Object.entries(core))      combined += v * (CORE_WEIGHTS[k]     || 0);
  for (const [k, v] of Object.entries(modality))  combined += v * (modalityWeights[k]  || 0);
  for (const [k, v] of Object.entries(taskDemand)) combined += v * (TASK_WEIGHTS[k]    || 0);
  const combinedScore = r1(combined);

  // ── Score band guidance ─────────────────────────────────────────────────────
  const band = SCORE_BANDS.find(b => combinedScore >= b.min && combinedScore <= b.max)
             || (combinedScore > 4.6 ? SCORE_BANDS[SCORE_BANDS.length - 1] : SCORE_BANDS[0]);
  const scoreBandGuidance = band?.label || "—";

  // ── Flat dimension list ─────────────────────────────────────────────────────
  const allDimensions = [
    ...Object.entries(core).map(([key, score]) => ({
      key, score,
      label:  DIMENSION_LABELS[key] || key,
      group:  "core",
      weight: CORE_WEIGHTS[key] || 0,
    })),
    ...Object.entries(modality).map(([key, score]) => ({
      key, score,
      label:  DIMENSION_LABELS[key] || key,
      group:  "modality",
      weight: modalityWeights[key] || 0,
    })),
    ...Object.entries(taskDemand).map(([key, score]) => ({
      key, score,
      label:  DIMENSION_LABELS[key] || key,
      group:  "taskDemand",
      weight: TASK_WEIGHTS[key] || 0,
    })),
  ];

  // ── Strongest / limiting indicators ────────────────────────────────────────
  // Expected minimum score for the gate-assigned level.
  const levelMin    = LEVEL_EXPECTED_MIN[finalLevel] ?? 3.3;
  const strongThres = Math.min(5.0, levelMin + 0.4); // clearly above expected range

  const strongDimensions = allDimensions
    .filter(d => d.score >= strongThres)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(d => d.label);

  const limitingDimensions = allDimensions
    .filter(d => d.score < levelMin)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(d => d.label);

  // ── Gate summary ────────────────────────────────────────────────────────────
  const gateSummary = (hardGateLog || []).map(g => ({
    gate:             g.gate,
    label:            g.label       || g.gate,
    passed:           !!g.passed,
    description:      g.description || "",
    passCount:        g.passCount        ?? null,
    totalConditions:  g.totalConditions  ?? null,
    failedConditions: g.failedConditions || [],
  }));

  // ── Strength label ───────────────────────────────────────────────────────────
  // Position of combinedScore within the gate-assigned level's score band.
  //   Low   — score is below the band's expected minimum
  //   Solid — score is in the lower half of the band
  //   High  — score is in the upper half of the band
  const strengthLabel = computeStrengthLabel(combinedScore, finalLevel);

  // ── Borderline detection ─────────────────────────────────────────────────────
  // If the combined score is within BORDERLINE_THRESHOLD of a band boundary,
  // flag it as borderline with the adjacent level.
  const borderline = detectBorderline(combinedScore, finalLevel);

  // ── Limiter reasons (what blocked the next level) ───────────────────────────
  const ILR_LEVELS = ["0+", "1", "1+", "2", "2+", "3"];
  const levelIdx   = ILR_LEVELS.indexOf(finalLevel);
  const nextLevel  = levelIdx < ILR_LEVELS.length - 1 ? ILR_LEVELS[levelIdx + 1] : null;
  const limiterReasons = buildLimiterReasons(s, finalLevel, isListening, mr);

  // ── Promotion reasons (what justified the current level) ────────────────────
  const promotionReasons = buildPromotionReasons(s, finalLevel, isListening, mr);

  // ── Teacher summary ─────────────────────────────────────────────────────────
  const teacherSummary = {
    finalLevel:          levelLabel || `ILR ${finalLevel}`,
    strengthLabel,
    combinedScore,
    scoreBandGuidance,
    borderline,
    nextLevel,
    strongestIndicators: strongDimensions.length  ? strongDimensions  : ["—"],
    limitingIndicators:  limitingDimensions.length ? limitingDimensions : ["None identified"],
    limiterReasons,
    promotionReasons,
  };

  return {
    core,
    modality,
    taskDemand,
    combinedScore,
    scoreBandGuidance,
    strengthLabel,
    borderline,
    isListening,
    allDimensions,
    gateSummary,
    teacherSummary,
  };
}

// ── Strength label ────────────────────────────────────────────────────────────

const LEVEL_BANDS = Object.freeze({
  "0+": [0.0, 1.2],
  "1":  [1.3, 2.2],
  "1+": [2.3, 3.2],
  "2":  [3.3, 4.0],
  "2+": [4.1, 4.5],
  "3":  [4.6, 5.0],
});

const BORDERLINE_THRESHOLD = 0.20;

/**
 * Returns "Low", "Solid", or "High" based on where the combined score
 * falls within the gate-assigned level's expected score band.
 */
export function computeStrengthLabel(combinedScore, finalLevel) {
  const band = LEVEL_BANDS[finalLevel];
  if (!band) return "Solid";
  const [lo, hi] = band;
  if (combinedScore < lo) return "Low";
  const mid = (lo + hi) / 2;
  return combinedScore <= mid ? "Solid" : "High";
}

/**
 * Returns a borderline object if the combined score is within
 * BORDERLINE_THRESHOLD of an adjacent band boundary, or null if not borderline.
 *
 * { type: "lower" | "upper", level: string, label: string }
 */
export function detectBorderline(combinedScore, finalLevel) {
  const band = LEVEL_BANDS[finalLevel];
  if (!band) return null;
  const [lo, hi] = band;
  const LEVELS = ["0+", "1", "1+", "2", "2+", "3"];
  const idx = LEVELS.indexOf(finalLevel);

  if (combinedScore < lo + BORDERLINE_THRESHOLD && idx > 0) {
    const lv = LEVELS[idx - 1];
    return { type: "lower", level: lv, label: `ILR ${lv}` };
  }
  if (combinedScore > hi - BORDERLINE_THRESHOLD && idx < LEVELS.length - 1) {
    const lv = LEVELS[idx + 1];
    return { type: "upper", level: lv, label: `ILR ${lv}` };
  }
  return null;
}

// ── Limiter reasons ───────────────────────────────────────────────────────────

/**
 * Returns up to 4 human-readable reasons explaining why the text did NOT
 * reach the next ILR level above the gate-assigned level.
 */
export function buildLimiterReasons(signals, finalLevel, isListening, modelResult) {
  const s  = signals      || {};
  const mr = modelResult  || {};
  const reasons = [];

  switch (finalLevel) {

    case "0+":
      if (!s.multipleSentencesConnected) reasons.push("no connected sentences across the text");
      if (s.simpleAdditiveText && !s.chronologicalSequence) reasons.push("text is an additive list without sequence structure");
      if (s.isolatedFacts && !s.simpleDescriptionPattern) reasons.push("facts appear in isolation without basic cohesion");
      break;

    case "1":
      if (!s.paragraphLevelDiscourse && !s.detailIntegration) reasons.push("no paragraph-level development detected");
      if (!s.moderateInference) reasons.push("no inference required beyond literal reading");
      if (!s.factualReportingChain && !s.chronologicalSequence) reasons.push("no factual chain or sequential logic structure");
      if (!s.explicitRelationships && !s.crossSentenceDependency) reasons.push("no relational language connecting ideas across sentences");
      break;

    case "1+":
      if (!s.significantInference) reasons.push("inference does not rise above moderate level");
      if (!s.abstractReasoning && !s.conceptualVocabulary) reasons.push("no abstract reasoning or conceptual vocabulary present");
      if (!s.multiparagraphArgument && !s.paragraphLevelDiscourse) reasons.push("no cohesive multi-sentence argument structure");
      if (!s.embeddedStructure) reasons.push("no embedded or complex clause structure detected");
      break;

    case "2":
      if (!s.multiparagraphArgument) reasons.push("no multi-paragraph argument requiring integration");
      if (!s.stanceDetection) reasons.push("no viewpoint or stance articulation");
      if (!s.conceptualVocabulary) reasons.push("no conceptual-level vocabulary");
      if (!s.significantInference) reasons.push("inference does not reach significant level");
      break;

    case "2+":
      if (!s.layeredReasoning) reasons.push("no layered or non-linear reasoning detected");
      if (!s.implicitMeaning) reasons.push("implicit meaning not required beyond stated content");
      if (!s.heavyInference) reasons.push("heavy inference burden not established");
      if (!s.paragraphDependency) reasons.push("no cross-paragraph structural dependency");
      if (!s.nuancedPerspective) reasons.push("nuanced perspective not required");
      break;

    case "3":
    default:
      return []; // no level above ILR 3
  }

  if (isListening) {
    if (finalLevel === "1+" && mr.lsInference !== "significant") {
      reasons.push("spoken inference level does not reach the significant threshold");
    }
    if (finalLevel === "2" && mr.lsStructure === "factual") {
      reasons.push("audio structure is factual rather than analytical");
    }
  }

  return reasons.slice(0, 4);
}

// ── Promotion reasons ─────────────────────────────────────────────────────────

/**
 * Returns up to 4 human-readable reasons explaining what signals justified
 * assigning the gate-assigned level rather than a lower one.
 */
export function buildPromotionReasons(signals, finalLevel, isListening, modelResult) {
  const s  = signals      || {};
  const mr = modelResult  || {};
  const reasons = [];

  switch (finalLevel) {

    case "0+":
      reasons.push("text operates at below-sentence level or in disconnected segments");
      if (s.isolatedFacts) reasons.push("isolated facts can be identified with effort");
      break;

    case "1":
      if (s.multipleSentencesConnected) reasons.push("basic sentence connection across the text");
      if (s.chronologicalSequence)      reasons.push("chronological or sequential structure present");
      if (s.simpleDescriptionPattern)   reasons.push("simple descriptive pattern with basic cohesion");
      if (s.shortStatements)            reasons.push("straightforward short statements allow basic comprehension");
      break;

    case "1+":
      if (s.paragraphLevelDiscourse) reasons.push("paragraph-level discourse structure present");
      if (s.detailIntegration)       reasons.push("detail integration across sentences required");
      if (s.factualReportingChain)   reasons.push("factual chain or reporting structure present");
      if (s.explicitRelationships)   reasons.push("explicit relational language connects ideas");
      if (s.moderateInference)       reasons.push("moderate inference sustained across the text");
      break;

    case "2":
      if (s.crossSentenceDependency || s.paragraphLevelDiscourse) reasons.push("cross-sentence dependency requires reference tracking");
      if (s.moderateInference)       reasons.push("moderate inference sustained across the text");
      if (s.abstractReasoning || s.conceptualVocabulary) reasons.push("abstract or conceptual vocabulary present");
      if (s.embeddedStructure)       reasons.push("embedded clause structure adds processing load");
      if (s.multiparagraphArgument)  reasons.push("multi-paragraph argument requires integration");
      break;

    case "2+":
      if (s.multiparagraphArgument) reasons.push("multi-paragraph argument requires integration");
      if (s.stanceDetection)        reasons.push("viewpoint or stance must be tracked");
      if (s.conceptualVocabulary)   reasons.push("conceptual abstraction present");
      if (s.significantInference)   reasons.push("significant inference required throughout");
      if (s.implicitMeaning)        reasons.push("implied relationships must be interpreted");
      if (s.abstractReasoning)      reasons.push("abstract reasoning structure present");
      break;

    case "3":
      if (s.layeredReasoning)    reasons.push("layered, non-linear reasoning throughout");
      if (s.heavyInference)      reasons.push("heavy inference burden sustained across the text");
      if (s.paragraphDependency) reasons.push("cross-paragraph dependency requires synthesis");
      if (s.implicitMeaning)     reasons.push("implicit meaning pervades the discourse");
      if (s.nuancedPerspective)  reasons.push("nuanced perspective requires careful interpretation");
      break;

    default:
      break;
  }

  if (isListening) {
    if (mr.lsSpeechRate === "fast")      reasons.push("fast speech rate increases processing demand");
    if (mr.lsRedundancy === "low")       reasons.push("low redundancy provides minimal listening support");
    if (mr.lsInference === "significant") reasons.push("spoken inference demand at significant level");
  }

  return reasons.slice(0, 4);
}
