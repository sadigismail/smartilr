// ─────────────────────────────────────────────────────────────────────────────
// engine/threeLayers.js
//
// Three-Layer ILR Scoring System
//
// Computes three independent sub-scores (each 0–10, higher = more complex):
//
//   Layer 1 — Passage Complexity   (8 dimensions)
//     mainIdeaAccessibility, detailExplicitness, inferenceDemand,
//     discourseOrganization, vocabularyAbstraction, sentenceClauseComplexity,
//     genrePurposeComplexity, culturalContextDependency
//
//   Layer 2 — Task Demand          (7 dimensions)
//     literalDetail, paraphraseRecognition, inference, toneAttitude,
//     speakerAuthorPurpose, compareContrast, synthesisAcrossPassage
//
//   Layer 3 — Modality Difficulty  (5 dimensions)
//     Listening: speechRate, audioClarity, numberOfSpeakers,
//                redundancySupport, segmentationDifficulty
//     Reading:   paragraphDensity, embeddedClauses, referenceTracking,
//                connectorLoad, textualOrganization
//
// Combined score = weighted average of the three sub-scores.
// All weights and anchor values are configurable in thresholds.js (THREE_LAYER).
//
// No gate or placement logic lives here.  This module is purely additive —
// its output is attached to the API response alongside, not instead of, the
// existing ILR gate result.
// ─────────────────────────────────────────────────────────────────────────────

import { THREE_LAYER } from "../config/scoringConfig.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const clamp  = (v, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, v));
const r1     = (v) => Math.round(v * 10) / 10;
const mean   = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;

// Normalise discourseType to a consistent lowercase key used by config lookups.
function dtKey(modelResult) {
  return (modelResult.discourseType || "").toLowerCase().trim();
}

// Look up a discourseType in a config map (falls back to DEFAULT).
function lookup(map, key) {
  return map[key] ?? map.DEFAULT ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — Passage Complexity (8 dimensions)
// ─────────────────────────────────────────────────────────────────────────────

function mainIdeaAccessibility(s) {
  const C = THREE_LAYER.MAIN_IDEA;
  if (s.noConnectedSentences)   return C.noSentences;
  if (s.heavyInference)         return C.heavyInference;
  if (s.significantInference)   return C.significantInference;
  if (s.moderateInference)      return C.moderateInference;
  if (s.paragraphLevelDiscourse || s.factualReportingChain || s.detailIntegration) {
    return C.paragraphExplicit;
  }
  if (s.multipleSentencesConnected || s.crossSentenceDependency) {
    return C.shortConnected;
  }
  if (s.isolatedFacts || s.shortStatements) return C.isolated;
  return C.shortConnected;
}

function detailExplicitness(s) {
  // Higher = details are more implicit / harder to extract.
  if (s.noConnectedSentences) return 0;
  if (s.heavyInference)       return 9;
  if (s.significantInference) return 7;
  if (s.moderateInference)    return 5;
  if (s.detailIntegration)    return 4;
  if (s.paragraphLevelDiscourse || s.factualReportingChain) return 3;
  if (s.multipleSentencesConnected || s.crossSentenceDependency) return 2;
  return 1;
}

function inferenceDemand(s) {
  const C = THREE_LAYER.INFERENCE;
  let score = C.none;
  if (s.moderateInference)    score = C.moderate;
  if (s.significantInference) score = Math.max(score, C.significant);
  if (s.heavyInference)       score = Math.max(score, C.heavy);
  if (s.abstractReasoning)    score += C.abstractBonus;
  if (s.stanceDetection)      score += C.stanceBonus;
  return clamp(score);
}

function discourseOrganization(s, modelResult) {
  const C   = THREE_LAYER.DISCOURSE_ORG;
  let score = lookup(C, dtKey(modelResult));
  if (s.paragraphDependency)    score += C.paragraphDependencyBonus;
  if (s.multiparagraphArgument) score += C.multiparagraphBonus;
  return clamp(score);
}

function vocabularyAbstraction(s) {
  const C = THREE_LAYER.VOCAB;
  let score = C.base;
  if (s.conceptualVocabulary)  score += C.conceptualBonus;
  if (s.abstractReasoning)     score += C.abstractBonus;
  if (s.historicalComparison)  score += C.historicalBonus;
  if (s.multiparagraphArgument)score += C.multiparagraphBonus;
  return clamp(score);
}

function sentenceClauseComplexity(s) {
  const C = THREE_LAYER.SYNTAX;
  let score = C.base;
  if (s.crossSentenceDependency) score += C.crossSentenceBonus;
  if (s.embeddedStructure)       score += C.embeddedStructureBonus;
  if (s.paragraphDependency)     score += C.paragraphDepBonus;
  return clamp(score);
}

function genrePurposeComplexity(modelResult) {
  return clamp(lookup(THREE_LAYER.GENRE, dtKey(modelResult)));
}

function culturalContextDependency(s) {
  const C = THREE_LAYER.CULTURAL;
  let score = C.base;
  if (s.historicalComparison) score += C.historicalBonus;
  if (s.abstractReasoning)    score += C.abstractBonus;
  if (s.stanceDetection)      score += C.stanceBonus;
  if (s.conceptualVocabulary) score += C.conceptualBonus;
  return clamp(score);
}

function passageComplexityLayer(s, modelResult) {
  const dims = {
    mainIdeaAccessibility:    r1(mainIdeaAccessibility(s)),
    detailExplicitness:       r1(detailExplicitness(s)),
    inferenceDemand:          r1(inferenceDemand(s)),
    discourseOrganization:    r1(discourseOrganization(s, modelResult)),
    vocabularyAbstraction:    r1(vocabularyAbstraction(s)),
    sentenceClauseComplexity: r1(sentenceClauseComplexity(s)),
    genrePurposeComplexity:   r1(genrePurposeComplexity(modelResult)),
    culturalContextDependency:r1(culturalContextDependency(s)),
  };
  return { ...dims, subScore: r1(mean(Object.values(dims))) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — Task Demand (7 dimensions)
// ─────────────────────────────────────────────────────────────────────────────

function literalDetail(s) {
  const C = THREE_LAYER.LITERAL_DETAIL;
  let score = C.base;
  if (s.detailIntegration)      score += C.detailIntegrationBonus;
  if (s.factualReportingChain)  score += C.factualChainBonus;
  if (s.chronologicalSequence)  score += C.chronologicalBonus;
  if (s.paragraphLevelDiscourse)score += C.paragraphLevelBonus;
  if (s.crossSentenceDependency)score += C.crossSentenceBonus;
  return clamp(score);
}

function paraphraseRecognition(s) {
  const C = THREE_LAYER.PARAPHRASE;
  let score = C.base;
  if (s.conceptualVocabulary)    score += C.conceptualVocabBonus;
  if (s.embeddedStructure)       score += C.embeddedStructureBonus;
  if (s.detailIntegration)       score += C.detailIntegrationBonus;
  if (s.multipleSentencesConnected) score += C.multipleSentencesBonus;
  return clamp(score);
}

function taskInference(s) {
  // Same logic as passage inferenceDemand but framed as a task demand score.
  return r1(inferenceDemand(s));
}

function toneAttitude(s, modelResult) {
  const C  = THREE_LAYER.TONE;
  const dt = dtKey(modelResult);
  let score = C.base;
  if (s.stanceDetection)        score += C.stanceBonus;
  if (s.multiparagraphArgument) score += C.multiparagraphBonus;
  if (s.significantInference)   score += C.significantInferenceBonus;
  if (s.heavyInference)         score += C.heavyInferenceBonus;
  if (dt.includes("opinion") || dt.includes("editorial") || dt.includes("analytical")) {
    score += C.editorialGenreBonus;
  }
  return clamp(score);
}

function speakerAuthorPurpose(s, modelResult) {
  const C  = THREE_LAYER.PURPOSE;
  const dt = dtKey(modelResult);
  let score = C.base;
  if (s.stanceDetection)        score += C.stanceBonus;
  if (s.multiparagraphArgument) score += C.multiparagraphBonus;
  if (dt.includes("analytical") || dt.includes("argumentative") || dt.includes("editorial")) {
    score += C.analyticalGenreBonus;
  }
  if (s.significantInference || s.heavyInference) score += C.significantInferenceBonus;
  return clamp(score);
}

function compareContrast(s) {
  const C = THREE_LAYER.COMPARE;
  let score = C.base;
  if (s.historicalComparison)   score += C.historicalBonus;
  if (s.multiparagraphArgument) score += C.multiparagraphBonus;
  if (s.paragraphDependency)    score += C.paragraphDepBonus;
  return clamp(score);
}

function synthesisAcrossPassage(s) {
  const C = THREE_LAYER.SYNTHESIS;
  let score = C.base;
  if (s.paragraphDependency)    score += C.paragraphDepBonus;
  if (s.detailIntegration)      score += C.detailIntegrationBonus;
  if (s.multiparagraphArgument) score += C.multiparagraphBonus;
  return clamp(score);
}

function taskDemandLayer(s, modelResult) {
  const dims = {
    literalDetail:          r1(literalDetail(s)),
    paraphraseRecognition:  r1(paraphraseRecognition(s)),
    inference:              r1(taskInference(s)),
    toneAttitude:           r1(toneAttitude(s, modelResult)),
    speakerAuthorPurpose:   r1(speakerAuthorPurpose(s, modelResult)),
    compareContrast:        r1(compareContrast(s)),
    synthesisAcrossPassage: r1(synthesisAcrossPassage(s)),
  };
  return { ...dims, subScore: r1(mean(Object.values(dims))) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 3a — Listening Modality Difficulty (5 dimensions)
// ─────────────────────────────────────────────────────────────────────────────

function lSpeechRate(modelResult) {
  const rate = (modelResult.lsSpeechRate || "").toLowerCase().trim();
  return clamp(THREE_LAYER.SPEECH_RATE[rate] ?? THREE_LAYER.SPEECH_RATE.DEFAULT);
}

function lAudioClarity(modelResult) {
  const del = (modelResult.lsDelivery || "").toLowerCase().trim();
  return clamp(THREE_LAYER.AUDIO_CLARITY[del] ?? THREE_LAYER.AUDIO_CLARITY.DEFAULT);
}

function lNumberOfSpeakers(modelResult) {
  const C  = THREE_LAYER.SPEAKERS;
  const dt = dtKey(modelResult);
  if (dt.includes("conversation"))    return C.many;
  if (dt.includes("interview"))       return C.multiple;
  if (dt.includes("monologue") || dt.includes("lecture") ||
      dt.includes("news broadcast") || dt.includes("instructional") ||
      dt.includes("narrative")) {
    return C.single;
  }
  return C.DEFAULT;
}

function lRedundancySupport(modelResult) {
  const red = (modelResult.lsRedundancy || "").toLowerCase().trim();
  return clamp(THREE_LAYER.REDUNDANCY[red] ?? THREE_LAYER.REDUNDANCY.DEFAULT);
}

function lSegmentationDifficulty(modelResult) {
  const del  = (modelResult.lsDelivery        || "").toLowerCase().trim();
  const disc = (modelResult.lsDiscourseLength  || "").toLowerCase().trim();
  const key  = `${del}+${disc}`;
  return clamp(THREE_LAYER.SEGMENTATION[key] ?? THREE_LAYER.SEGMENTATION.DEFAULT);
}

function listeningModalityLayer(modelResult) {
  const dims = {
    speechRate:             r1(lSpeechRate(modelResult)),
    audioClarity:           r1(lAudioClarity(modelResult)),
    numberOfSpeakers:       r1(lNumberOfSpeakers(modelResult)),
    redundancySupport:      r1(lRedundancySupport(modelResult)),
    segmentationDifficulty: r1(lSegmentationDifficulty(modelResult)),
  };
  return { ...dims, subScore: r1(mean(Object.values(dims))) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 3b — Reading Modality Difficulty (5 dimensions)
// ─────────────────────────────────────────────────────────────────────────────

function rParagraphDensity(s) {
  const C = THREE_LAYER.PARA_DENSITY;
  if (s.noConnectedSentences) return C.noSentences;

  let score;
  if (s.isolatedFacts || s.shortStatements) {
    score = C.isolated;
  } else if (s.multipleSentencesConnected || s.crossSentenceDependency) {
    score = C.shortConnected;
  } else {
    score = C.shortConnected;
  }

  if (s.paragraphLevelDiscourse || s.factualReportingChain || s.detailIntegration) {
    score = Math.max(score, C.paragraphLevel);
  }
  if (s.factualReportingChain)  score += C.factualChainBonus;
  if (s.chronologicalSequence)  score += C.chronologicalBonus;
  if (s.detailIntegration)      score += C.detailIntegrationBonus;
  if (s.multiparagraphArgument) score += C.multiparagraphBonus;
  return clamp(score);
}

function rEmbeddedClauses(s) {
  const C = THREE_LAYER.EMBEDDED_CLAUSES;
  if (!s.embeddedStructure) {
    let score = C.base;
    if (s.paragraphDependency) score += C.paragraphDepBonus;
    return clamp(score);
  }
  let score = C.embeddedStructureScore;
  if (s.paragraphDependency) score += C.paragraphDepBonus;
  if (s.abstractReasoning)   score += C.abstractBonus;
  return clamp(score);
}

function rReferenceTracking(s) {
  const C = THREE_LAYER.REFERENCE_TRACKING;
  if (!s.crossSentenceDependency) return C.base;
  let score = C.crossSentenceScore;
  if (s.paragraphDependency)  score += C.paragraphDepBonus;
  if (s.detailIntegration)    score += C.detailIntegrationBonus;
  return clamp(score);
}

function rConnectorLoad(s) {
  const C = THREE_LAYER.CONNECTOR_LOAD;
  if (!s.explicitRelationships) {
    let score = C.base;
    if (s.multipleSentencesConnected) score += C.multipleSentencesBonus;
    return clamp(score);
  }
  let score = C.explicitRelationshipsScore;
  if (s.chronologicalSequence)    score += C.chronologicalBonus;
  if (s.multipleSentencesConnected)score += C.multipleSentencesBonus;
  if (s.multiparagraphArgument)   score += C.multiparagraphBonus;
  return clamp(score);
}

function rTextualOrganization(s, modelResult) {
  const C = THREE_LAYER.TEXT_ORG;
  if (s.noConnectedSentences) return 0;
  let score = lookup(C, dtKey(modelResult));
  if (s.multiparagraphArgument) score += C.multiparagraphBonus;
  if (s.paragraphDependency)    score += C.paragraphDepBonus;
  return clamp(score);
}

function readingModalityLayer(s, modelResult) {
  const dims = {
    paragraphDensity:    r1(rParagraphDensity(s)),
    embeddedClauses:     r1(rEmbeddedClauses(s)),
    referenceTracking:   r1(rReferenceTracking(s)),
    connectorLoad:       r1(rConnectorLoad(s)),
    textualOrganization: r1(rTextualOrganization(s, modelResult)),
  };
  return { ...dims, subScore: r1(mean(Object.values(dims))) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeThreeLayers
 *
 * @param {object} signals     - normalised detectedSignals from the model
 * @param {object} modelResult - full raw model result (for discourseType, ls* fields, etc.)
 * @param {string} mode        - "reading" | "listening"
 * @returns {object}           - { passageComplexity, taskDemand, modalityDifficulty, combinedScore }
 */
export function computeThreeLayers(signals = {}, modelResult = {}, mode = "reading") {
  const s  = signals;
  const W  = THREE_LAYER.WEIGHTS;

  const passageComplexity   = passageComplexityLayer(s, modelResult);
  const taskDemand          = taskDemandLayer(s, modelResult);
  const modalityDifficulty  = mode === "listening"
    ? listeningModalityLayer(modelResult)
    : readingModalityLayer(s, modelResult);

  const combinedScore = r1(
    passageComplexity.subScore  * W.passageComplexity  +
    taskDemand.subScore         * W.taskDemand         +
    modalityDifficulty.subScore * W.modalityDifficulty
  );

  return {
    passageComplexity,
    taskDemand,
    modalityDifficulty: {
      mode,
      ...modalityDifficulty,
    },
    combinedScore,
  };
}
