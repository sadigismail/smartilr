// ─────────────────────────────────────────────────────────────────────────────
// engine/thresholds.js  —  backward-compatibility re-export barrel
//
// All configuration has been split into three focused files:
//
//   config/scoringConfig.js     — LEVELS, CONFIDENCE_WEIGHTS, THREE_LAYER,
//                                 FACTUAL_DISCOURSE_TYPES, FACTUAL_CEILING
//   config/gateConfig.js        — GATE, LEVEL_CAPS
//                                 (controls ILR 1/1+/2/2+ boundary crossings)
//   config/explanationConfig.js — MANDATORY_PHRASES, SCOPE_OF_RATING,
//                                 LISTENING_CEILING_LABELS, LISTENING_FLOOR_LABELS
//
// This file re-exports everything under the original names so any import that
// still points here continues to work without modification.
// ─────────────────────────────────────────────────────────────────────────────

export { LEVELS, FACTUAL_DISCOURSE_TYPES, FACTUAL_CEILING, CONFIDENCE_WEIGHTS, CONFIDENCE_CAPS, THREE_LAYER }
  from "../config/scoringConfig.js";

export { GATE, LEVEL_CAPS }
  from "../config/gateConfig.js";

export { MANDATORY_PHRASES, SCOPE_OF_RATING, LISTENING_CEILING_LABELS, LISTENING_FLOOR_LABELS }
  from "../config/explanationConfig.js";
