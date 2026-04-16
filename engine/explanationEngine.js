// ─────────────────────────────────────────────────────────────────────────────
// engine/explanationEngine.js
//
// Generates and injects teacher-facing rationale text into ILR reports.
// All user-visible narrative strings (mandatory phrases, scope of rating,
// gate rationale) are produced here.  Edit this file to change report wording
// without touching gate logic.
// ─────────────────────────────────────────────────────────────────────────────

import { LEVELS } from "../config/scoringConfig.js";
import { MANDATORY_PHRASES, SCOPE_OF_RATING } from "../config/explanationConfig.js";
import { levelIndex } from "./ilrRules.js";

// ── Report sections (ILR 3 and above) ────────────────────────────────────────
//
// Single source of truth for the three upper-band text fields:
//   summary      → report.levelJustificationSummary
//   whyTitle     → report.whyNotHigherTitle
//   whyBody      → report.whyNotHigherLevel
//
// Keys are strings so String(finalLevel) works for both numeric and "3+".
// Falls back to the ILR 3 entry when called with a sub-3 level.

const REPORT_SECTIONS_MAP = {
  "3": {
    summary:
      "This passage is rated at ILR Level 3 because it requires abstract reasoning, layered argumentation, and integration of ideas across paragraphs. Meaning is partially implicit but recoverable through analytical reading.",
    whyTitle: "Why Not ILR 3+",
    whyBody:
      "This passage does not reach ILR Level 3+ because it does not require sustained abstraction and cross-paragraph inference throughout the text.",
  },
  "3+": {
    summary:
      "This passage is rated at ILR Level 3+ because it demonstrates sustained abstraction combined with implicit meaning and layered reasoning. Interpretation requires resolving relationships not fully stated and integrating concepts across paragraphs.",
    whyTitle: "Why Not ILR 4",
    whyBody:
      "This passage does not reach ILR Level 4 because, although highly abstract, it does not require recursive conceptual framing, interpretive instability, or dense cross-paragraph inference characteristic of Level 4.",
  },
  "4": {
    summary:
      "This passage is rated at ILR Level 4 because meaning emerges through implicit assumptions, conceptual density, and cross-paragraph reasoning where interpretation is required to construct meaning.",
    whyTitle: "Why Not ILR 5",
    whyBody:
      "This passage does not reach ILR Level 5 because rhetorical nuance and stylistic sophistication are not the primary carriers of meaning.",
  },
  "5": {
    summary:
      "This passage is rated at ILR Level 5 because meaning is conveyed through rhetorical nuance, stylistic sophistication, and multiple simultaneous interpretive layers.",
    whyTitle: "",
    whyBody:  "",
  },
};

export function buildReportSections(finalLevel) {
  return REPORT_SECTIONS_MAP[String(finalLevel)] || REPORT_SECTIONS_MAP["3"];
}

export function finalizeReport(report) {
  const level = String(report.finalLevel);

  // ---- SECTION 6 ----
  const levelText = {
    "3":
      "The passage is rated at ILR Level 3 because it requires abstract reasoning and layered interpretation across paragraphs.",
    "3+":
      "This passage is rated at ILR Level 3+ because it demonstrates sustained abstraction, implicit meaning, and layered reasoning across paragraphs. Interpretation requires integrating concepts and resolving relationships not fully stated in the text.",
    "4":
      "The passage is rated at ILR Level 4 because meaning emerges through conceptual density, implicit assumptions, and cross-paragraph reasoning.",
    "5":
      "The passage is rated at ILR Level 5 because meaning is conveyed through rhetorical nuance and stylistic sophistication.",
  };

  // Upper-band levels: authoritative fixed text.
  // Sub-3 levels: use whatever was already set (model or normalization output).
  // Do NOT fall back to Level 3 text for sub-3 levels — it is wrong and stale.
  report.levelJustificationSummary =
    levelText[level] || report.levelJustificationSummary || "";

  // ---- SECTION 8 ----
  const why = {
    "3":
      "This passage does not reach ILR Level 3+ because it does not require sustained abstraction and cross-paragraph inference.",
    "3+":
      "This passage does not reach ILR Level 4 because, although highly abstract, it does not require recursive conceptual framing, interpretive instability, or dense cross-paragraph inference.",
    "4":
      "This passage does not reach ILR Level 5 because rhetorical nuance is not the primary carrier of meaning.",
    "5":
      "",
  };

  // Upper-band levels (3, 3+, 4, 5) use authoritative fixed text.
  // Lower-band levels (0 through 2+) use the deterministic whyNotHigher object
  // computed by computeWhyNotHigher — clear stale AI text so it cannot bleed through.
  if (why[level] !== undefined) {
    report.whyNotHigherLevel = why[level];
  } else {
    report.whyNotHigherLevel = "";
  }

  // remove stale Section 6 fields
  report.whyThisLevel   = null;
  report.summary        = undefined;
  report.levelSummary   = undefined;
  report.autoSummary    = undefined;
  report.defaultSummary = undefined;

  // remove stale Section 8 duplicates, but preserve a properly computed
  // whyNotHigher object ({nextLevel, title, items[]}) if it is already set.
  if (!(report.whyNotHigher && typeof report.whyNotHigher === "object" && report.whyNotHigher.nextLevel)) {
    report.whyNotHigher = null;
  }
  report.autoWhy               = null;
  report.defaultWhy            = null;
  report.whyNotHigherDuplicate = null;

  return report;
}

export function applyReportText(report) {
  const level    = String(report.finalLevel);
  const selected = REPORT_SECTIONS_MAP[level] || REPORT_SECTIONS_MAP["3"];
  report.levelJustificationSummary = selected.summary;
  report.whyNotHigherTitle         = selected.whyTitle;
  report.whyNotHigherLevel         = selected.whyBody;
  return report;
}

// Thin wrapper kept for compatibility with buildSafeIlrReportPayload.
export function buildLevelSummary(finalLevel) {
  return buildReportSections(finalLevel).summary;
}

// Kept for compatibility — delegates to buildReportSections.
export function buildLevelSections(finalLevel) {
  const s = buildReportSections(finalLevel);
  return { levelSummary: s.summary, whyNotHigher: s.whyBody };
}

// ── Level justification (ILR 3 and above) ────────────────────────────────────
//
// Returns the authoritative justification paragraph for upper-band ILR levels.
// Accepts level as either a string ("3", "3+", "4", "5") or a number (3, 4, 5).
// Called in scoringEngine.js to override the model-generated justification for
// levels 3 and above.

export function buildJustification(level, signals) {
  const lvl = level === "3+" ? "3+" : Number(level);

  if (lvl === 3) {
    return "The passage demonstrates sustained abstract reasoning and layered argumentation. Meaning is primarily explicit but requires conceptual tracking across the text. These features align with ILR Level 3 discourse.";
  }

  if (lvl === "3+") {
    return "The passage demonstrates sustained abstraction combined with implicit meaning and layered reasoning. Interpretation requires resolving relationships not fully stated in the text. These characteristics align with ILR Level 3+ discourse.";
  }

  if (lvl === 4) {
    return "The passage requires interpretive reading across conceptual layers. Meaning emerges from implicit assumptions, cross-paragraph reasoning, and conceptual density. The argument depends on inference rather than explicit structure. These features align with ILR Level 4 discourse.";
  }

  if (lvl === 5) {
    return "The passage relies on rhetorical nuance and stylistic sophistication. Meaning is conveyed through tone, framing, and discourse strategy rather than explicit argument alone. Interpretation requires evaluating how language constructs meaning. These features align with ILR Level 5 discourse.";
  }

  return "The passage reflects structured discourse below ILR 3.";
}

// ── Level-reference sanitization ─────────────────────────────────────────────
//
// When the engine corrects the level (e.g. model said "1+" but the final cap
// set it to "1"), the model's justification text still contains the old label.
// This function replaces wrong level references in specific descriptor/
// assignment contexts so the justification always matches the engine's
// definitive finalLevel.
//
// Processed in longest-first order (4+ before 4, 1+ before 1) so a "1+"
// pattern is not partially matched by the shorter "1" pattern.
//
// Only "claiming" contexts are replaced — phrases like "does not reach ILR 1+"
// or "exceeds ILR 1" are left untouched.
//
const ILR_LABEL_ORDER = [
  "5", "4+", "4", "3+", "3", "2+", "2", "1+", "1", "0+",
];

function sanitizeLevelClaims(text, correctLevel) {
  if (!text || !correctLevel) return text;
  for (const lvl of ILR_LABEL_ORDER) {
    if (lvl === correctLevel) continue;
    const esc = lvl.replace("+", "\\+");
    const replace = [
      // Specific descriptor/assignment contexts — safe to replace unconditionally
      [`ILR ${esc} descriptor`,       `ILR ${correctLevel} descriptor`],
      [`ILR Level ${esc}`,            `ILR Level ${correctLevel}`],
      [`ILR ${esc} level`,            `ILR ${correctLevel} level`],
      [`ILR ${esc} rating`,           `ILR ${correctLevel} rating`],
      [`assigned ILR ${esc}`,         `assigned ILR ${correctLevel}`],
      [`is ILR ${esc}`,               `is ILR ${correctLevel}`],
      [`consistent with ILR ${esc}`,  `consistent with ILR ${correctLevel}`],
      // "at the ILR X" / "at ILR X" only when directly claiming the level
      [`at the ILR ${esc}`,           `at the ILR ${correctLevel}`],
    ];
    for (const [pattern, repl] of replace) {
      text = text.replace(new RegExp(pattern, "g"), repl);
    }
  }

  // Strip sentences that contradict the assigned level.
  // "passage does not reach ILR 2+" when finalLevel IS "2+" is self-contradictory.
  // Matches full sentences (ending with . ! or ?) containing
  // "does not reach" followed by the correct level (with or without "ILR Level").
  const escapedFinal = correctLevel.replace("+", "\\+");
  text = text
    .replace(
      new RegExp(
        `[^.!?]*\\bdoes not reach\\b[^.!?]*(?:ILR\\s*(?:Level\\s*)?)?${escapedFinal}[^.!?]*[.!?][ \\t]*`,
        "gi"
      ),
      ""
    )
    .trim();

  return text;
}

// ── Mandatory phrase injection ────────────────────────────────────────────────
//
// 1. Sanitizes stale level labels in the model's body text so the justification
//    matches the engine's definitive finalLevel (not the model's estimate).
// 2. Prepends the canonical level-specific mandatory opening sentence when it
//    is not already present.  The prepend is idempotent.

export function injectMandatoryPhrases(finalLevel, ilrDescriptorJustification) {
  const phrase = MANDATORY_PHRASES[finalLevel];
  // Step 1 — replace stale level references in the model's text
  let text = sanitizeLevelClaims(ilrDescriptorJustification || "", finalLevel);
  // Step 2 — prepend mandatory phrase if not already present
  if (!phrase) return text;
  if (text.includes(phrase)) return text;
  return phrase + " " + text;
}

// ── Scope of rating ───────────────────────────────────────────────────────────

export function buildScopeOfRating(mode) {
  return SCOPE_OF_RATING[mode] ?? SCOPE_OF_RATING.reading;
}

// ── Level display helpers ─────────────────────────────────────────────────────

/** Returns the next higher ILR level string, or null if already at the top. */
export function nextHigherLevel(level) {
  const idx = levelIndex(level);
  return idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
}

/** Returns the next lower ILR level string, or null if already at the bottom. */
export function nextLowerLevel(level) {
  const idx = levelIndex(level);
  return idx > 0 ? LEVELS[idx - 1] : null;
}
