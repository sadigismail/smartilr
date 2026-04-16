// ─────────────────────────────────────────────────────────────────────────────
// engine/itemDifficulty.js
//
// Item Difficulty Predictor — companion analysis to the ILR passage rating.
//
// For each of eight DLPT-style question types this module predicts:
//   • score        — numeric difficulty score 0.0–5.0
//   • difficulty   — label: Easy / Moderate / Challenging / Very Challenging
//   • ilrDemand    — the ILR comprehension level the question type is likely to demand
//   • explanation  — short teacher-facing rationale
//
// IMPORTANT: item difficulty DOES NOT override or influence the passage ILR
// level.  It is a companion analysis only.  All scoring weights are editable
// in config/scoringConfig.js → ITEM_DIFFICULTY_CONFIG.
// ─────────────────────────────────────────────────────────────────────────────

import { ITEM_DIFFICULTY_CONFIG } from "../config/scoringConfig.js";

const { THRESHOLDS, ILR_DEMAND, QUESTION_TYPES, SIGNAL_WEIGHTS, ITEM_TAGS } = ITEM_DIFFICULTY_CONFIG;

// ── Difficulty label from score ───────────────────────────────────────────────
function difficultyLabel(score) {
  if (score < THRESHOLDS.EASY)        return "Easy";
  if (score < THRESHOLDS.MODERATE)    return "Moderate";
  if (score < THRESHOLDS.CHALLENGING) return "Challenging";
  return "Very Challenging";
}

// ── Short explanations keyed by question type + difficulty ────────────────────
//
// Each builder receives the detected signals object and the difficulty label,
// and returns a single readable sentence for the teacher panel.

const EXPLANATIONS = {

  mainIdea(s, diff) {
    if (diff === "Easy")
      return "The main point is stated explicitly and reinforced across the passage; little inferential effort is required to identify it.";
    if (diff === "Moderate")
      return "The main idea is generally clear but may require the reader to synthesize two or three sentences rather than reading a single explicit statement.";
    if (diff === "Challenging")
      return "The main idea is partially implied; the reader must integrate information across the passage without a direct summary statement.";
    return "The main idea is embedded in abstract or layered argument; identifying it requires sustained inference and interpretation across the full passage.";
  },

  supportingDetail(s, diff) {
    if (diff === "Easy")
      return "Details are localized and self-contained; each can be verified from a single sentence without cross-sentence tracking.";
    if (diff === "Moderate")
      return "Some details are distributed across adjacent sentences; the reader must connect two or three sentences to locate the relevant information.";
    if (diff === "Challenging")
      return "Details are distributed throughout the passage and several are embedded in subordinate clauses; finding them requires careful cross-sentence tracking.";
    return "Details are densely embedded across multiple paragraphs; readers must navigate complex clause structure and paragraph dependencies to locate specific information.";
  },

  inference(s, diff) {
    if (diff === "Easy")
      return "Meaning is stated directly; no bridging inference or implied information is required to process the passage.";
    if (diff === "Moderate")
      return "Occasional implied meaning requires the reader to draw simple connections, but most information is explicitly stated.";
    if (diff === "Challenging")
      return "Significant portions of meaning are implied rather than stated; the reader must construct bridging inferences across sentences.";
    return "Heavy inference is required throughout; meaning is systematically withheld from the surface text and must be reconstructed from implicit cues.";
  },

  purpose(s, diff) {
    if (diff === "Easy")
      return "The author's intent is explicit and directly stated; purpose questions require only literal comprehension.";
    if (diff === "Moderate")
      return "The author's purpose is generally identifiable from the structure or topic, though it may not be stated in a single sentence.";
    if (diff === "Challenging")
      return "The author's intent is indirect; the reader must consider the overall structure, stance signals, and implied meaning to determine purpose.";
    return "The author's purpose is highly implicit and requires sustained interpretation of abstract argumentation, viewpoint, and implied critique.";
  },

  toneAttitude(s, diff) {
    if (diff === "Easy")
      return "Tone or attitude is absent or unmistakably neutral; no stance-detection is required from the reader.";
    if (diff === "Moderate")
      return "The author's attitude is generally discernible from word choice or structure, though not overtly labeled.";
    if (diff === "Challenging")
      return "Stance is subtly expressed or qualified; readers must identify nuanced attitude signals embedded in the syntax or vocabulary.";
    return "Tone is highly nuanced, layered, or ambiguous; identifying it requires integration of implicit meaning, abstract vocabulary, and shifting perspective across the passage.";
  },

  paraphraseRecognition(s, diff) {
    if (diff === "Easy")
      return "Vocabulary is concrete and familiar; paraphrase recognition requires only basic synonym matching at the sentence level.";
    if (diff === "Moderate")
      return "Some abstract or domain-specific vocabulary requires the reader to recognize meaning expressed through reformulation or structural variation.";
    if (diff === "Challenging")
      return "The passage uses conceptual or abstract vocabulary that is reformulated across sentences; readers must recognize equivalent meaning in varied expression.";
    return "Heavy abstraction and complex clause structure mean that passage ideas are expressed very differently from their paraphrases; recognition requires deep semantic processing.";
  },

  compareContrast(s, diff) {
    if (diff === "Easy")
      return "Comparative relationships are explicitly signaled by connectors or markers; no implicit inference about relationships is needed.";
    if (diff === "Moderate")
      return "Some relationships are signaled; others require the reader to infer a contrast or similarity from adjacent sentences.";
    if (diff === "Challenging")
      return "Relationships between ideas are largely implicit; the reader must construct comparisons without clear discourse markers.";
    return "Complex multi-paragraph relationships are left entirely implicit; readers must integrate abstract reasoning across the passage to identify what is being compared or contrasted and why.";
  },

  synthesis(s, diff) {
    if (diff === "Easy")
      return "The passage presents a single main idea; synthesis requires only identifying one central point without combining multiple supporting threads.";
    if (diff === "Moderate")
      return "Two or three supporting ideas must be combined; moderate cross-sentence tracking is required to produce a unified understanding.";
    if (diff === "Challenging")
      return "Multiple distinct supporting ideas are distributed across the passage; combining them into a coherent whole requires sustained paragraph-level integration.";
    return "Synthesis requires integrating layered reasoning and multiple paragraph-level threads; readers must construct meaning from a complex network of interdependent ideas.";
  },
};

// ── Score for a single question type ─────────────────────────────────────────
function scoreItem(key, signals) {
  const { base } = QUESTION_TYPES[key];
  const weights  = SIGNAL_WEIGHTS[key] || {};
  let score      = base;

  for (const [signal, weight] of Object.entries(weights)) {
    if (signals[signal]) score += weight;
  }

  return Math.round(Math.min(5.0, Math.max(0.0, score)) * 10) / 10;
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Compute item difficulty predictions for all eight question types.
 *
 * @param {Object} signals   — normalised detectedSignals from model output
 * @returns {Object}          — { items, teacherNote }
 */
export function computeItemDifficulty(signals = {}) {
  const items = {};

  for (const [key, cfg] of Object.entries(QUESTION_TYPES)) {
    const score      = scoreItem(key, signals);
    const difficulty = difficultyLabel(score);
    const ilrDemand  = ILR_DEMAND[difficulty];
    const explanation = EXPLANATIONS[key]
      ? EXPLANATIONS[key](signals, difficulty)
      : "";
    const tags = (ITEM_TAGS[key] && ITEM_TAGS[key][difficulty]) || [];

    items[key] = {
      label:       cfg.label,
      score,
      difficulty,
      ilrDemand,
      explanation,
      tags,
    };
  }

  return {
    items,
    teacherNote:
      "This predictor estimates which DLPT-style question types are likely to be " +
      "easier or harder based on the structure and meaning demands of the passage. " +
      "Item difficulty is a companion analysis and does not override the passage ILR level.",
  };
}
