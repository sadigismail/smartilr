// ─────────────────────────────────────────────────────────────────────────────
// engine/confidenceEngine.js
//
// Translates the numeric confidence score (0–1) into a categorical label
// (High / Medium / Low), computes a "Likely Range" of plausible ILR levels,
// and builds a short human-readable list of factors that influenced the rating.
//
// Inputs come entirely from data already computed by the pipeline — no new
// model calls are made here.
// ─────────────────────────────────────────────────────────────────────────────

// Full ILR scale in ascending order (level "0" included for completeness).
const FULL_SCALE = ["0", "0+", "1", "1+", "2", "2+", "3"];

function idx(level) {
  const i = FULL_SCALE.indexOf(String(level));
  return i === -1 ? null : i;
}

// ── Categorical label ──────────────────────────────────────────────────────

function confidenceLabel(score, hasBorderline) {
  // A borderline flag at the edge of the scale (level 3 with "upper", or level
  // "0" with "lower") has nowhere to go — don't demote to Medium in that case.
  if (score >= 0.85 && !hasBorderline) return "High";
  if (score >= 0.70)                    return "Medium";
  return "Low";
}

// ── Likely range ──────────────────────────────────────────────────────────
//
// Returns a two-element array [lo, hi] of ILR levels (strings).
// lo === hi means the range collapses to a single level (shown as just that
// level in the UI).  Range is always clipped to valid scale boundaries.

function computeRange({
  finalLevel,
  finalConfidence,
  borderlineType,   // "upper" | "lower" | null
  hardGateDemotionSteps,
  ceilingApplied,
  boundaryApplied,
  mode,
  deliveryScore,    // 0-14; high = harder delivery → wider range in listening
  passageWordCount, // number | null
}) {
  const i = idx(finalLevel);
  if (i === null) return [finalLevel, finalLevel];

  const max = FULL_SCALE.length - 1;
  let lo = i, hi = i;

  // Borderline: extend toward the adjacent level detected as borderline.
  if (borderlineType === "upper" && hi < max) hi += 1;
  if (borderlineType === "lower" && lo > 0)   lo -= 1;

  // Every override (gate/ceiling/boundary) widens the range by one half-step.
  const overrideCount =
    (hardGateDemotionSteps > 0 ? 1 : 0) +
    (ceilingApplied ? 1 : 0) +
    (boundaryApplied ? 1 : 0);

  if (overrideCount >= 2) {
    // Multiple overrides: widen by one step in each direction.
    if (lo > 0)   lo -= 1;
    if (hi < max) hi += 1;
  } else if (overrideCount === 1) {
    // Single override: widen toward the override direction.
    if (ceilingApplied && lo > 0)       lo -= 1;
    if (hardGateDemotionSteps > 0 && lo > 0) lo -= 1;
    if (boundaryApplied) {
      if (lo > 0)   lo -= 1;
    }
  }

  // Low confidence: widen by one half-step in each direction, but only if
  // the range hasn't already been widened by multiple override stacking.
  // Prevents double-widening that produces unreasonably broad ranges.
  if (finalConfidence < 0.70 && overrideCount < 2) {
    if (lo > 0)   lo -= 1;
    if (hi < max) hi += 1;
  }

  // Difficult listening delivery widens range by a half-step up (delivery adds
  // perceptual challenge that can make the linguistic level harder to pin down).
  if (mode === "listening" && typeof deliveryScore === "number" && deliveryScore >= 7) {
    if (hi < max) hi += 1;
  }

  // Short passages (<80 words) cannot demonstrate ILR 3 discourse features;
  // remove ILR 3 from the likely range even if confidence widening reached it.
  if (typeof passageWordCount === "number" && passageWordCount < 80) {
    const cap2Plus = FULL_SCALE.indexOf("2+");
    if (hi > cap2Plus) hi = cap2Plus;
  }

  return [FULL_SCALE[lo], FULL_SCALE[hi]];
}

function formatRange([lo, hi]) {
  return lo === hi ? lo : `${lo} to ${hi}`;
}

// ── Signal clustering ──────────────────────────────────────────────────────
//
// "How well do the ILR signals agree on the assigned level?"
// Returns "strong" | "mixed" | "weak".

function signalCluster({
  levelDiff,
  borderlineType,
  hardGateDemotionSteps,
  ceilingApplied,
  boundaryApplied,
}) {
  const overrideCount =
    (hardGateDemotionSteps > 0 ? 1 : 0) +
    (ceilingApplied ? 1 : 0) +
    (boundaryApplied ? 1 : 0);

  if (levelDiff >= 2 || overrideCount >= 2) return "weak";
  if (levelDiff >= 1 || overrideCount >= 1 || borderlineType) return "mixed";
  return "strong";
}

// ── Human-readable factor list ─────────────────────────────────────────────
//
// Short phrase array describing what supported or limited confidence.
// Shown in a tooltip / expand section in the UI.

function buildReasons({
  label,
  borderlineType,
  levelDiff,
  ceilingApplied,
  hardGateDemotionSteps,
  boundaryApplied,
  mode,
  deliveryScore,
  cluster,
  consistencyWarnings = [],
}) {
  const pos = [];
  const neg = [];

  if (cluster === "strong" && levelDiff === 0 && !borderlineType) {
    pos.push("Model and gate logic agreed on the same level.");
  }
  if (levelDiff === 0 && !ceilingApplied && !hardGateDemotionSteps && !boundaryApplied) {
    pos.push("No gate overrides were applied.");
  }
  if (levelDiff === 0) {
    pos.push("AI-assigned level matched the final assigned level.");
  }

  if (borderlineType === "upper") {
    neg.push("Numeric score is close to the boundary of the next level up.");
  }
  if (borderlineType === "lower") {
    neg.push("Numeric score is close to the boundary of the level below.");
  }
  if (ceilingApplied) {
    neg.push("A discourse ceiling rule prevented a higher level assignment.");
  }
  if (hardGateDemotionSteps > 0) {
    neg.push(
      hardGateDemotionSteps === 1
        ? "A structural gate rule demoted the level by one step."
        : `Structural gate rules demoted the level by ${hardGateDemotionSteps} steps.`
    );
  }
  if (boundaryApplied) {
    neg.push("The boundary engine adjusted the level from the gate pipeline result.");
  }
  if (levelDiff >= 2) {
    neg.push("The AI model's initial estimate differed significantly from the final level.");
  } else if (levelDiff === 1) {
    neg.push("The AI model's initial estimate differed by one level from the final.");
  }

  if (mode === "listening") {
    if (typeof deliveryScore === "number" && deliveryScore >= 7) {
      neg.push("Difficult delivery conditions may affect transcription precision.");
    } else if (typeof deliveryScore === "number" && deliveryScore <= 2) {
      pos.push("Clean delivery conditions support clear linguistic assessment.");
    }
  }

  // Surface consistency check warnings (Step 4 output).
  // Each warning is a concise plain-text phrase; at most 2 are shown here
  // to leave room for other reasons.
  if (consistencyWarnings.length > 0) {
    for (const w of consistencyWarnings.slice(0, 2)) {
      neg.push(w);
    }
  }

  // Deduplicate and order: positives first when High, negatives first when Low.
  const all = label === "High" ? [...pos, ...neg] : [...neg, ...pos];
  return [...new Set(all)].slice(0, 5); // cap at 5 reasons
}

// ── Transcript-quality confidence cap ─────────────────────────────────────
//
// Applied AFTER computeConfidenceIndicator when the listening input is a
// text transcript (transcriptUsedForScoring: true) and the assessTranscript-
// Quality check detected quality issues.
//
// "poor"    → cap label at "Low";    add quality note to confidenceReasons.
// "limited" → cap label at "Medium"; add quality note to confidenceReasons.
// "adequate"→ no change.
//
// CRITICAL: This function NEVER changes the ILR level — only the confidence
// label and the reasons list.

export function capConfidenceForTranscriptQuality(confidenceResult, qualityFlag, qualityIssues = []) {
  if (!qualityFlag || qualityFlag === "adequate") return confidenceResult;

  const caps = {
    limited: "Medium",
    poor:    "Low",
  };
  const capLabel = caps[qualityFlag];
  if (!capLabel) return confidenceResult;

  const currentOrder = ["Low", "Medium", "High"];
  const currentIdx   = currentOrder.indexOf(confidenceResult.confidenceLabel);
  const capIdx       = currentOrder.indexOf(capLabel);

  // Only lower the label, never raise it.
  const newLabel = currentIdx > capIdx ? capLabel : confidenceResult.confidenceLabel;

  // Prepend quality issue messages to confidenceReasons (capped at 5 total).
  const qualityPhrases = qualityIssues.slice(0, 2).map(issue =>
    issue.endsWith(".") ? issue : issue + "."
  );
  const allReasons = [...qualityPhrases, ...confidenceResult.confidenceReasons];
  const dedupedReasons = [...new Set(allReasons)].slice(0, 5);

  return {
    ...confidenceResult,
    confidenceLabel:   newLabel,
    confidenceReasons: dedupedReasons,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export function computeConfidenceIndicator({
  finalLevel,
  rawModelLevel,
  finalConfidence,
  borderlineType = null,
  ceilingApplied = false,
  hardGateDemotionSteps = 0,
  boundaryApplied = false,
  mode = "reading",
  deliveryAnalysis = null,
  consistencyWarnings = [],
  passageWordCount = null,
}) {
  const levelDiff = Math.abs((idx(finalLevel) ?? 0) - (idx(rawModelLevel) ?? 0));

  // Strip borderline flags that point off the edge of the scale.
  // "upper" at ILR 3 has nowhere to go; "lower" at ILR 0 has nowhere to go.
  const levelIdx = idx(finalLevel) ?? 0;
  const max      = FULL_SCALE.length - 1;
  const effectiveBorderlineType =
    (borderlineType === "upper" && levelIdx >= max) ? null :
    (borderlineType === "lower" && levelIdx <= 0)   ? null :
    borderlineType;

  const hasBorderline = !!effectiveBorderlineType;
  const deliveryScore = deliveryAnalysis?.deliveryScore ?? null;

  const label   = confidenceLabel(finalConfidence, hasBorderline);
  const cluster = signalCluster({
    levelDiff, borderlineType: effectiveBorderlineType,
    hardGateDemotionSteps, ceilingApplied, boundaryApplied,
  });
  const range   = computeRange({
    finalLevel, finalConfidence, borderlineType: effectiveBorderlineType,
    hardGateDemotionSteps, ceilingApplied, boundaryApplied,
    mode, deliveryScore, passageWordCount,
  });
  const reasons = buildReasons({
    label, borderlineType, levelDiff, ceilingApplied,
    hardGateDemotionSteps, boundaryApplied, mode, deliveryScore, cluster,
    consistencyWarnings,
  });

  return {
    confidenceLabel:   label,         // "High" | "Medium" | "Low"
    likelyRange:       formatRange(range),  // e.g. "1+ to 2" or "2"
    likelyRangeRaw:    range,         // ["1+", "2"]
    signalCluster:     cluster,       // "strong" | "mixed" | "weak"
    confidenceReasons: reasons,       // string[]
  };
}
