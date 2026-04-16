// ─────────────────────────────────────────────────────────────────────────────
// engine/rubricEngine.js
//
// Auto Rubric Justification generator.
//
// Produces a structured, teacher-facing rubric from the final gated ILR level
// and the normalized passage signals.  No additional AI calls are made.
//
// Output shape:
//   {
//     level: "2+",
//     categories: [
//       {
//         key:         "mainIdea",
//         label:       "Main Idea",
//         descriptor:  "The main idea spans multiple paragraphs …",
//         justification: "The passage develops its central idea …",
//         score:       3.5,          // 0.0–5.0
//         scoreLabel:  "High",       // Low / Moderate / High / Very High
//       },
//       … (7 total)
//     ],
//     summary: {
//       assigned:  "Assigned because …",
//       notLower:  "The passage exceeds … / null at minimum",
//       notHigher: "The discourse is not sufficiently … / null at maximum",
//     },
//   }
//
// IMPORTANT: this module does NOT set or override the ILR level.  All
// placement logic lives in ilrRules / hardGates / modalityRules.
// ─────────────────────────────────────────────────────────────────────────────

import { levelIndex } from "./ilrRules.js";
import {
  RUBRIC_DESCRIPTORS,
  RUBRIC_SUMMARIES,
  RUBRIC_CATEGORY_META,
} from "../config/rubricConfig.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(v)         { return Math.round(v * 10) / 10; }

/** Map a 0–5 score to a label. */
function scoreLabel(score) {
  if (score < 1.5) return "Low";
  if (score < 3.0) return "Moderate";
  if (score < 4.5) return "High";
  return "Very High";
}

/** Select the right level bucket key for template look-up. */
function levelKey(finalLevel) {
  // Must exactly match keys used in RUBRIC_DESCRIPTORS / RUBRIC_SUMMARIES.
  const valid = ["0+", "1", "1+", "2", "2+", "3", "3+", "4", "4+", "5"];
  return valid.includes(finalLevel) ? finalLevel : "1+";
}

/** ILR level as a numeric index (0–5) — used for score base values. */
const LEVEL_BASE_SCORES = {
  "0+": 0.5,
  "1":  1.0,
  "1+": 1.6,
  "2":  2.2,
  "2+": 2.8,
  "3":  3.4,
  "3+": 4.0,
  "4":  4.4,
  "4+": 4.7,
  "5":  5.0,
};

function levelBase(finalLevel) {
  return LEVEL_BASE_SCORES[finalLevel] ?? 2.0;
}

// ── Signal-based justification sentences ─────────────────────────────────────
//
// One function per category.  Each function returns a single, teacher-facing
// sentence grounded in the detected signals.  The sentence supplements the
// level-based descriptor with evidence specific to this passage.

function mainIdeaJustification(s) {
  if (s.multiparagraphArgument && s.paragraphDependency) {
    return "The central idea is constructed across multiple paragraphs with each section building on prior content; accessing it requires integrating paragraph-level units rather than extracting a single topic sentence.";
  }
  if (s.multiparagraphArgument) {
    return "The main idea develops across multiple paragraphs; no single segment contains the full idea, requiring cross-paragraph synthesis.";
  }
  if (s.paragraphLevelDiscourse && !s.multiparagraphArgument) {
    return "The main idea is organized at the paragraph level, requiring the reader to track its development across connected sentences rather than extracting it from a single location.";
  }
  if (s.multipleSentencesConnected && !s.paragraphLevelDiscourse) {
    return "The main idea unfolds across a sequence of connected sentences; tracking the chain of information is necessary to reconstruct the central point.";
  }
  if (s.noConnectedSentences || s.isolatedFacts) {
    return "The main idea, if present, is directly accessible from individual sentences without any need for integrative reading.";
  }
  return "The main idea is explicitly stated and accessible through straightforward reading without extended integration.";
}

function supportingDetailJustification(s) {
  if (s.detailIntegration && s.multiparagraphArgument) {
    return "Details are embedded within the argument structure and distributed across paragraphs; locating and interpreting each detail requires comprehending its relationship to surrounding discourse rather than simply identifying it by position.";
  }
  if (s.detailIntegration) {
    return "Details are embedded within the argumentative structure rather than listed independently; their interpretation depends on the surrounding paragraph context.";
  }
  if (s.crossSentenceDependency && !s.detailIntegration) {
    return "Details rely on cross-sentence reference tracking; individual details cannot be fully interpreted without reading surrounding sentences for anaphoric context.";
  }
  if (s.multipleSentencesConnected && !s.crossSentenceDependency) {
    return "Details are distributed across connected sentences and require sequential reading to locate, though they remain explicitly stated.";
  }
  if (s.isolatedFacts) {
    return "Details are presented as isolated, discrete facts that can be located and extracted without reference to surrounding text.";
  }
  return "Details are accessible through careful reading and do not require sustained cross-sentence integration to be correctly identified.";
}

function inferenceJustification(s) {
  if ((s.heavyInference || s.implicitMeaning) && s.abstractReasoning) {
    return "Sustained and heavy inference is required: the reader must actively reconstruct withheld reasoning and abstract relationships that are not stated but are necessary for comprehension.";
  }
  if (s.heavyInference || s.implicitMeaning) {
    return "Significant inference is required; portions of meaning are deliberately withheld or implied, and comprehension cannot be achieved by processing only what is directly stated.";
  }
  if (s.significantInference) {
    return "The reader must make multiple inferences beyond what is explicitly stated; implied meaning appears repeatedly across the passage rather than at isolated points.";
  }
  if (s.moderateInference) {
    return "Limited inference is required at several points where the passage does not explicitly bridge between stated information and implied conclusion.";
  }
  return "Inference is minimal; the passage remains largely explicit and comprehension does not require reconstruction of unstated meaning.";
}

function discourseOrganizationJustification(s, mode) {
  const isL = mode === "listening";
  if (s.multiparagraphArgument && s.paragraphDependency) {
    return isL
      ? "The discourse unfolds across multiple speaker turns or extended segments with tight logical dependency; each unit builds on the prior and the sequence cannot be disrupted without loss of meaning, requiring the listener to track the organizational architecture across the full audio passage."
      : "The discourse develops through paragraph-to-paragraph dependency; each paragraph builds on the prior and the sequence cannot be disrupted without loss of meaning, requiring the reader to track the organizational architecture across the full passage.";
  }
  if (s.multiparagraphArgument && !s.paragraphDependency) {
    return isL
      ? "The discourse develops across multiple extended segments or turns; while individual units are internally coherent, full comprehension requires tracking the progression of ideas across them."
      : "The discourse develops across multiple paragraphs; while individual paragraphs are internally coherent, full comprehension requires tracking the progression of ideas across them.";
  }
  if (s.paragraphLevelDiscourse && !s.multiparagraphArgument) {
    return isL
      ? "The discourse is organized within distinct segments with recognizable internal structure; tracking this organization is required, but cross-segment dependency does not add to the burden."
      : "Discourse organization is coherent at the paragraph level with a recognizable internal structure; tracking this organization is required, but multi-paragraph dependency does not add to the burden.";
  }
  if (s.explicitRelationships && !s.paragraphLevelDiscourse) {
    return isL
      ? "Discourse is organized through explicit relational markers (causal, contrastive, sequential) that the listener must process to follow the argument; the organization is linear and accessible."
      : "Discourse is organized through explicit relational markers (causal, contrastive, sequential) that the reader must process to follow the argument; the organization is linear and accessible.";
  }
  if (s.noConnectedSentences) {
    return isL
      ? "Discourse organization is absent or minimal; the audio consists of discrete statements without a connective or argumentative structure."
      : "Discourse organization is absent or minimal; the passage consists of discrete items without a connective or argumentative structure.";
  }
  return isL
    ? "The discourse follows an accessible linear organization that does not require tracking complex structural dependencies across speaker turns."
    : "The discourse follows an accessible linear organization that does not require tracking complex structural dependencies.";
}

function vocabularyJustification(s, _finalLevel, _mode, modelResult) {
  const mr = modelResult || {};
  const discourseType = (mr.discourseType || "").toLowerCase();
  const lsInference   = (mr.lsInference   || "").toLowerCase();
  const isNewsBroadcast = discourseType.includes("news");
  const hasGenuineAbstraction =
    s.implicitMeaning || s.heavyInference || s.significantInference ||
    s.layeredReasoning || s.nuancedPerspective;

  // News broadcast with institutional/political vocabulary but no genuine abstraction:
  // political and institutional terminology is concrete reference, not abstract reasoning.
  if (isNewsBroadcast && lsInference !== "significant" && !hasGenuineAbstraction) {
    return "The vocabulary includes institutional and domain-specific terminology (political, judicial, or procedural) that is concrete and event-referenced rather than abstractly conceptual. Institutional vocabulary describes real roles, events, and procedures; it does not require the listener to construct abstract relationships or implicit meanings. Abstraction demand is moderate.";
  }

  if (s.abstractReasoning && s.conceptualVocabulary) {
    return "Key vocabulary operates at a high level of abstraction; terms are conceptual and their meaning is inseparable from the argumentative context, requiring interpretation beyond surface recognition.";
  }
  if (s.abstractReasoning && !s.conceptualVocabulary) {
    return "Abstract reasoning is required to follow the passage's argument, though the core vocabulary remains within accessible registers; meaning is constructed from the logic of the text rather than from unfamiliar terminology.";
  }
  if (s.conceptualVocabulary) {
    return "Vocabulary includes conceptual terms that must be interpreted in context; recognition of surface or dictionary meanings is not sufficient for full comprehension.";
  }
  if (s.noConnectedSentences || s.shortStatements || s.simpleAdditiveText) {
    return "Vocabulary is primarily concrete and high-frequency; no abstraction or specialized lexis creates an additional comprehension layer.";
  }
  return "The vocabulary includes moderate abstraction but remains structurally accessible; contextual interpretation does not exceed what a mid-proficiency reader would be expected to handle.";
}

function tonePurposeJustification(s) {
  if (s.nuancedPerspective && s.stanceDetection) {
    return "The author's stance is indirect and distributed across rhetorical choices rather than stated through explicit evaluative vocabulary; identifying the purpose requires sustained interpretive reading rather than tone-spotting.";
  }
  if (s.nuancedPerspective) {
    return "The author's perspective is embedded in structural and rhetorical choices; the reader cannot rely on explicit markers to identify the stance and must reconstruct it through sustained engagement.";
  }
  if (s.stanceDetection && !s.nuancedPerspective) {
    return "The author's tone and purpose are identifiable but require tracking evaluative language distributed across the passage rather than from a single phrase or paragraph.";
  }
  if (s.isExplanatoryText) {
    return "The text's purpose is explicitly to explain or inform; the discourse structure makes the intent transparent and the tone remains consistently neutral.";
  }
  if (s.layeredReasoning) {
    return "The passage's purpose involves layered argumentation; the reader must track how the rhetorical purpose evolves as sub-arguments are introduced and resolved.";
  }
  return "The tone and purpose are accessible through direct reading; the author's intent is transparent and does not require sustained interpretive effort to identify.";
}

function overallDemandJustification(s, finalLevel) {
  const li = levelIndex(finalLevel);
  if (li >= levelIndex("3")) {
    return "The combination of sustained inferential reading, layered discourse structure, conceptual abstraction, and extended development places this passage at the highest defined level of comprehension demand.";
  }
  if (li >= levelIndex("2+")) {
    const features = [];
    if (s.multiparagraphArgument || s.paragraphDependency) features.push("multi-paragraph integration");
    if (s.heavyInference || s.significantInference)         features.push("inferential engagement");
    if (s.abstractReasoning || s.conceptualVocabulary)      features.push("conceptual abstraction");
    if (s.stanceDetection || s.nuancedPerspective)          features.push("stance interpretation");
    const list = features.length > 0
      ? features.join(", ")
      : "the combination of paragraph-level organization and implied meaning";
    return `The overall demand reflects ${list}, placing this passage above the threshold of straightforward paragraph-level comprehension.`;
  }
  if (li >= levelIndex("2")) {
    return "The overall comprehension demand is moderate; the reader must integrate paragraph-level information, but the passage remains accessible to an intermediate-proficiency reader without demanding sustained inference or abstraction.";
  }
  if (li >= levelIndex("1+")) {
    return "The overall demand is moderate-low: connected discourse requires the reader to follow a sequential chain of ideas, but no paragraph-level or inferential demands are placed beyond the sentence-level.";
  }
  if (li >= levelIndex("1")) {
    return "The overall demand is low; the text is explicit and self-contained at the sentence level, and comprehension does not require active integration across any text unit larger than a single sentence.";
  }
  return "The overall comprehension demand is minimal; the text is formulaic or pre-linguistic and does not require active reading at the connected sentence level.";
}

// ── Score computation per category ────────────────────────────────────────────
//
// Scores are 0.0–5.0.  Each starts from the level base and is adjusted
// by signals specific to that category.

export function scoreMainIdea(s, finalLevel) {
  let score = levelBase(finalLevel);
  if (s.multiparagraphArgument)      score += 0.6;
  if (s.paragraphDependency)         score += 0.5;
  if (s.paragraphLevelDiscourse)     score += 0.3;
  if (s.implicitMeaning)             score += 0.4;
  if (s.noConnectedSentences)        score -= 0.5;
  if (s.isolatedFacts)               score -= 0.4;
  return round1(clamp(score, 0, 5));
}

export function scoreSupportingDetail(s, finalLevel) {
  let score = levelBase(finalLevel);
  if (s.detailIntegration)           score += 0.6;
  if (s.crossSentenceDependency)     score += 0.5;
  if (s.multiparagraphArgument)      score += 0.4;
  if (s.isolatedFacts)               score -= 0.7;
  if (s.noConnectedSentences)        score -= 0.5;
  return round1(clamp(score, 0, 5));
}

export function scoreInference(s, finalLevel) {
  let score = levelBase(finalLevel);
  if (s.heavyInference)              score += 0.7;
  if (s.implicitMeaning)             score += 0.6;
  if (s.significantInference)        score += 0.5;
  if (s.moderateInference)           score += 0.3;
  if (s.abstractReasoning)           score += 0.3;
  if (s.noConnectedSentences || s.isolatedFacts) score -= 0.6;
  return round1(clamp(score, 0, 5));
}

export function scoreDiscourseOrganization(s, finalLevel) {
  let score = levelBase(finalLevel);
  if (s.multiparagraphArgument)      score += 0.6;
  if (s.paragraphDependency)         score += 0.5;
  if (s.paragraphLevelDiscourse)     score += 0.3;
  if (s.explicitRelationships)       score += 0.2;
  if (s.layeredReasoning)            score += 0.4;
  if (s.noConnectedSentences)        score -= 0.8;
  if (s.simpleAdditiveText)          score -= 0.4;
  return round1(clamp(score, 0, 5));
}

export function scoreVocabularyAbstraction(s, finalLevel, modelResult) {
  const mr = modelResult || {};

  // Derive context from modelResult (listening-mode ls* fields)
  const discourseType   = (mr.discourseType || "").toLowerCase();
  const isNewsBroadcast = discourseType.includes("news");

  // Signals indicating GENUINE abstraction demand:
  //   implicitMeaning  — listener/reader must construct meaning not on the surface
  //   heavyInference   — explicit inference demand, not just topic complexity
  // NOTE: significantInference and layeredReasoning are intentionally excluded here
  // because for listening, significantInference is also set when lsInference="significant"
  // which the model may misassign due to political/institutional vocabulary.
  // Only implicitMeaning and heavyInference — which are not set by vocabulary alone —
  // count as genuine abstraction demand for guard purposes.
  const hasGenuineAbstraction = s.implicitMeaning || s.heavyInference;

  let score = levelBase(finalLevel);

  // ── NEWS BROADCAST: zero abstraction bonuses, hard 3.0 cap ─────────────────
  //
  // News broadcasts (political, judicial, institutional reporting) use
  // discourseType="news broadcast". All content — even with heavy political
  // vocabulary — is explicitly stated; the listener tracks events and reactions,
  // not abstract relationships.
  //
  // The ls* synthesis block in scoringEngine.js injects abstractReasoning,
  // conceptualVocabulary, implicitMeaning, heavyInference, and layeredReasoning
  // whenever lsStructure="analytical" — which the model misassigns for political
  // vocabulary. These injected signals must NOT contribute to the abstraction score.
  //
  // Hard rule: news broadcasts are capped at 3.0 with no signal bonuses.
  // The ILR level itself is already capped at 2+ by CEILING-7; the abstraction
  // feature score must reflect the same factual, explicit discourse structure.
  if (isNewsBroadcast) {
    // No bonuses — institutional/political vocabulary is concrete reference
    if (s.noConnectedSentences || s.shortStatements || s.simpleAdditiveText) score -= 0.5;
    score = Math.min(score, 3.0);
    return round1(clamp(score, 0, 5));
  }

  // ── Standard (non-news) abstraction scoring ─────────────────────────────────
  if (s.abstractReasoning)    score += 0.9;
  if (s.conceptualVocabulary) score += 0.7;
  if (s.layeredReasoning)     score += 0.4;
  if (s.noConnectedSentences || s.shortStatements || s.simpleAdditiveText) score -= 0.5;

  // Consistency cap: when the passage is a simple explicit argument or explanatory
  // text, the topic may be abstract but the discourse does NOT require implicit
  // interpretation. Abstraction cannot be Very High (≥ 4.5) — cap at 3.5 ("High")
  // to reflect topic sophistication without overstating interpretive demand.
  if (s.isSimpleArgument || s.isExplanatoryText) score = Math.min(score, 3.5);

  // ── GENERAL INFERENCE-ABSENCE CAP ──────────────────────────────────────────
  // No passage should score Very High abstraction (> 4.0) without evidence
  // that the listener/reader must construct implicit meaning or heavy inference.
  // Topic complexity, institutional terminology, and named entities are NOT
  // abstract reasoning — they are features of the subject matter.
  if (score > 4.0 && !hasGenuineAbstraction) {
    score = Math.min(score, 3.0);
  }

  return round1(clamp(score, 0, 5));
}

export function scoreTonePurpose(s, finalLevel) {
  let score = levelBase(finalLevel);
  if (s.nuancedPerspective)          score += 0.8;
  if (s.stanceDetection)             score += 0.5;
  if (s.layeredReasoning)            score += 0.5;
  if (s.isExplanatoryText)           score -= 0.4;
  if (s.noConnectedSentences)        score -= 0.5;
  return round1(clamp(score, 0, 5));
}

function scoreOverallDemand(s, finalLevel) {
  // Overall is derived directly from the level base with minor signal tuning.
  let score = levelBase(finalLevel);
  // Positive features that increase demand
  const positiveCount = [
    s.multiparagraphArgument, s.paragraphDependency,
    s.heavyInference, s.implicitMeaning, s.significantInference,
    s.abstractReasoning, s.conceptualVocabulary,
    s.nuancedPerspective, s.layeredReasoning,
  ].filter(Boolean).length;
  score += positiveCount * 0.08;
  // Simplifying features
  if (s.noConnectedSentences)  score -= 0.4;
  if (s.isolatedFacts)         score -= 0.3;
  if (s.simpleAdditiveText)    score -= 0.3;
  return round1(clamp(score, 0, 5));
}

// ── Score dispatch map ────────────────────────────────────────────────────────

const SCORE_FN = {
  mainIdea:               scoreMainIdea,
  supportingDetail:       scoreSupportingDetail,
  inference:              scoreInference,
  discourseOrganization:  scoreDiscourseOrganization,
  vocabularyAbstraction:  scoreVocabularyAbstraction,
  tonePurpose:            scoreTonePurpose,
  overallDemand:          scoreOverallDemand,
};

const JUSTIFICATION_FN = {
  mainIdea:               (s, fl, _m) => mainIdeaJustification(s),
  supportingDetail:       (s, fl, _m) => supportingDetailJustification(s),
  inference:              (s, fl, _m) => inferenceJustification(s),
  discourseOrganization:  (s, fl,  m) => discourseOrganizationJustification(s, m),
  vocabularyAbstraction:  (s, fl, m, mr) => vocabularyJustification(s, fl, m, mr),
  tonePurpose:            (s, fl, _m) => tonePurposeJustification(s),
  overallDemand:          (s, fl, _m) => overallDemandJustification(s, fl),
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * computeRubricJustification
 *
 * @param {string}  finalLevel   — The gated final ILR level (e.g., "2+")
 * @param {object}  signals      — Normalized signal object from normalizeSignals()
 * @param {object}  modelResult  — Raw model result (used for any supplemental fields)
 * @param {string}  [mode]       — "reading" | "listening"; defaults to "reading"
 * @returns {object} Structured rubric justification ready for the UI
 */
export function computeRubricJustification(finalLevel, signals, modelResult, mode = "reading") {
  const s   = signals || {};
  const lk  = levelKey(finalLevel);
  const m   = (mode === "listening") ? "listening" : "reading";

  // Build one record per category using the ordered metadata list.
  const categories = RUBRIC_CATEGORY_META.map(meta => {
    const { key, label, description } = meta;

    const descriptor    = RUBRIC_DESCRIPTORS[key]?.[lk] ?? "";
    const justFn        = JUSTIFICATION_FN[key];
    const justification = justFn ? justFn(s, finalLevel, m, modelResult) : "";
    const scoreFn       = SCORE_FN[key];
    const score         = scoreFn ? scoreFn(s, finalLevel, modelResult) : levelBase(finalLevel);

    return {
      key,
      label,
      description,
      descriptor,
      justification,
      score,
      scoreLabel: scoreLabel(score),
    };
  });

  // ── Post-final normalisation ────────────────────────────────────────────
  // Cap category scores so the rubric profile is internally consistent with
  // the assigned ILR level.  Higher-level passages may legitimately earn high
  // feature scores, but a lower final level must not show scores that imply a
  // level above what was assigned.
  //
  // Keys map to the SCORE_FN / category key names:
  //   vocabularyAbstraction → abstractionScore
  //   mainIdea              → sentenceComplexityScore
  //   supportingDetail      → cohesionScore
  //   discourseOrganization → discourseLengthScore

  const LEVEL_SCORE_CAPS = {
    "2+": {
      vocabularyAbstraction: 3.5,
      mainIdea:              3.5,
      supportingDetail:      3.5,
      discourseOrganization: 3.2,
    },
    "2": {
      vocabularyAbstraction: 3.0,
      mainIdea:              3.0,
      supportingDetail:      3.0,
      discourseOrganization: 2.8,
    },
  };

  // For levels below 2 (0+, 1, 1+), cap vocabulary at 3.0.
  const LOW_LEVELS = new Set(["0+", "1", "1+"]);
  if (LOW_LEVELS.has(finalLevel)) {
    const abstIdx = categories.findIndex(c => c.key === "vocabularyAbstraction");
    if (abstIdx !== -1 && categories[abstIdx].score > 3.0) {
      const cappedScore = 3.0;
      categories[abstIdx] = {
        ...categories[abstIdx],
        score:      cappedScore,
        scoreLabel: scoreLabel(cappedScore),
      };
    }
  }

  // Apply level-specific per-category caps for ILR 2 and 2+.
  const levelCaps = LEVEL_SCORE_CAPS[finalLevel];
  if (levelCaps) {
    categories.forEach((cat, i) => {
      const cap = levelCaps[cat.key];
      if (cap !== undefined && cat.score > cap) {
        categories[i] = {
          ...cat,
          score:      round1(cap),
          scoreLabel: scoreLabel(cap),
        };
      }
    });
  }

  // ── Short-passage display dampening ────────────────────────────────────────
  // Mirrors the dampening applied to scoring-gate proxies in scoringEngine.js.
  // Prevents the rubric display from showing inflated scores for short passages
  // that the ILR level gates have already corrected in the final assignment.
  //
  //   discourseOrganization  → discourseScore   (×0.65 / ×0.55, cap 3.4)
  //   vocabularyAbstraction  → abstractionScore (×0.70 / ×0.60, cap 3.6)
  //   mainIdea               → sentenceComplexity (×0.75 / ×0.65, no ceiling)
  const mr2    = modelResult || {};
  const wc     = (mr2.passageWordCount && mr2.passageWordCount > 0) ? mr2.passageWordCount : Infinity;
  const SHORT  = wc < 120;
  const VSHORT = wc < 70;

  if (SHORT) {
    const DAMPEN = {
      discourseOrganization:  { tier1: 0.65, tier2: 0.55, ceil: 3.4 },
      vocabularyAbstraction:  { tier1: 0.70, tier2: 0.60, ceil: 3.6 },
      mainIdea:               { tier1: 0.75, tier2: 0.65, ceil: null },
    };
    categories.forEach((cat, i) => {
      const cfg = DAMPEN[cat.key];
      if (!cfg) return;
      let s = cat.score;
      s *= cfg.tier1;
      if (VSHORT) s *= cfg.tier2;
      if (cfg.ceil !== null) s = Math.min(s, cfg.ceil);
      s = round1(s);
      categories[i] = { ...cat, score: s, scoreLabel: scoreLabel(s) };
    });
  }

  // Summary statements — from level templates.
  const summary = RUBRIC_SUMMARIES[lk] ?? {
    assigned:  "",
    notLower:  null,
    notHigher: null,
  };

  return {
    level: finalLevel,
    categories,
    summary: {
      assigned:  summary.assigned  ?? null,
      notLower:  summary.notLower  ?? null,
      notHigher: summary.notHigher ?? null,
    },
  };
}
