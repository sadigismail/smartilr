// ─────────────────────────────────────────────────────────────────────────────
// engine/modalityAdjustment.js
//
// Modality-specific ILR adjustment.
//
// After the content-based gate pipeline (discourse floor → ceiling rules →
// hard gates) produces a preliminary level, this module computes a weighted
// modality difficulty index from the 5 modality-specific dimensions and
// optionally pushes the final level up one step when the index clears a
// configurable threshold.
//
// Two separate index formulas are used — one for listening (speech rate,
// clarity, segmentation, redundancy, speakers) and one for reading (embedding,
// reference tracking, connector load, paragraph density, text organisation).
//
// The adjustment fires only when:
//   (a) MODALITY_ADJUSTMENT.ENABLE is true
//   (b) no content ceiling rule has already forced the current level down
//   (c) the current level is not already ILR 3 (the top)
//   (d) the modality index ≥ the mode-specific UP_THRESHOLD
//
// All thresholds and weights live in config/gateConfig.js → MODALITY_ADJUSTMENT.
// ─────────────────────────────────────────────────────────────────────────────

import { LEVELS }              from "../config/scoringConfig.js";
import { MODALITY_ADJUSTMENT } from "../config/gateConfig.js";
import { levelIndex }          from "./ilrRules.js";

const r1 = (v) => Math.round(v * 10) / 10;

// ── Dimension metadata ────────────────────────────────────────────────────────

const LISTENING_DIMS = [
  {
    key:   "speechRate",
    label: "Speech rate",
    hint:  "Elevated speech rate reduces the processing time available per utterance, increasing the cognitive load required to identify the main idea and supporting detail before the next utterance begins.",
  },
  {
    key:   "audioClarity",
    label: "Delivery clarity",
    hint:  "Dense or reduced articulation increases the effort required to decode individual utterances before discourse-level comprehension can proceed. The listener must resolve phonological ambiguity before constructing meaning.",
  },
  {
    key:   "segmentationDifficulty",
    label: "Segmentation difficulty",
    hint:  "Difficulty identifying utterance and phrase boundaries places additional demands on the listener before meaning can be constructed from connected discourse.",
  },
  {
    key:   "redundancySupport",
    label: "Redundancy support",
    hint:  "Limited restatement or paraphrase requires the listener to retain and consolidate the main idea and supporting detail from a single hearing, without the scaffolding of repetition or reformulation.",
  },
  {
    key:   "numberOfSpeakers",
    label: "Speaker configuration",
    hint:  "Multiple or overlapping speakers increase the discourse tracking demands placed on the listener, requiring continuous reassignment of discourse roles and reference across speaker turns.",
  },
];

const READING_DIMS = [
  {
    key:   "embeddedClauses",
    label: "Clause embedding",
    hint:  "Nested or stacked subordinate clauses require sustained syntactic processing before the main predicate and its relationship to the main idea can be resolved.",
  },
  {
    key:   "referenceTracking",
    label: "Reference tracking",
    hint:  "Anaphoric chains, nominal reference, and cross-sentence co-reference require the reader to maintain referential mappings across sentence boundaries to construct coherent discourse-level meaning.",
  },
  {
    key:   "connectorLoad",
    label: "Connector load",
    hint:  "Explicit cohesive devices — conjunctive adverbials, relative markers, discourse connectors — require the reader to track and evaluate logical relationships between clauses and across paragraph boundaries.",
  },
  {
    key:   "paragraphDensity",
    label: "Paragraph density",
    hint:  "High information density at the paragraph level requires the reader to integrate multiple supporting details with the main idea without the support of redundancy or paraphrase.",
  },
  {
    key:   "textualOrganization",
    label: "Textual organisation",
    hint:  "Complex genre structure or non-canonical discourse organization requires the reader to apply schematic knowledge to construct the overall purpose and main idea of the passage.",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function dimLevel(score) {
  if (score >= MODALITY_ADJUSTMENT.DIMENSION_HIGH_THRESHOLD) return "high";
  if (score <= MODALITY_ADJUSTMENT.DIMENSION_LOW_THRESHOLD)  return "low";
  return "moderate";
}

function computeWeightedIndex(dims, weights) {
  let sum = 0;
  for (const [key, w] of Object.entries(weights)) {
    sum += (dims[key] ?? 0) * w;
  }
  return r1(sum);
}

// ── Explanation builder ───────────────────────────────────────────────────────

function buildExplanation(dimMeta, dims, modalityIndex, mode, adjustment, baseLevel, adjustedLevel) {
  const MA        = MODALITY_ADJUSTMENT;
  const threshold = mode === "listening" ? MA.LISTENING_UP_THRESHOLD : MA.READING_UP_THRESHOLD;
  const agent     = mode === "listening" ? "listener" : "reader";
  const noun      = mode === "listening" ? "listening" : "reading";

  // Classify dimensions
  const high = [];
  const mod  = [];
  const low  = [];

  for (const { key, label, hint } of dimMeta) {
    const score = r1(dims[key] ?? 0);
    const lev   = dimLevel(score);
    const entry = { label, score, hint };
    if (lev === "high")     high.push(entry);
    else if (lev === "low") low.push(entry);
    else                    mod.push(entry);
  }

  const intro = modalityIndex >= threshold
    ? `The ${noun} modality difficulty index for this sample is ${modalityIndex}/10, which meets or exceeds the adjustment threshold of ${threshold}. ` +
      `The processing demands placed on the ${agent} by the ${noun} conditions of this material extend beyond those captured by content complexity alone.`
    : `The ${noun} modality difficulty index for this sample is ${modalityIndex}/10. ` +
      `The processing demands placed on the ${agent} by the ${noun} conditions of this material ` +
      `do not exceed the adjustment threshold of ${threshold} and are consistent with the content-based rating.`;

  const sections = [];

  if (high.length > 0) {
    const items = high.map(d => `${d.label} (${d.score}/10): ${d.hint}`).join(" ");
    sections.push(`Factors rated at high difficulty: ${items}`);
  }
  if (mod.length > 0) {
    const items = mod.map(d => `${d.label} (${d.score}/10)`).join("; ");
    sections.push(`Factors rated at moderate difficulty: ${items}.`);
  }
  if (low.length > 0) {
    const items = low.map(d => `${d.label} (${d.score}/10): ${d.hint}`).join(" ");
    sections.push(`Factors rated at low difficulty: ${items}`);
  }

  let conclusion;
  if (adjustment > 0) {
    conclusion =
      `The ${noun} modality difficulty index of ${modalityIndex}/10 meets the threshold for an upward adjustment. ` +
      `The processing conditions of this material require the ${agent} to perform comprehension operations ` +
      `— such as identifying the main idea, retaining supporting detail, and tracking discourse organization — ` +
      `under conditions that are more demanding than the content complexity alone would indicate. ` +
      `Note: this modality analysis is provided for instructor transparency only. ` +
      `The final ILR rating is determined exclusively by the signal-based boundary engine (Step 3) ` +
      `and is not adjusted by this index.`;
  } else {
    conclusion =
      `The ${noun} modality difficulty index of ${modalityIndex}/10 does not meet the threshold of ${threshold} ` +
      `required for an upward adjustment. The processing conditions of this material are consistent with ` +
      `the comprehension demands established by the content-based analysis. ` +
      `Note: this modality analysis is provided for instructor transparency only and does not affect the final ILR level.`;
  }

  return [intro, ...sections, conclusion].join("\n\n");
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * computeModalityAdjustment
 *
 * @param {string} level         - Current ILR level string after gates (e.g. "1+")
 * @param {object} modalityDims  - The threeLayers.modalityDifficulty object (from threeLayers.js)
 * @param {string} mode          - "reading" | "listening"
 * @param {boolean} ceilingApplied - Whether a content ceiling rule forced the level down
 * @returns {object}
 *   { adjustedLevel, adjustment, modalityIndex, contributingFactors,
 *     modalityExplanation, modalityDimensionScores, modalityAdjustmentApplied, modalityAdjustmentReason }
 */
export function computeModalityAdjustment(level, modalityDims, mode, ceilingApplied) {
  const MA = MODALITY_ADJUSTMENT;

  // Disabled — return pass-through
  if (!MA.ENABLE) {
    return {
      adjustedLevel:            level,
      adjustment:               0,
      modalityIndex:            0,
      contributingFactors:      [],
      modalityExplanation:      "Modality adjustment system is disabled.",
      modalityDimensionScores:  {},
      modalityAdjustmentApplied: false,
      modalityAdjustmentReason:  null,
    };
  }

  // Compute weighted index
  const weights      = mode === "listening" ? MA.LISTENING_WEIGHTS : MA.READING_WEIGHTS;
  const modalityIndex = computeWeightedIndex(modalityDims, weights);

  // Classify each dimension as a contributing factor
  const dimMeta    = mode === "listening" ? LISTENING_DIMS : READING_DIMS;
  const contributingFactors = dimMeta.map(({ key, label, hint }) => {
    const score = r1(modalityDims[key] ?? 0);
    return { dimension: key, label, score, level: dimLevel(score), hint };
  });

  // Determine whether an upward adjustment fires
  const threshold  = mode === "listening" ? MA.LISTENING_UP_THRESHOLD : MA.READING_UP_THRESHOLD;
  const idx        = levelIndex(level);
  const canAdjust  = !ceilingApplied && idx < LEVELS.length - 1 && modalityIndex >= threshold;

  const adjustment       = canAdjust ? 1 : 0;
  const baseLevel        = level;
  const adjustedLevel    = canAdjust ? LEVELS[idx + 1] : level;
  const modalityAdjustmentApplied = canAdjust;
  const modalityAdjustmentReason  = canAdjust
    ? `The ${mode} modality difficulty index of ${modalityIndex}/10 meets or exceeds the adjustment threshold of ${threshold}. ` +
      `Processing conditions for this material are rated at the ILR ${adjustedLevel} level on the modality dimension. ` +
      `Note: this is for instructor transparency only — the final ILR level is determined by the signal-based boundary engine.`
    : null;

  const modalityExplanation = buildExplanation(
    dimMeta, modalityDims, modalityIndex, mode,
    adjustment, baseLevel, adjustedLevel
  );

  return {
    adjustedLevel,
    adjustment,
    modalityIndex,
    contributingFactors,
    modalityExplanation,
    modalityDimensionScores: { ...modalityDims },
    modalityAdjustmentApplied,
    modalityAdjustmentReason,
  };
}
