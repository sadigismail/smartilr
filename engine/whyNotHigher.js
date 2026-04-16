// ─────────────────────────────────────────────────────────────────────────────
// engine/whyNotHigher.js
//
// Deterministic "Why Not Higher Level" engine.
//
// For the assigned ILR level, identifies the NEXT level on the scale and lists
// which required features for that transition are absent from the passage.
// Output is teacher-friendly and concise (2–4 bullets maximum).
//
// Logic mirrors the boundary conditions in boundaryEngine.js; any change to
// those conditions should be reflected here.
// ─────────────────────────────────────────────────────────────────────────────

import { hasParagraphLevelIntegration } from "./ilrRules.js";

// Full ILR scale in ascending order (matches boundaryEngine.js).
const SCALE = ["0", "0+", "1", "1+", "2", "2+", "3"];

function nextLevel(level) {
  const i = SCALE.indexOf(level);
  return i === -1 || i === SCALE.length - 1 ? null : SCALE[i + 1];
}

// ── Per-transition missing-feature builders ───────────────────────────────────
// Each function receives the normalized signal set and returns an array of
// teacher-friendly strings describing which features are absent.
// Items are ordered: structural blockers first, then qualitative gaps.
// Maximum 4 items returned per transition.

function whyNot0Plus(s) {
  const items = [];
  if (!s.minimalCohesion && !s.shortStatements)
    items.push("No short phrases or formulaic chunks — material is below the threshold of predictable phrase-level language.");
  return items.slice(0, 4);
}

function whyNot1(s) {
  const items = [];
  if (s.noConnectedSentences)
    items.push("No sentence-level meaning — material is limited to isolated words or memorized phrases.");
  if (!s.isolatedFacts && !s.shortStatements && !s.simpleDescriptionPattern && !s.singleSentence && !s.noMultiSentenceIntegration)
    items.push("Sentence-level content is not yet clearly established.");
  return items.slice(0, 4);
}

function whyNot1Plus(s) {
  const items = [];

  // Structural blocker: none of the four genuine ILR 1+ signals is present.
  // NOTE: chronologicalSequence (temporal listing) is intentionally excluded —
  // "then / after / at noon" sequences do NOT require cross-sentence processing.
  const hasGenuineConnection =
    s.crossSentenceDependency ||
    s.explicitRelationships   ||
    s.moderateInference       ||
    s.detailIntegration       ||
    s.paragraphLevelDiscourse ||
    s.factualReportingChain;

  if (!hasGenuineConnection) {
    items.push(
      "Sentences can each be understood in isolation — there is no cross-sentence " +
      "dependency (pronoun tracking), no causal or contrastive relationship, no bridging " +
      "inference, and no main-idea-with-support structure."
    );
  }

  if (!s.crossSentenceDependency) {
    items.push(
      "No hold-and-connect: the reader is not required to track a referent or idea " +
      "from one sentence to make sense of the next."
    );
  }

  if (!s.explicitRelationships) {
    items.push(
      "No explicit causal, contrastive, or explanatory relationship across sentences " +
      "(e.g. 'because', 'however', 'although', 'as a result'). " +
      "Temporal sequencing words ('then', 'after', 'at noon', 'next') alone are " +
      "event-listing devices — they do not create the cross-sentence dependency " +
      "required for ILR 1+."
    );
  }

  // If we already have a connection but there's paragraph integration → 1+ is already met
  // (this function is only called when finalLevel === "1", so that's fine)
  return items.slice(0, 3);
}

function whyNot2(s) {
  const items = [];
  const hasPara = hasParagraphLevelIntegration(s);

  // Structural blocker: no paragraph-level integration at all
  if (!hasPara) {
    items.push("Discourse is limited to sentence-level — no paragraph-level integration of main idea and supporting detail.");
  }

  if (!s.paragraphLevelDiscourse && !s.factualReportingChain) {
    items.push("No developed paragraph structure: the passage does not sustain a main idea across multiple supporting sentences.");
  }

  if (!s.detailIntegration && !s.multipleDistinctIdeas) {
    items.push("Details are not synthesized across the passage — each sentence contributes independently rather than building a unified meaning.");
  }

  if (!s.moderateInference && !s.significantInference && !s.heavyInference) {
    items.push("No inference is required: meaning is fully conveyed by explicitly stated content at the sentence level.");
  }

  return items.slice(0, 4);
}

function whyNot2Plus(s) {
  const items = [];

  // Primary structural blocker: no multi-paragraph or multi-segment structure
  const hasMultiSegment = s.multiparagraphArgument || s.paragraphDependency;
  if (!hasMultiSegment) {
    if (!s.multiparagraphArgument)
      items.push("Reasoning does not extend across multiple discourse units — a single paragraph or segment is insufficient for ILR 2+.");
    if (!s.paragraphDependency)
      items.push("No inter-paragraph dependency: understanding each section does not require integrating the others.");
  }

  // Evaluative reasoning gaps
  if (!s.stanceDetection) {
    items.push("No identifiable authorial stance or evaluative position beyond reporting.");
  }

  if (!s.significantInference && !s.heavyInference) {
    items.push("Inference demand is moderate rather than significant — implied meaning does not require sustained interpretive effort.");
  }

  if (!s.abstractReasoning && !s.layeredReasoning) {
    items.push("Discourse remains concrete and informative rather than abstract or analytically layered.");
  }

  return items.slice(0, 4);
}

function whyNot3(s) {
  const items = [];

  // Hard exclusions (ceiling flags)
  if (s.isExplanatoryText) {
    items.push("Primary function is explanation — explanatory discourse is capped at ILR 2+ regardless of complexity.");
  }
  if (s.isSimpleArgument) {
    items.push("Main claim, evidence, and conclusion are all explicitly stated — transparent argumentative structure is capped at ILR 2+.");
  }

  // If hard exclusion already fills 2 items, stop here — these are definitive
  if (items.length >= 2) return items;

  // Multi-segment prerequisite
  if (!s.multiparagraphArgument && !s.paragraphDependency) {
    items.push("No multi-paragraph structure with cross-paragraph dependency — required for ILR 3.");
  }

  // Heavy inference requirement
  if (!s.heavyInference) {
    items.push("Inference demand is not heavy throughout — ILR 3 requires sustained heavy inference across the full passage.");
  }

  // Abstraction / layering signals
  if (!s.implicitMeaning) {
    items.push("Substantial meaning is not implicit — the passage conveys its main ideas through explicitly stated content.");
  }

  if (!s.layeredReasoning) {
    items.push("Reasoning is sequential rather than layered — ILR 3 requires non-linear sub-arguments that must be integrated simultaneously.");
  }

  if (!s.nuancedPerspective) {
    items.push("Authorial perspective is identifiable from explicit evaluative language rather than being embedded in rhetorical choices.");
  }

  if (!s.abstractReasoning) {
    items.push("No abstract argument — discourse remains primarily informative or analytical at the concrete level.");
  }

  return items.slice(0, 4);
}

// ── Dispatch table ─────────────────────────────────────────────────────────────

const BUILDERS = {
  "0+":  whyNot0Plus,
  "1":   whyNot1,
  "1+":  whyNot1Plus,
  "2":   whyNot2,
  "2+":  whyNot2Plus,
  "3":   whyNot3,
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * computeWhyNotHigher
 *
 * @param {string} finalLevel    - Assigned ILR level (e.g. "1+")
 * @param {object} signals       - Normalized signal set (from normalizeSignals)
 * @returns {{
 *   nextLevel:  string|null,    - e.g. "2" (null if already at ILR 5)
 *   title:      string,         - e.g. "Why Not ILR 2"
 *   items:      string[],       - teacher-friendly bullet list (2–4 items)
 * }|null}
 */
// ── Fixed upper-band "why not higher" text ───────────────────────────────────
// Authoritative one-sentence explanations for ILR 3 → 3+, 3+ → 4, and 4 → 5.
// These replace signal-based inference for the upper band.
const UPPER_BAND_WHY_NOT = {
  "3": {
    nextLevel: "3+",
    title:     "Why Not ILR 3+",
    items: [
      "This passage does not reach ILR Level 3+ because it does not require sustained abstraction and cross-paragraph inference throughout the text.",
    ],
  },
  "3+": {
    nextLevel: "4",
    title:     "Why Not ILR 4",
    items: [
      "This passage does not reach ILR Level 4 because, although highly abstract, it does not require deeper interpretive instability, recursive conceptual framing, or dense cross-paragraph inference characteristic of Level 4.",
    ],
  },
  "4": {
    nextLevel: "5",
    title:     "Why Not ILR 5",
    items: [
      "This passage does not reach ILR Level 5 because rhetorical nuance and stylistic sophistication are not the primary carriers of meaning.",
    ],
  },
};

export function computeWhyNotHigher(finalLevel, signals) {
  // Upper band (ILR 3 and above) uses fixed authoritative text.
  const upperBand = UPPER_BAND_WHY_NOT[String(finalLevel)];
  if (upperBand) return upperBand;

  // ILR 5 — nothing higher.
  if (String(finalLevel) === "5") return null;

  // Lower band (ILR 0 through 2+) — signal-based deterministic bullets.
  const target = nextLevel(finalLevel);
  if (!target) return null;

  const builder = BUILDERS[target];
  if (!builder) return null;

  const items = builder(signals);

  const displayItems = items.length
    ? items
    : [`The passage approaches ILR ${target} but narrowly falls short across several dimensions.`];

  return {
    nextLevel: target,
    title:     `Why Not ILR ${target}`,
    items:     displayItems,
  };
}
