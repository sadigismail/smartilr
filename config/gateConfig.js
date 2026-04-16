// ─────────────────────────────────────────────────────────────────────────────
// config/gateConfig.js
//
// Gate thresholds and level-boundary controls.
// Edit this file to move the boundary between any adjacent ILR pair without
// touching engine logic.
//
// HOW THE BOUNDARIES WORK
// ───────────────────────
// ILR 1 → 1+  boundary
//   • ENABLE_1PLUS_SHORTCONNECTED_CAP: when true a passage with only short
//     connected discourse (no paragraph-level signals) is capped at ILR 1+.
//     Set to false to remove the cap and let the floor gates decide.
//
// ILR 1+ → 2  boundary
//   • ENABLE_2_GATE_CAP: when true a passage must pass the paragraph
//     integration gate (paragraphLevel + at least one discourse-relation
//     signal + at least one inference or factual-chain signal) before it can
//     be labeled ILR 2.  If only paragraph-level integration is present, the
//     ceiling stays at ILR 1+.
//   • ILR2_INFERENCE_FEATURE_MIN: minimum advancedFeatureCount for a
//     non-factual significantInference passage to trigger the ILR 2 floor.
//
// ILR 2 → 2+  boundary
//   • ENABLE_2_CAP: when true a passage that meets ILR 2 but none of the
//     ILR2PLUS_CRITERIA is capped at ILR 2.
//   • ILR2PLUS_CRITERIA: flags that individually qualify a passage for ILR 2+.
//     Disable specific criteria by setting them to false.
//   • ILR2PLUS_NONFACTUAL_FEATURE_MIN: minimum count for non-factual
//     significantInference → ILR 2+ floor.
//
// ILR 2+ → 3  boundary
//   • ILR3_FLOOR_FEATURE_MIN: minimum advancedFeatureCount for non-factual
//     heavy-inference + abstractReasoning + paragraphDependency passages to
//     trigger the ILR 3 floor gate.
//   • ENABLE_3_SINGLE_PARA_CAP: quick ceiling — single-paragraph texts (no
//     multiparagraphArgument and no paragraphDependency), OR texts with neither
//     heavy inference nor abstraction, are capped at ILR 2+.
//   • ENABLE_3_GATE_CAP: hard gate — all 10 ILR 3 conditions must pass or the
//     level is demoted from ILR 3 to ILR 2+.
//   • ENABLE_3_EXPLANATORY_CAP: ceilings R9/R10 — explanatory text and simple
//     arguments are capped at ILR 2+ regardless of abstraction/inference level.
// ─────────────────────────────────────────────────────────────────────────────

// ── Modality adjustment thresholds ───────────────────────────────────────────
//
// Controls when modality-specific dimension scores push the final ILR level
// up one step beyond the content-only placement.
//
// The weighted index for each mode is computed from 5 dimensions (each 0–10).
// When the index exceeds the UP_THRESHOLD and no content ceiling rule has
// already forced the current level, the rating is pushed up one step.
//
// Weights within each mode must sum to 1.0.
// Adjust weights to change which dimensions carry the most influence.
//
export const MODALITY_ADJUSTMENT = Object.freeze({

  // ── Listening dimension weights ──────────────────────────────────────────
  // Higher weight = that dimension drives the index more.
  LISTENING_WEIGHTS: Object.freeze({
    speechRate:             0.30, // fast speech → more difficult
    audioClarity:           0.25, // dense delivery → more difficult
    segmentationDifficulty: 0.25, // hard to separate utterances → more difficult
    redundancySupport:      0.15, // low redundancy → more difficult
    numberOfSpeakers:       0.05, // many speakers → slightly more difficult
  }),

  // Listening difficulty index (0–10) at or above which the level is pushed up.
  LISTENING_UP_THRESHOLD: 6.5,

  // ── Reading dimension weights ────────────────────────────────────────────
  READING_WEIGHTS: Object.freeze({
    embeddedClauses:     0.30, // heavy embedding → more difficult
    referenceTracking:   0.25, // dense cross-reference → more difficult
    connectorLoad:       0.20, // complex cohesion → more difficult
    paragraphDensity:    0.15, // high paragraph-level integration → more difficult
    textualOrganization: 0.10, // complex organization → more difficult
  }),

  // Reading difficulty index (0–10) at or above which the level is pushed up.
  READING_UP_THRESHOLD: 7.5,

  // ── Contributing factor thresholds ───────────────────────────────────────
  // Scores at or above this value are labelled "high" in the explanation.
  DIMENSION_HIGH_THRESHOLD: 6.5,
  // Scores at or below this value are labelled "low" in the explanation.
  DIMENSION_LOW_THRESHOLD:  3.0,

  // Set to false to disable the modality adjustment system entirely.
  ENABLE: true,
});

// ── Discourse floor gate feature-count minimums ───────────────────────────────
//
// These numbers control when the advancedFeatureCount triggers a floor gate.
// Increase a threshold to make that floor harder to reach; decrease to make it
// easier to trigger.  All condition logic in ilrRules.js stays identical.
//
export const GATE = Object.freeze({
  /** advancedFeatureCount required to trigger the ILR 3 floor
   *  (non-factual, heavy inference + abstractReasoning + paragraphDependency). */
  ILR3_FLOOR_FEATURE_MIN: 6,

  /** advancedFeatureCount required for non-factual significantInference → ILR 2+ floor. */
  ILR2PLUS_NONFACTUAL_FEATURE_MIN: 4,

  /** advancedFeatureCount required for moderateInference → ILR 2 floor (non-factual). */
  ILR2_INFERENCE_FEATURE_MIN: 3,
});

// ── Level boundary cap controls ───────────────────────────────────────────────
//
// Toggle ENABLE_* flags to activate or deactivate individual boundary rules.
// Adjust ILR2PLUS_CRITERIA to control which signal combinations are strong
// enough to push a passage from ILR 2 to ILR 2+.
//
export const LEVEL_CAPS = Object.freeze({

  // ── ILR 1 → 1+  boundary ─────────────────────────────────────────────────
  // A passage with ONLY short connected discourse (no paragraph-level signals)
  // cannot exceed ILR 1+.  Set to false to lift this cap.
  ENABLE_1PLUS_SHORTCONNECTED_CAP: true,

  // ── ILR 1+ → 2  boundary ─────────────────────────────────────────────────
  // A passage cannot be labeled ILR 2 unless it meets ALL of:
  //   (a) paragraph-level integration is present
  //   (b) at least one discourse relationship or integration signal exists
  //   (c) at least one inference or full reporting-chain signal is present
  // If paragraph-level integration is present but this gate is not fully met,
  // the ceiling caps the level at ILR 1+.  Set to false to skip this gate.
  ENABLE_2_GATE_CAP: true,

  // ── ILR 2 → 2+  boundary ─────────────────────────────────────────────────
  // A passage that meets ILR 2 but none of ILR2PLUS_CRITERIA stays at ILR 2.
  // Set to false to allow ILR 2+ without qualifying criteria.
  ENABLE_2_CAP: true,

  // ── Listening ILR 2 cap ───────────────────────────────────────────────────
  // Listening samples that are NOT analytically structured AND have only
  // moderate (or no) inference cannot exceed ILR 2.
  ENABLE_LISTENING_2_CAP: true,

  // ── Hard gate system ──────────────────────────────────────────────────────
  // When true, applyHardGates() runs as the final step after all ceiling and
  // floor rules.  Set to false to disable entirely.
  ENABLE_HARD_GATES: true,

  // ── ILR 2+ → 3 single-paragraph / low-demand ceiling ────────────────────
  // When true, reading ceiling R8 caps any passage at ILR 2+ if:
  //   (a) there is no multi-paragraph structure (no multiparagraphArgument and
  //       no paragraphDependency), OR
  //   (b) the passage lacks both heavy inference AND abstract reasoning.
  // This is the "quick cap" that fires before the full 7-condition hard gate.
  ENABLE_3_SINGLE_PARA_CAP: true,

  // ── ILR 3 hard gate (all 10 conditions required) ─────────────────────────
  // When true, ILR 3 can only be assigned when ALL of the following hold:
  //   1. Extended multi-paragraph discourse
  //   2. Sustained abstract conceptual reasoning
  //   3. Heavy multi-layer inference
  //   4. Nuanced/embedded author viewpoint (stanceDetection + nuancedPerspective)
  //   5. Interpretation beyond straightforward comprehension
  //   6. Cross-passage argument development
  //   7. Reader must evaluate implications or underlying assumptions
  //   8. Layered (non-linear) reasoning (layeredReasoning)
  //   9. Implicit meaning construction (implicitMeaning)
  //  10. Not explanatory text and not a simple argument
  // Any single failure demotes the level to ILR 2+.
  ENABLE_3_GATE_CAP: true,

  // ── ILR 3 explanatory / simple-argument ceiling (R9, R10) ─────────────────
  // When true, reading ceilings R9 and R10 cap any passage at ILR 2+ if:
  //   (R9) isExplanatoryText = true: structured explanatory writing, however
  //        abstract or sophisticated, cannot exceed ILR 2+.
  //   (R10) isSimpleArgument = true: clear, explicit argument with transparent
  //         architecture cannot exceed ILR 2+.
  ENABLE_3_EXPLANATORY_CAP: true,

  // ── Functional / additive text cap (ILR 1 ceiling) ───────────────────────
  // When a passage is a simple functional notice, job ad, school message, or
  // public bulletin whose additional clauses are routine additive details
  // (phone numbers, contact instructions, dates, addresses, application steps,
  // office hours, prices) rather than connected discourse, the level cannot
  // exceed ILR 1.  Set to false to disable this protection.
  ENABLE_FUNCTIONAL_TEXT_CAP: true,

  // ── ILR 2+ qualifier criteria ─────────────────────────────────────────────
  // At least ONE of these must be true for a passage to qualify for ILR 2+.
  // Set individual flags to false to remove a criterion.
  ILR2PLUS_CRITERIA: Object.freeze({
    HEAVY_INFERENCE:          true,  // heavyInference alone qualifies
    SIGNIFICANT_INFERENCE:    true,  // significantInference alone qualifies
    STANCE_WITH_ABSTRACTION:  true,  // stanceDetection AND abstractReasoning
    STANCE_WITH_MULTI_PARA:   true,  // stanceDetection AND multiparagraphArgument
    ABSTRACT_WITH_MULTI_PARA: true,  // abstractReasoning AND multiparagraphArgument
    STANCE_WITH_PARA_DEP:     true,  // stanceDetection AND paragraphDependency
  }),
});
