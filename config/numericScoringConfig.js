// ─────────────────────────────────────────────────────────────────────────────
// config/numericScoringConfig.js
//
// Configuration for the numeric scoring panel (0.0–5.0 per dimension).
//
// All weights are editable here.  Do not touch engine logic (numericScoring.js)
// to adjust numeric output — change the values in this file instead.
//
// IMPORTANT: numeric scores are INFORMATIONAL.  They do not drive level
// assignment.  Gates decide the level first; scores provide transparency.
//
// Sections:
//   1.  SCORE_BANDS          — guidance bands mapping score ranges to ILR levels
//   2.  LEVEL_EXPECTED_MIN   — minimum expected combined score per ILR level
//   3.  CORE_WEIGHTS         — weights for the 7 core dimensions (sum to 0.50)
//   4.  READING_WEIGHTS      — weights for the 4 reading-only dimensions (sum to 0.25)
//   5.  LISTENING_WEIGHTS    — weights for the 5 listening-only dimensions (sum to 0.25)
//   6.  TASK_WEIGHTS         — weights for the 7 task-demand dimensions (sum to 0.25)
//   7.  DIMENSION_LABELS     — human-readable labels for every dimension key
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Score bands (guidance only — do NOT use for automatic level assignment) ─
//
// These are reference ranges to help teachers interpret the combined score.
// The final level is always decided by the gate system, not by these bands.
//
export const SCORE_BANDS = Object.freeze([
  { min: 0.0, max: 0.9, level: "0+", label: "ILR 0+" },
  { min: 1.0, max: 1.5, level: "1",  label: "ILR 1"  },
  { min: 1.6, max: 2.1, level: "1+", label: "ILR 1+" },
  { min: 2.2, max: 2.7, level: "2",  label: "ILR 2"  },
  { min: 2.8, max: 3.3, level: "2+", label: "ILR 2+" },
  { min: 3.4, max: 3.9, level: "3",  label: "ILR 3"  },
  { min: 4.0, max: 4.3, level: "3+", label: "ILR 3+" },
  { min: 4.4, max: 4.6, level: "4",  label: "ILR 4"  },
  { min: 4.7, max: 4.8, level: "4+", label: "ILR 4+" },
  { min: 4.9, max: 5.0, level: "5",  label: "ILR 5"  },
]);

// ── 2. Expected minimum combined score per assigned ILR level ──────────────────
//
// Used to classify dimensions as "supporting" (above this threshold)
// or "limiting" (below this threshold) for a given assigned level.
//
export const LEVEL_EXPECTED_MIN = Object.freeze({
  "0+": 0.5,
  "1":  1.0,
  "1+": 1.6,
  "2":  2.2,
  "2+": 2.8,
  "3":  3.4,
  "3+": 4.0,
  "4":  4.4,
  "4+": 4.7,
  "5":  4.9,
});

// ── 3. Core dimension weights ─────────────────────────────────────────────────
//
// Must sum to exactly 0.50.
//
export const CORE_WEIGHTS = Object.freeze({
  mainIdeaIntegration:      0.08,
  detailExplicitness:       0.06,
  inferenceLoad:            0.10,  // highest weight: primary ILR discriminator
  discourseOrganization:    0.08,
  vocabularyAbstraction:    0.06,
  sentenceClauseComplexity: 0.06,
  interpretationDepth:      0.06,
});

// ── 4. Reading-only modality weights ─────────────────────────────────────────
//
// Must sum to exactly 0.25.
//
export const READING_WEIGHTS = Object.freeze({
  paragraphDensity:    0.07,
  referenceTracking:   0.06,
  connectorLoad:       0.06,
  textualOrganization: 0.06,
});

// ── 5. Listening-only modality weights ───────────────────────────────────────
//
// Must sum to exactly 0.25.
//
export const LISTENING_WEIGHTS = Object.freeze({
  speechRate:             0.05,
  audioClarity:           0.05,
  numberOfSpeakers:       0.04,
  redundancySupport:      0.06,
  segmentationDifficulty: 0.05,
});

// ── 6. Task-demand dimension weights ─────────────────────────────────────────
//
// Must sum to exactly 0.25.
//
export const TASK_WEIGHTS = Object.freeze({
  literalDetailDemand:   0.03,
  paraphraseRecognition: 0.03,
  inferentialDemand:     0.05,  // highest: mirrors inferenceLoad importance
  toneAttitudeDemand:    0.04,
  purposeRecognition:    0.03,
  compareContrastDemand: 0.03,
  synthesisDemand:       0.04,
});

// ── 7. Human-readable labels ──────────────────────────────────────────────────
//
// These strings appear in the report panel and teacher summary.
//
export const DIMENSION_LABELS = Object.freeze({
  // Core
  mainIdeaIntegration:      "Main Idea Integration",
  detailExplicitness:       "Detail Explicitness",
  inferenceLoad:            "Inference Load",
  discourseOrganization:    "Discourse Organization",
  vocabularyAbstraction:    "Vocabulary Abstraction",
  sentenceClauseComplexity: "Sentence / Clause Complexity",
  interpretationDepth:      "Interpretation Depth",

  // Reading modality
  paragraphDensity:    "Paragraph Density",
  referenceTracking:   "Reference Tracking",
  connectorLoad:       "Connector Load",
  textualOrganization: "Textual Organization",

  // Listening modality
  speechRate:             "Speech Rate",
  audioClarity:           "Audio Clarity",
  numberOfSpeakers:       "Number of Speakers",
  redundancySupport:      "Redundancy / Support",
  segmentationDifficulty: "Segmentation Difficulty",

  // Task demand
  literalDetailDemand:   "Literal Detail Demand",
  paraphraseRecognition: "Paraphrase Recognition",
  inferentialDemand:     "Inferential Demand",
  toneAttitudeDemand:    "Tone / Attitude Demand",
  purposeRecognition:    "Purpose Recognition",
  compareContrastDemand: "Compare / Contrast Demand",
  synthesisDemand:       "Synthesis Demand",
});
