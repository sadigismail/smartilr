// ─────────────────────────────────────────────────────────────────────────────
// engine/consistencyEngine.js
//
// Step 4 — Consistency Check
//
// After the boundary engine assigns a level (Step 3), this module validates
// whether the dominant signal profile is internally consistent with that
// assignment.  It catches edge cases where the boundary walker produced a
// level that sits at odds with the overall signal cluster.
//
// CONTRACT:
//   - Does NOT change the final ILR level.
//   - Returns { consistent, warnings, confidencePenalty, note }.
//   - confidencePenalty is a [0, 0.20] deduction applied to the numeric
//     confidence score before the confidence label is assigned.
//   - warnings is an array of short plain-text strings suitable for the
//     audit trail.
//
// Applies identically to reading and listening.  For listening, the ls*
// signal synthesis in scoringEngine.js maps delivery classifiers into the
// same boolean signal set before this check runs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * checkConsistency
 *
 * @param {string} level   - ILR level string assigned by the boundary engine
 * @param {object} signals - Normalized signal set (output of normalizeSignals)
 * @returns {{
 *   consistent:        boolean,
 *   warnings:          string[],
 *   confidencePenalty: number,
 *   note:              string,
 * }}
 */
export function checkConsistency(level, signals) {
  const s        = signals;
  const warnings = [];
  let   penalty  = 0;

  switch (level) {

    case "0":
      // Expected: no sentence-level language at all
      if (
        s.multipleSentencesConnected ||
        s.crossSentenceDependency    ||
        s.paragraphLevelDiscourse
      ) {
        warnings.push(
          "ILR 0 assigned but sentence-connection signals are present — " +
          "the passage may contain more structure than isolated words."
        );
        penalty += 0.05;
      }
      break;

    case "0+":
      // Expected: formulaic phrases or minimal chunks; no full sentences
      if (!s.minimalCohesion && !s.shortStatements) {
        warnings.push(
          "ILR 0+ assigned but neither minimal cohesion nor short-statement " +
          "signals are detected — level assignment may be marginal."
        );
        penalty += 0.05;
      }
      break;

    case "1":
      // Expected: sentence-level meaning; no cross-sentence integration
      if (
        s.multipleSentencesConnected ||
        s.crossSentenceDependency
      ) {
        warnings.push(
          "ILR 1 assigned but cross-sentence connection signals are present — " +
          "passage may be closer to ILR 1+."
        );
        penalty += 0.05;
      }
      break;

    case "1+": {
      // Expected: connected sentences; no paragraph-level integration yet
      const hasConnection =
        s.multipleSentencesConnected ||
        s.crossSentenceDependency    ||
        s.explicitRelationships      ||
        s.chronologicalSequence      ||
        s.simpleAdditiveText;

      if (!hasConnection) {
        warnings.push(
          "ILR 1+ assigned but no cross-sentence connection signals are detected — " +
          "required sentence-continuity features may be absent."
        );
        penalty += 0.08;
      }
      if (s.paragraphLevelDiscourse || s.detailIntegration) {
        warnings.push(
          "ILR 1+ assigned but paragraph-level integration signals are present — " +
          "passage may be closer to ILR 2."
        );
        penalty += 0.05;
      }
      break;
    }

    case "2": {
      // Expected: paragraph integration; no multi-paragraph structure
      const hasPara =
        s.paragraphLevelDiscourse ||
        s.detailIntegration       ||
        s.multipleDistinctIdeas   ||
        s.factualReportingChain   ||
        s.crossSentenceDependency;

      if (!hasPara) {
        warnings.push(
          "ILR 2 assigned but paragraph-level integration signals are weak or absent — " +
          "content-level evidence for this rating is limited."
        );
        penalty += 0.08;
      }
      if (s.multiparagraphArgument || s.paragraphDependency) {
        warnings.push(
          "ILR 2 assigned but multi-paragraph structural signals are present — " +
          "passage may be closer to ILR 2+."
        );
        penalty += 0.05;
      }
      break;
    }

    case "2+":
      // Expected: multi-paragraph structure + evaluative/abstract signal
      if (!s.multiparagraphArgument && !s.paragraphDependency) {
        warnings.push(
          "ILR 2+ assigned but multi-paragraph or cross-paragraph structural " +
          "signals are not clearly detected — extended discourse requirement may not be met."
        );
        penalty += 0.10;
      }
      if (
        !s.stanceDetection      &&
        !s.significantInference &&
        !s.abstractReasoning    &&
        !s.layeredReasoning     &&
        !s.implicitMeaning
      ) {
        warnings.push(
          "ILR 2+ assigned but evaluative stance and abstract reasoning signals " +
          "are absent — the upper-level requirement for supported reasoning is unconfirmed."
        );
        penalty += 0.07;
      }
      break;

    case "3":
      // Expected: abstractReasoning OR layeredReasoning (either is sufficient for ILR 3).
      if (!s.abstractReasoning && !s.layeredReasoning) {
        warnings.push(
          "ILR 3 assigned but neither abstractReasoning nor layeredReasoning is detected — " +
          "the primary ILR 3 requirement (abstraction and/or layered reasoning) is unconfirmed."
        );
        penalty += 0.12;
      }
      if (s.isExplanatoryText || s.isSimpleArgument) {
        warnings.push(
          "ILR 3 assigned but an explanatory-text or simple-argument exclusion " +
          "signal is present — the passage may not meet ILR 3 qualitative criteria."
        );
        penalty += 0.10;
      }
      break;

    default:
      break;
  }

  const consistent = warnings.length === 0;

  const note = consistent
    ? "Signal profile is consistent with the assigned ILR level."
    : `Consistency check flagged ${warnings.length} concern(s): ` +
      warnings.map((w, i) => `(${i + 1}) ${w}`).join("  ");

  return {
    consistent,
    warnings,
    confidencePenalty: Math.min(penalty, 0.20), // hard cap: max –0.20 from this source
    note,
  };
}
