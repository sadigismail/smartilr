// ─────────────────────────────────────────────────────────────────────────────
// engine/listeningDeliveryAnalysis.js
//
// Listening Delivery Analysis Module
//
// Evaluates seven delivery dimensions from the model's ls* signal set and
// produces a deterministic Listening Difficulty rating (Easy / Moderate /
// Difficult) with a structured explanation for teachers.
//
// This module DOES NOT affect the ILR language level.  It operates entirely
// on delivery conditions; linguistic complexity is handled by the boundary
// engine and gate pipeline.
//
// Dimensions:
//   1. lsSpeechRate      — speech speed
//   2. lsDelivery        — articulation clarity
//   3. lsBackgroundNoise — background noise level
//   4. lsAccentLoad      — accent strength / intelligibility challenge
//   5. lsSpeakerCount    — number of speakers
//   6. lsOverlap         — overlapping speech
//   7. lsPauseStructure  — continuity / pause clarity
//
// Difficulty thresholds (total 0–14):
//   Easy:     0–2   (all or nearly all signals at Easy-contribution level)
//   Moderate: 3–6   (mix of Easy and Moderate signals)
//   Difficult: 7+   (several Moderate-to-Difficult signals present)
// ─────────────────────────────────────────────────────────────────────────────

// ── Scoring tables ─────────────────────────────────────────────────────────
// Each value maps to a difficulty-contribution score: 0 = Easy, 1 = Moderate,
// 2 = Difficult.  Unknown/missing values default to the middle contribution (1).

const SCORE = {
  lsSpeechRate: {
    slow:     0,
    moderate: 0,
    natural:  1,
    fast:     2,
  },
  lsDelivery: {
    clear:    0,
    natural:  1,
    dense:    2,
  },
  lsBackgroundNoise: {
    none:       0,
    minor:      1,
    noticeable: 2,
  },
  lsAccentLoad: {
    none:   0,
    mild:   1,
    heavy:  2,
  },
  lsSpeakerCount: {
    one:      0,
    two:      1,
    multiple: 2,
  },
  lsOverlap: {
    none:   0,
    some:   1,
    heavy:  2,
  },
  lsPauseStructure: {
    clear:    0,
    moderate: 1,
    weak:     2,
  },
};

const THRESHOLDS = {
  easy:     [0, 2],
  moderate: [3, 6],
  difficult:[7, 14],
};

// ── Human-readable signal descriptions ───────────────────────────────────────

const DIMENSION_LABELS = {
  lsSpeechRate:      "Speech rate",
  lsDelivery:        "Articulation clarity",
  lsBackgroundNoise: "Background noise",
  lsAccentLoad:      "Accent load",
  lsSpeakerCount:    "Speaker count",
  lsOverlap:         "Overlapping speech",
  lsPauseStructure:  "Pause structure",
};

const VALUE_DESCRIPTIONS = {
  lsSpeechRate: {
    slow:     "slow, deliberate delivery with frequent pausing",
    moderate: "below-conversational speed with clear chunking",
    natural:  "natural conversational pace",
    fast:     "above-conversational or compressed delivery",
  },
  lsDelivery: {
    clear:    "clear, careful articulation",
    natural:  "natural fluency with connected speech",
    dense:    "dense articulation with heavy reduction and minimal pausing",
  },
  lsBackgroundNoise: {
    none:       "no background noise",
    minor:      "minor background noise",
    noticeable: "noticeable noise competing with speech",
  },
  lsAccentLoad: {
    none:   "no significant accent load",
    mild:   "mild accent load",
    heavy:  "heavy accent load requiring active listener adjustment",
  },
  lsSpeakerCount: {
    one:      "single speaker",
    two:      "two speakers",
    multiple: "three or more speakers",
  },
  lsOverlap: {
    none:   "no overlapping speech",
    some:   "some overlapping speech",
    heavy:  "frequent overlapping speech",
  },
  lsPauseStructure: {
    clear:    "clear chunking with regular pauses",
    moderate: "mostly clear segmentation with some dense sequences",
    weak:     "weak segmentation — continuous or densely flowing speech",
  },
};

// ── Narrative builders ────────────────────────────────────────────────────────

function buildNarrative(difficulty, scored, signals) {
  const difficultFactors  = Object.entries(scored).filter(([, s]) => s === 2);
  const moderateFactors   = Object.entries(scored).filter(([, s]) => s === 1);
  const supportingFactors = Object.entries(scored).filter(([, s]) => s === 0);

  const describeFactor = (dim) =>
    `${DIMENSION_LABELS[dim]}: ${VALUE_DESCRIPTIONS[dim]?.[signals[dim]] ?? signals[dim]}`;

  if (difficulty === "easy") {
    const highlights = supportingFactors.slice(0, 3).map(([dim]) => describeFactor(dim));
    return (
      `Listening delivery is rated Easy. ` +
      `The spoken material presents minimal delivery challenges: ` +
      highlights.join("; ") + ". " +
      `Learners can focus attention on meaning without struggling with delivery conditions.`
    );
  }

  if (difficulty === "difficult") {
    const challenges = [...difficultFactors, ...moderateFactors].slice(0, 4).map(([dim]) => describeFactor(dim));
    return (
      `Listening delivery is rated Difficult. ` +
      `Several delivery conditions increase the challenge beyond content alone: ` +
      challenges.join("; ") + ". " +
      `Listeners must manage these conditions simultaneously while tracking meaning.`
    );
  }

  // Moderate
  const mixed = [...difficultFactors, ...moderateFactors].slice(0, 3).map(([dim]) => describeFactor(dim));
  const easy  = supportingFactors.slice(0, 2).map(([dim]) => describeFactor(dim));
  let text =
    `Listening delivery is rated Moderate. ` +
    `Some delivery conditions require attention beyond the content: ` +
    mixed.join("; ") + ".";
  if (easy.length > 0) {
    text += ` Supporting conditions include: ${easy.join("; ")}.`;
  }
  return text;
}

// ── Advanced Listening Analytics ──────────────────────────────────────────────
//
// Maps the existing ls* delivery signals to 4 teacher-facing analytics:
//   1. speechSpeed         — Slow / Natural / Fast
//   2. noiseLevel          — Low / Medium / High
//   3. speakerProfile      — Single / Dialogue / Multiple
//   4. segmentationQuality — Clear / Moderate / Weak
//
// Derived entirely from fields already returned by the model.  No new model
// calls are made.  These analytics support teacher interpretation ONLY and
// do NOT affect the ILR language level or the Listening Difficulty rating.

const ADVANCED_ANALYTICS_META = [
  {
    id:        "speechSpeed",
    label:     "Speech Speed",
    dimension: "lsSpeechRate",
    mapping: {
      slow:     { value: "Slow",    tier: "easy",
                  note: "Slow, deliberate pace — listeners have more processing time per utterance." },
      moderate: { value: "Slow",    tier: "easy",
                  note: "Below-natural pace with clear chunking — extra processing time available." },
      natural:  { value: "Natural", tier: "moderate",
                  note: "Conversational pace — typical of authentic spoken material." },
      fast:     { value: "Fast",    tier: "difficult",
                  note: "Elevated or compressed delivery — reduces processing time per utterance." },
    },
    contextNote: "Affects how much time the listener has to process each utterance.",
  },
  {
    id:        "noiseLevel",
    label:     "Noise Level",
    dimension: "lsBackgroundNoise",
    mapping: {
      none:       { value: "Low",    tier: "easy",
                    note: "No background noise — full attention can go to language processing." },
      minor:      { value: "Medium", tier: "moderate",
                    note: "Minor background noise — some additional perceptual effort required." },
      noticeable: { value: "High",   tier: "difficult",
                    note: "Noticeable noise competes with speech — listener must filter actively." },
    },
    contextNote: "Background noise adds perceptual load on top of linguistic processing.",
  },
  {
    id:        "speakerProfile",
    label:     "Speaker Profile",
    dimension: "lsSpeakerCount",
    mapping: {
      one:      { value: "Single",   tier: "easy",
                  note: "Single speaker — no discourse-role switching or turn-tracking required." },
      two:      { value: "Dialogue", tier: "moderate",
                  note: "Two speakers — listener must track turn-taking and assign references." },
      multiple: { value: "Multiple", tier: "difficult",
                  note: "Three or more speakers — continuous role reassignment and reference tracking." },
    },
    contextNote: "Multiple speakers increase discourse-tracking and reference-assignment demands.",
  },
  {
    id:        "segmentationQuality",
    label:     "Segmentation",
    dimension: "lsPauseStructure",
    mapping: {
      clear:    { value: "Clear",    tier: "easy",
                  note: "Clear chunking with regular pauses — utterance boundaries easy to detect." },
      moderate: { value: "Moderate", tier: "moderate",
                  note: "Mostly clear segmentation with some dense sequences." },
      weak:     { value: "Weak",     tier: "difficult",
                  note: "Continuous or densely flowing speech — boundary detection adds cognitive load." },
    },
    contextNote: "Clear segmentation helps listeners identify where meaning units begin and end.",
  },
];

function computeAdvancedListeningAnalytics(signals) {
  return ADVANCED_ANALYTICS_META.map(meta => {
    const rawValue = signals[meta.dimension] || "";
    const mapped   = meta.mapping[rawValue] ?? {
      value: rawValue ? rawValue.charAt(0).toUpperCase() + rawValue.slice(1) : "—",
      tier:  "moderate",
      note:  "",
    };
    return {
      id:          meta.id,
      label:       meta.label,
      dimension:   meta.dimension,
      rawValue,
      value:       mapped.value,
      tier:        mapped.tier,   // "easy" | "moderate" | "difficult"
      note:        mapped.note,
      contextNote: meta.contextNote,
    };
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * analyzeListeningDelivery
 *
 * @param {object} modelResult - Raw model result containing ls* signal fields.
 * @returns {{
 *   deliveryDifficulty:     "easy" | "moderate" | "difficult",
 *   deliveryScore:          number,
 *   deliverySignals:        object,
 *   deliverySignalScores:   object,
 *   deliveryFactors:        Array<{ dimension, label, value, description, score }>,
 *   deliveryExplanation:    string,
 * }}
 */
export function analyzeListeningDelivery(modelResult) {
  // Extract all seven delivery signals with safe defaults
  const signals = {
    lsSpeechRate:      (modelResult.lsSpeechRate      || "natural").toLowerCase().trim(),
    lsDelivery:        (modelResult.lsDelivery        || "natural").toLowerCase().trim(),
    lsBackgroundNoise: (modelResult.lsBackgroundNoise || "none"   ).toLowerCase().trim(),
    lsAccentLoad:      (modelResult.lsAccentLoad      || "none"   ).toLowerCase().trim(),
    lsSpeakerCount:    (modelResult.lsSpeakerCount    || "one"    ).toLowerCase().trim(),
    lsOverlap:         (modelResult.lsOverlap         || "none"   ).toLowerCase().trim(),
    lsPauseStructure:  (modelResult.lsPauseStructure  || "clear"  ).toLowerCase().trim(),
  };

  // Score each dimension
  const scored = {};
  for (const [dim, value] of Object.entries(signals)) {
    const table = SCORE[dim];
    // Unknown values default to 1 (moderate contribution)
    scored[dim] = table?.[value] ?? 1;
  }

  const total = Object.values(scored).reduce((sum, s) => sum + s, 0);

  // Determine difficulty
  let deliveryDifficulty;
  if (total <= THRESHOLDS.easy[1]) {
    deliveryDifficulty = "easy";
  } else if (total <= THRESHOLDS.moderate[1]) {
    deliveryDifficulty = "moderate";
  } else {
    deliveryDifficulty = "difficult";
  }

  // Build per-factor detail list
  const deliveryFactors = Object.entries(signals).map(([dim, value]) => ({
    dimension:   dim,
    label:       DIMENSION_LABELS[dim],
    value,
    description: VALUE_DESCRIPTIONS[dim]?.[value] ?? value,
    score:       scored[dim],
  }));

  const deliveryExplanation    = buildNarrative(deliveryDifficulty, scored, signals);
  const advancedAnalytics      = computeAdvancedListeningAnalytics(signals);

  return {
    deliveryDifficulty,
    deliveryScore: total,
    deliverySignals:      signals,
    deliverySignalScores: scored,
    deliveryFactors,
    deliveryExplanation,
    advancedAnalytics,
  };
}
