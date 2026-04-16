// ─────────────────────────────────────────────────────────────────────────────
// engine/boundaryEngine.js
//
// Unified ILR Boundary Engine — Reading and Listening
//
// Evaluates the six explicit level-transition boundaries and returns the
// authoritative final ILR level.  This module runs as the LAST step of the
// placement pipeline.  When the gate pipeline and the boundary conditions
// disagree, the boundary level is the final assigned level.
//
// Boundaries (bottom-up; highest crossing wins):
//
//   0  → 0+  isolated words only → memorized phrases / short chunks
//   0+ → 1   phrase recognition  → simple sentence-level meaning
//   1  → 1+  isolated sentences  → connected sentences with basic continuity
//   1+ → 2   connected sentences → paragraph-level discourse + detail integration
//   2  → 2+  single-paragraph   → extended multi-segment + supported reasoning
//   2+ → 3   reporting/inference → abstract / nuanced / implicit / layered
//
// Applies identically to reading and listening.  For listening, the ls* signal
// synthesis in scoringEngine.js maps lsStructure / lsInference / lsDiscourseLength
// into the same boolean signal set before this engine runs.
// ─────────────────────────────────────────────────────────────────────────────

import { hasParagraphLevelIntegration } from "./ilrRules.js";

// ── Boundary condition functions ──────────────────────────────────────────────
// Each returns true when the passage clearly crosses that boundary.
// Functions are ordered lowest → highest; the walker calls them in sequence.

/**
 * 0 → 0+
 * Material consists of memorized formulaic phrases or short chunks.
 * Sentence-level meaning is not yet established.
 */
function meets0Plus(s) {
  return (
    s.minimalCohesion ||
    (s.shortStatements && s.noConnectedSentences)
  );
}

/**
 * 0+ → 1
 * Simple sentence-level meaning with highly predictable content.
 * Sentences are independently intelligible; no cross-sentence integration.
 */
function meets1(s) {
  if (s.noConnectedSentences) return false;
  // Explicit ILR 1 signal set — isolated but sentence-level material
  if (
    s.isolatedFacts          ||
    s.shortStatements        ||
    s.simpleDescriptionPattern ||
    s.singleSentence         ||
    s.noMultiSentenceIntegration
  ) return true;
  // Fallback: has sentences but no multi-sentence connection or paragraph base
  return (
    !s.multipleSentencesConnected &&
    !s.crossSentenceDependency   &&
    !s.paragraphLevelDiscourse
  );
}

/**
 * 1 → 1+
 * Short connected discourse: genuine cross-sentence dependency, explicit logical
 * relationship, or bridging inference — not just temporal sequence or thematic unity.
 *
 * ILR 1+ requires at least one of:
 *   - crossSentenceDependency: pronoun reference / hold-and-connect
 *   - explicitRelationships:   causal, contrastive, or explanatory bond
 *   - moderateInference:       bridging inference across sentences
 *   - multipleSentencesConnected: genuine cross-sentence link (see signal definition —
 *     temporal-only passages and thematic-unity-only passages must have this FALSE)
 *
 * NOTE: chronologicalSequence alone ("then", "after", "at noon") does NOT qualify —
 * simple sequential events are independently intelligible (ILR 1).
 */
function meets1Plus(s) {
  if (s.singleSentence || s.noConnectedSentences) return false;
  const hasGenuineConnection = (
    s.crossSentenceDependency ||
    s.explicitRelationships   ||
    s.moderateInference       ||
    s.multipleSentencesConnected
  );
  if (!hasGenuineConnection) return false;
  // Must not yet reach paragraph-level integration
  return !hasParagraphLevelIntegration(s) && !s.factualReportingChain;
}

/**
 * 1+ → 2
 * Paragraph-level discourse with detail integration and some inference.
 * The reader/listener must combine information across sentences.
 */
function meets2(s) {
  if (!hasParagraphLevelIntegration(s)) return false;
  // Paragraph base must be accompanied by at least one integrative signal
  return (
    s.detailIntegration      ||
    s.multipleDistinctIdeas  ||
    s.moderateInference      ||
    s.explicitRelationships  ||
    s.factualReportingChain
  );
}

/**
 * 2 → 2+
 * Extended discourse requiring supported reasoning across MORE THAN ONE
 * segment or paragraph.  Single-paragraph discourse, however analytical,
 * does not cross this boundary — multi-segment structure is required.
 */
function meets2Plus(s) {
  if (!hasParagraphLevelIntegration(s)) return false;
  // REQUIRED: explicit multi-paragraph or multi-segment structure
  const hasMultiSegment = s.multiparagraphArgument || s.paragraphDependency;
  if (!hasMultiSegment) return false;
  // Must carry evaluative reasoning, significant inference, or abstraction
  return (
    s.stanceDetection      ||
    s.significantInference ||
    s.abstractReasoning    ||
    s.layeredReasoning     ||
    s.implicitMeaning
  );
}

/**
 * 2+ → 3
 * Either abstractReasoning OR layeredReasoning is sufficient.
 * abstraction = abstractReasoning (general sustained abstraction signal)
 */
function meets3(s) {
  return s.abstractReasoning || s.layeredReasoning;
}

/**
 * 3 → 3+
 * ILR 3 confirmed PLUS at least one implicit-interpretation signal.
 */
function meets3Plus(s) {
  if (!meets3(s)) return false;
  return s.implicitMeaning || s.stanceDetection;
}

/**
 * 3+ → 4
 * ILR 3+ confirmed PLUS any of:
 *   - crossParagraphInference, OR
 *   - conceptualDensity, OR
 *   - implicitMeaning AND layeredReasoning
 */
function meets4(s) {
  if (!meets3Plus(s)) return false;
  return (
    s.crossParagraphInference ||
    s.conceptualDensity ||
    (s.implicitMeaning && s.layeredReasoning)
  );
}

/**
 * 4 → 5
 * ILR 4 confirmed PLUS rhetorical nuance AND stylistic sophistication.
 * (ILR 4+ is subsumed into ILR 5 in this boundary model.)
 */
function meets5(s) {
  if (!meets4(s)) return false;
  return s.rhetoricalNuance && s.stylisticSophistication;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * applyBoundaryEngine
 *
 * Walks the six ILR boundaries bottom-up and returns the highest level the
 * passage clearly crosses.  When this differs from the gate-pipeline proposal,
 * the boundary level is authoritative.
 *
 * @param {string} proposedLevel  - Level from the gate pipeline (post hard-gates)
 * @param {object} signals        - Normalized signal set (normalizeSignals output)
 * @param {string} mode           - "reading" | "listening"
 * @returns {{
 *   finalLevel:             string,
 *   boundaryLevel:          string,
 *   boundaryLabel:          string|null,
 *   boundaryApplied:        boolean,
 *   boundaryReason:         string,
 *   proposedLevelFromGates: string,
 * }}
 */
export function applyBoundaryEngine(proposedLevel, signals, mode) {
  const s = signals;

  let level  = "0";
  let label  = null;
  let reason =
    "No sentence-level language detected; material is limited to isolated words " +
    "or below the ILR 0+ threshold.";

  if (meets0Plus(s)) {
    level  = "0+";
    label  = "0 → 0+";
    reason =
      "Material consists of memorized formulaic phrases or short chunks. " +
      "Sentence-level meaning is not yet established.";
  }

  if (meets1(s)) {
    level  = "1";
    label  = "0+ → 1";
    reason =
      "Simple sentence-level meaning is present with highly predictable content. " +
      "Sentences are independently intelligible; no cross-sentence integration is required.";
  }

  if (meets1Plus(s)) {
    level  = "1+";
    label  = "1 → 1+";
    reason =
      "Connected sentences with basic continuity. Limited detail tracking across " +
      "adjacent utterances; no paragraph-level integration is required.";
  }

  if (meets2(s)) {
    level  = "2";
    label  = "1+ → 2";
    reason =
      "Paragraph-level discourse with detail integration. The reader/listener " +
      "must combine information across sentences; at least moderate inference required.";
  }

  if (meets2Plus(s)) {
    level  = "2+";
    label  = "2 → 2+";
    reason =
      "Extended discourse requiring supported reasoning across more than one " +
      "segment or paragraph. Evaluative stance or significant inference demand present.";
  }

  if (meets3(s)) {
    level  = "3";
    label  = "2+ → 3";
    reason =
      "Abstract, nuanced, implicit, argumentative, or layered conceptual discourse. " +
      "Heavy inference required throughout; paragraph-to-paragraph dependency present.";
  }

  if (meets3Plus(s)) {
    level  = "3+";
    label  = "3 → 3+";
    reason =
      "ILR 3 confirmed with sustained cross-paragraph abstract reasoning and " +
      "cross-paragraph inference demand — meaning must be built by connecting " +
      "information across distinct paragraphs.";
  }

  if (meets4(s)) {
    level  = "4";
    label  = "3+ → 4";
    reason =
      "ILR 3+ confirmed with heavy inference demand: cross-paragraph inference, " +
      "implicit meaning layered with layered reasoning, or stance detection " +
      "combined with conceptual density.";
  }

  if (meets5(s)) {
    level  = "5";
    label  = "4 → 5";
    reason =
      "ILR 4 confirmed with rhetorical nuance and stylistic sophistication — " +
      "meaning is carried by how, not merely what. Rhetorical and stylistic " +
      "choices are structurally load-bearing throughout.";
  }

  const boundaryApplied = level !== proposedLevel;

  return {
    finalLevel:             level,
    boundaryLevel:          level,
    boundaryLabel:          label,
    boundaryApplied,
    boundaryReason:         reason,
    proposedLevelFromGates: proposedLevel,
  };
}
