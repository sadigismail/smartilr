// ─────────────────────────────────────────────────────────────────────────────
// engine/transcriptQualityEngine.js
//
// Assesses the quality of a spoken-language transcript for ILR listening
// analysis.  Used only when a transcript is the direct input (text path).
//
// Outputs a quality flag that drives confidence capping downstream:
//
//   "adequate"  — 100+ words, minimal inaudibility markers, usable signal
//   "limited"   — 50–99 words OR noticeable inaudibility markers (≤15%)
//   "poor"      — < 50 words OR heavy inaudibility markers (>15%)
//
// IMPORTANT: Transcript quality NEVER affects the assigned ILR level.
// It affects only the confidence label and triggers a standardized note.
// ─────────────────────────────────────────────────────────────────────────────

// Patterns that indicate inaudible, unclear, or incomplete segments.
const INAUDIBILITY_PATTERNS = [
  /\[inaudible\]/gi,
  /\[unclear\]/gi,
  /\[unintelligible\]/gi,
  /\[crosstalk\]/gi,
  /\.\.\./g,
  /\[…\]/g,
  /\[\?\?\?\]/g,
  /\?\?\?/g,
  /\[indistinct\]/gi,
  /\[noise\]/gi,
  /\[music\]/gi,
  /\[silence\]/gi,
];

// Words that mark transcript incompleteness when they appear as filler
const INCOMPLETENESS_MARKERS = [
  /\[inaudible\]/gi,
  /\[unclear\]/gi,
  /\[unintelligible\]/gi,
  /\[indistinct\]/gi,
];

/**
 * Count words in a string (splits on whitespace; ignores empty tokens).
 */
function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Count total occurrences of all patterns in a string.
 */
function countMatches(text, patterns) {
  return patterns.reduce((sum, re) => {
    const matches = text.match(re);
    return sum + (matches ? matches.length : 0);
  }, 0);
}

/**
 * Assess the quality of a transcript for ILR listening scoring purposes.
 *
 * @param {string} transcript  — raw transcript text (already trimmed)
 * @returns {{
 *   flag:        "adequate" | "limited" | "poor",
 *   wordCount:   number,
 *   issues:      string[],
 *   noteNeeded:  boolean,
 * }}
 */
export function assessTranscriptQuality(transcript) {
  const issues = [];
  const wordCount = countWords(transcript);

  // ── Inaudibility marker check ─────────────────────────────────────────────
  const inaudibleCount = countMatches(transcript, INAUDIBILITY_PATTERNS);
  const incompleteCount = countMatches(transcript, INCOMPLETENESS_MARKERS);

  // Proportion of "content-blocking" markers relative to word count.
  // Treat each marker as replacing ~3 words of missing content.
  const effectiveTotal = wordCount + incompleteCount * 3;
  const markerRatio = effectiveTotal > 0 ? (incompleteCount * 3) / effectiveTotal : 0;

  // ── Length classification ─────────────────────────────────────────────────
  // "adequate" at 80+ words: enough to capture paragraph-level discourse.
  // "poor"     at < 40 words: too little signal for reliable placement.
  // "limited"  at 40–79 words: reduced signal; note shown but level held.
  const tooShort      = wordCount < 40;
  const borderlineLen = wordCount >= 40 && wordCount < 80;

  // ── Issue messages ────────────────────────────────────────────────────────
  if (tooShort) {
    issues.push(`Short transcript (${wordCount} words) — limited linguistic signal available.`);
  } else if (borderlineLen) {
    issues.push(`Borderline transcript length (${wordCount} words) — some linguistic features may not be fully represented.`);
  }

  if (incompleteCount > 0) {
    issues.push(`${incompleteCount} inaudibility marker${incompleteCount > 1 ? "s" : ""} detected — spoken content partially unavailable.`);
  }

  if (inaudibleCount > 0 && incompleteCount === 0) {
    // Only ellipses / ??? markers (less severe)
    issues.push(`Apparent transcript gaps detected — some spoken content may be missing.`);
  }

  // ── Quality flag ─────────────────────────────────────────────────────────
  let flag;

  if (tooShort || markerRatio > 0.15) {
    flag = "poor";
  } else if (borderlineLen || markerRatio > 0.05 || inaudibleCount >= 3) {
    flag = "limited";
  } else {
    flag = "adequate";
  }

  const noteNeeded = flag === "poor" || flag === "limited";

  return { flag, wordCount, issues, noteNeeded };
}

/**
 * The standardized teacher-facing note shown when transcript quality limits
 * the precision of the assessment.  The ILR level is never lowered for quality
 * reasons — this note is purely informational.
 */
export const TRANSCRIPT_QUALITY_NOTE =
  "Transcript quality may limit precision, but the assigned level is based on available linguistic evidence.";
