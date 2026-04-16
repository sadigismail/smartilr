// ─────────────────────────────────────────────────────────────────────────────
// engine/modalityBranches.js
//
// Two distinct analysis branches that evaluate text complexity through the lens
// of reading vs. listening comprehension.  Each branch computes dimension scores
// (0.0–5.0) from the normalised passage signals.
//
// Reading branch:  7 dimensions reflecting textual/visual processing demands.
// Listening branch: 8 dimensions reflecting auditory/real-time processing demands.
//
// A cross-modality comparison note is also produced, estimating whether and why
// the same material would function at a different ILR level in the other modality.
//
// IMPORTANT: neither branch drives the ILR level.  Level assignment is governed
// solely by the gate and ceiling system in ilrRules.js / modalityRules.js /
// hardGates.js.  These branch scores are teacher-facing transparency only.
// ─────────────────────────────────────────────────────────────────────────────

import { LEVELS } from "../config/scoringConfig.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(v)         { return Math.round(v * 10) / 10; }

/** Map a 0–5 score to a Low / Moderate / High / Very High label. */
function levelLabel(score) {
  if (score < 1.6) return "Low";
  if (score < 3.1) return "Moderate";
  if (score < 4.6) return "High";
  return "Very High";
}

// ── Discourse-type textual organisation base scores (0–5) ─────────────────────
const DISCOURSE_ORG = {
  "simple description":   1.0,
  "simple narration":     1.3,
  "factual report":       2.0,
  "narrative":            2.2,
  "conversation":         2.0,
  "instructional":        2.5,
  "opinion/editorial":    3.2,
  "analytical commentary":3.8,
  "argumentative":        4.0,
  "argumentative essay":  4.3,
  "analytical":           3.7,
};

function discourseOrgBase(discourseType) {
  const key = (discourseType || "").toLowerCase();
  return DISCOURSE_ORG[key] ?? 2.0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reading Branch — 7 dimensions
//
// Reading is a self-paced, re-readable modality.  Complexity here comes from
// textual structure that must be parsed visually: how sentences are nested,
// how paragraphs are organized, how connectors chain ideas, and how much must
// be held across the visible page to follow an argument.
// ═══════════════════════════════════════════════════════════════════════════════

export function computeReadingBranch(signals, discourseType, passageWordCount) {
  const s = signals;
  const wc = (passageWordCount && passageWordCount > 0) ? passageWordCount : Infinity;

  // 1. Sentence/Clause Density (0–5)
  //    How densely are clauses embedded?  Embedded structure and cross-sentence
  //    dependencies force the reader to parse complex syntactic frames.
  let clauseDensity = 1.2;
  if (s.embeddedStructure)          clauseDensity += 1.5;
  if (s.crossSentenceDependency)    clauseDensity += 0.8;
  if (s.multipleSentencesConnected) clauseDensity += 0.5;
  if (s.multiparagraphArgument)     clauseDensity += 0.4;
  if (s.noConnectedSentences)       clauseDensity -= 0.8;
  if (s.shortStatements)            clauseDensity -= 0.5;
  if (s.simpleAdditiveText)         clauseDensity -= 0.3;
  clauseDensity = round1(clamp(clauseDensity, 0, 5));

  // 2. Paragraph Structure (0–5)
  //    Is there organised paragraph development?  Richer structure demands more
  //    reading skill to track the writer's hierarchical organisation of ideas.
  let paragraphStructure = 1.0;
  if (s.paragraphLevelDiscourse)    paragraphStructure += 1.2;
  if (s.multiparagraphArgument)     paragraphStructure += 1.5;
  if (s.paragraphDependency)        paragraphStructure += 1.0;
  if (s.factualReportingChain)      paragraphStructure += 0.5;
  if (s.detailIntegration)          paragraphStructure += 0.4;
  if (s.noParagraphDevelopment)     paragraphStructure -= 0.8;
  if (s.noMultiSentenceIntegration) paragraphStructure -= 0.5;
  if (s.simpleAdditiveText)         paragraphStructure -= 0.4;
  paragraphStructure = round1(clamp(paragraphStructure, 0, 5));

  // 3. Connector Load (0–5)
  //    How many logical connectors — causal, contrastive, temporal, sequential —
  //    must the reader process to follow the text's argumentative spine?
  let connectorLoad = 1.0;
  if (s.explicitRelationships)      connectorLoad += 1.2;
  if (s.chronologicalSequence)      connectorLoad += 0.8;
  if (s.factualReportingChain)      connectorLoad += 0.7;
  if (s.abstractReasoning)          connectorLoad += 0.6;
  if (s.historicalComparison)       connectorLoad += 0.5;
  if (s.layeredReasoning)           connectorLoad += 0.5;
  if (s.noConnectedSentences)       connectorLoad -= 0.5;
  if (s.simpleAdditiveText)         connectorLoad -= 0.4;
  connectorLoad = round1(clamp(connectorLoad, 0, 5));

  // 4. Reference Tracking (0–5)
  //    How much pronoun, noun-phrase, and discourse-referent tracking is required
  //    across sentences and paragraphs?
  let referenceTracking = 1.0;
  if (s.crossSentenceDependency)    referenceTracking += 1.3;
  if (s.paragraphDependency)        referenceTracking += 1.0;
  if (s.multiparagraphArgument)     referenceTracking += 0.8;
  if (s.multipleSentencesConnected) referenceTracking += 0.5;
  if (s.noConnectedSentences)       referenceTracking -= 0.8;
  if (s.isolatedFacts)              referenceTracking -= 0.5;
  referenceTracking = round1(clamp(referenceTracking, 0, 5));

  // 5. Textual Organization (0–5)
  //    How sophisticated is the genre-level organisation?  Ranges from simple
  //    description through analytical argumentation.
  let textualOrg = discourseOrgBase(discourseType);
  if (s.stanceDetection)            textualOrg = Math.min(5, textualOrg + 0.5);
  if (s.layeredReasoning)           textualOrg = Math.min(5, textualOrg + 0.6);
  if (s.isSimpleArgument)           textualOrg = Math.max(0, textualOrg - 0.5);
  textualOrg = round1(clamp(textualOrg, 0, 5));

  // 6. Visual Retrievability of Details (0–5, higher = harder to locate)
  //    Reading allows re-scanning, but when details are distributed or embedded
  //    in dense clause structure, locating them by re-reading becomes harder.
  let retrievability = 1.5;
  if (s.detailIntegration)          retrievability += 1.0;
  if (s.embeddedStructure)          retrievability += 0.8;
  if (s.multiparagraphArgument)     retrievability += 0.7;
  if (s.paragraphDependency)        retrievability += 0.5;
  if (s.crossSentenceDependency)    retrievability += 0.4;
  if (s.isolatedFacts)              retrievability -= 0.8;
  if (s.noConnectedSentences)       retrievability -= 0.6;
  if (s.shortStatements)            retrievability -= 0.4;
  retrievability = round1(clamp(retrievability, 0, 5));

  // 7. Paragraph Integration Demand (0–5)
  //    How much must the reader integrate across paragraph and text boundaries
  //    to construct a unified understanding?
  let integrationDemand = 0.8;
  if (s.paragraphLevelDiscourse)    integrationDemand += 1.0;
  if (s.detailIntegration)          integrationDemand += 0.8;
  if (s.multiparagraphArgument)     integrationDemand += 1.5;
  if (s.paragraphDependency)        integrationDemand += 1.2;
  if (s.layeredReasoning)           integrationDemand += 0.7;
  if (s.noConnectedSentences)       integrationDemand -= 0.6;
  if (s.isolatedFacts)              integrationDemand -= 0.4;
  integrationDemand = round1(clamp(integrationDemand, 0, 5));

  // ── Short-passage dampening ───────────────────────────────────────────────
  // Passages shorter than 120 words cannot reliably sustain the discourse
  // patterns that produce high scores for complexity, cohesion, or abstraction.
  // Apply the same two-tier logic used in scoringEngine / rubricEngine so that
  // all evidence panels stay internally consistent with the final ILR level.
  if (wc < 120) {
    clauseDensity     = round1(Math.min(clauseDensity     * 0.75, 3.5));
    integrationDemand = round1(Math.min(integrationDemand * 0.70, 3.6));
    textualOrg        = round1(Math.min(textualOrg        * 0.65, 3.4));
    connectorLoad     = round1(Math.min(connectorLoad,            3.5));
    referenceTracking = round1(Math.min(referenceTracking,        3.5));
  }
  if (wc < 70) {
    clauseDensity     = round1(Math.min(clauseDensity     * 0.90, 3.2));
    integrationDemand = round1(Math.min(integrationDemand * 0.85, 3.3));
    textualOrg        = round1(Math.min(textualOrg        * 0.85, 3.0));
  }

  return [
    {
      key: "clauseDensity",
      label: "Sentence / Clause Density",
      score: clauseDensity,
      level: levelLabel(clauseDensity),
      description: "Complexity of embedded clauses and syntactic nesting within sentences.",
    },
    {
      key: "paragraphStructure",
      label: "Paragraph Structure",
      score: paragraphStructure,
      level: levelLabel(paragraphStructure),
      description: "Degree of organised paragraph development and hierarchical text organisation.",
    },
    {
      key: "connectorLoad",
      label: "Connector Load",
      score: connectorLoad,
      level: levelLabel(connectorLoad),
      description: "Density of logical connectors (causal, contrastive, temporal) the reader must process.",
    },
    {
      key: "referenceTracking",
      label: "Reference Tracking",
      score: referenceTracking,
      level: levelLabel(referenceTracking),
      description: "Demand to track pronoun chains, noun references, and co-referential expressions across sentences.",
    },
    {
      key: "textualOrganization",
      label: "Textual Organisation",
      score: textualOrg,
      level: levelLabel(textualOrg),
      description: "Complexity of the overall genre-level structure, from simple description to sustained argumentation.",
    },
    {
      key: "visualRetrievability",
      label: "Visual Retrievability",
      score: retrievability,
      level: levelLabel(retrievability),
      description: "Difficulty of re-scanning to locate specific details; higher when details are embedded or distributed across paragraphs.",
    },
    {
      key: "integrationDemand",
      label: "Paragraph Integration Demand",
      score: integrationDemand,
      level: levelLabel(integrationDemand),
      description: "Requirement to integrate ideas across paragraph and text-level boundaries to construct a unified meaning.",
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Listening Branch — 8 dimensions
//
// Listening is a time-bound, non-revisable modality.  Complexity here comes
// from auditory processing constraints: speech is transient, re-listening is
// impossible, speaker overlap creates identity-tracking demands, and memory
// must compensate for the absence of visual support.
// ═══════════════════════════════════════════════════════════════════════════════

export function computeListeningBranch(signals, modelResult) {
  const s           = signals;
  const lsDelivery  = ((modelResult || {}).lsDelivery  || "natural").toLowerCase();
  const lsSpeechRate= ((modelResult || {}).lsSpeechRate || "moderate").toLowerCase();
  const lsRedundancy= ((modelResult || {}).lsRedundancy || "medium").toLowerCase();
  const discType    = ((modelResult || {}).discourseType || "").toLowerCase();

  // 1. Speech Rate (0–5)
  //    Faster delivery leaves less processing time per utterance.
  const speechRateScore = { slow: 0.8, moderate: 2.0, natural: 3.0, fast: 4.5 }[lsSpeechRate] ?? 2.5;

  // 2. Delivery Clarity (0–5, higher = harder)
  //    Dense or unclear delivery makes it harder to segment and identify meaning.
  const deliveryScore = { clear: 0.8, natural: 2.5, dense: 4.5 }[lsDelivery] ?? 2.5;

  // 3. Number of Speakers / Speaker Load (0–5)
  //    Multiple-speaker discourse requires simultaneous tracking of voices,
  //    turn-taking, and identity maintenance under real-time conditions.
  let speakerLoad = 1.5;
  if (discType.includes("conversation") || discType.includes("dialogue") ||
      discType.includes("interview")    || discType.includes("discussion")) {
    speakerLoad = 3.5;
  } else if (discType.includes("lecture") || discType.includes("monologue")) {
    speakerLoad = 1.5;
  }
  if (lsDelivery === "dense")       speakerLoad = Math.min(5, speakerLoad + 0.5);
  speakerLoad = round1(clamp(speakerLoad, 0, 5));

  // 4. Segmentation Difficulty (0–5)
  //    How hard is it to identify where utterances, clauses, and idea units
  //    begin and end?  Fast rate and dense delivery compound this.
  let segmentation = 1.0;
  if (lsSpeechRate === "fast")      segmentation += 1.5;
  else if (lsSpeechRate === "natural") segmentation += 0.8;
  if (lsDelivery === "dense")       segmentation += 1.2;
  if (s.embeddedStructure)          segmentation += 0.8;
  if (s.noConnectedSentences)       segmentation -= 0.5;
  if (lsSpeechRate === "slow")      segmentation -= 0.5;
  segmentation = round1(clamp(segmentation, 0, 5));

  // 5. Redundancy & Support (0–5, higher = less support = harder)
  //    When redundancy is low, key information is stated only once; missing it
  //    cannot be compensated by re-hearing a paraphrased version.
  const redundancyScore = { high: 0.5, medium: 2.0, low: 4.0 }[lsRedundancy] ?? 2.0;

  // 6. Transient Processing Demand (0–5)
  //    Processing demand arising from the irreversible nature of speech: content
  //    is heard once and immediately lost.  Combines delivery pace, redundancy,
  //    and cognitive complexity of the material.
  let transientDemand = 1.0;
  if (lsSpeechRate === "fast")           transientDemand += 1.2;
  else if (lsSpeechRate === "natural")   transientDemand += 0.6;
  if (lsRedundancy === "low")            transientDemand += 1.0;
  if (s.paragraphLevelDiscourse || s.detailIntegration) transientDemand += 0.8;
  if (s.embeddedStructure)               transientDemand += 0.7;
  if (lsRedundancy === "high")           transientDemand -= 0.5;
  if (lsSpeechRate === "slow")           transientDemand -= 0.5;
  transientDemand = round1(clamp(transientDemand, 0, 5));

  // 7. Memory Load (0–5)
  //    Working memory burden when no written text can be revisited.  Long
  //    argument chains, multi-paragraph dependency, and heavy inference each
  //    increase the amount the listener must actively hold in memory.
  let memoryLoad = 1.0;
  if (s.multiparagraphArgument)     memoryLoad += 1.5;
  if (s.paragraphDependency)        memoryLoad += 1.2;
  if (s.detailIntegration)          memoryLoad += 0.8;
  if (s.heavyInference)             memoryLoad += 0.7;
  if (s.multipleDistinctIdeas)      memoryLoad += 0.5;
  if (lsRedundancy === "low")       memoryLoad += 0.5;
  if (s.noConnectedSentences || s.shortStatements) memoryLoad -= 0.5;
  if (lsRedundancy === "high")      memoryLoad -= 0.4;
  memoryLoad = round1(clamp(memoryLoad, 0, 5));

  // 8. Recovery from Missed Information (0–5, higher = harder to recover)
  //    When a segment is missed (blink, distraction, unfamiliar word), can the
  //    listener catch up?  High redundancy and slow rate aid recovery; fast
  //    rate and paragraph-level dependencies make it very difficult.
  let recoveryDifficulty = 1.0;
  if (lsRedundancy === "low")       recoveryDifficulty += 1.5;
  if (lsSpeechRate === "fast")      recoveryDifficulty += 1.0;
  if (s.paragraphDependency)        recoveryDifficulty += 0.8;
  if (s.detailIntegration)          recoveryDifficulty += 0.5;
  if (lsRedundancy === "high")      recoveryDifficulty -= 0.8;
  if (lsSpeechRate === "slow")      recoveryDifficulty -= 0.5;
  recoveryDifficulty = round1(clamp(recoveryDifficulty, 0, 5));

  const rateLabel   = { slow: "Slow", moderate: "Moderate", natural: "Natural", fast: "Fast" }[lsSpeechRate] ?? "Moderate";
  const delivLabel  = { clear: "Clear", natural: "Natural", dense: "Dense" }[lsDelivery] ?? "Natural";
  const redLabel    = { high: "High", medium: "Medium", low: "Low" }[lsRedundancy] ?? "Medium";

  return [
    {
      key: "speechRate",
      label: "Speech Rate",
      score: round1(speechRateScore),
      level: levelLabel(speechRateScore),
      description: `Delivery speed: ${rateLabel}. Faster speech compresses processing time and increases real-time demands.`,
    },
    {
      key: "deliveryClarity",
      label: "Delivery Clarity",
      score: round1(deliveryScore),
      level: levelLabel(deliveryScore),
      description: `Delivery style: ${delivLabel}. Dense or unclear delivery raises the listener's parsing burden significantly.`,
    },
    {
      key: "speakerLoad",
      label: "Number of Speakers",
      score: speakerLoad,
      level: levelLabel(speakerLoad),
      description: "Tracking multiple voices and turn-taking adds simultaneous segmentation and speaker-identity demands.",
    },
    {
      key: "segmentation",
      label: "Segmentation Difficulty",
      score: segmentation,
      level: levelLabel(segmentation),
      description: "How difficult it is to identify where utterances and idea units begin and end in the spoken stream.",
    },
    {
      key: "redundancy",
      label: "Redundancy & Support",
      score: round1(redundancyScore),
      level: levelLabel(redundancyScore),
      description: `Redundancy level: ${redLabel}. Low redundancy means key information is stated only once with no paraphrase support.`,
    },
    {
      key: "transientDemand",
      label: "Transient Processing Demand",
      score: transientDemand,
      level: levelLabel(transientDemand),
      description: "Processing burden arising from the irreversible nature of speech: material heard once cannot be reviewed.",
    },
    {
      key: "memoryLoad",
      label: "Memory Load",
      score: memoryLoad,
      level: levelLabel(memoryLoad),
      description: "Working memory demand for holding and linking ideas across the spoken sample without visual support.",
    },
    {
      key: "recoveryAbility",
      label: "Recovery from Missed Information",
      score: recoveryDifficulty,
      level: levelLabel(recoveryDifficulty),
      description: "How difficult it is to regain comprehension after missing a segment — harder with fast delivery and low redundancy.",
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-Modality Comparison
//
// Estimates how the same material would likely rate in the OTHER modality
// and generates a single teacher-facing comparison sentence.
//
// Rules:
//   Reading → Listening estimate:
//     Heavy inference + implicit meaning → listening is harder (+1 level)
//     Dense paragraph dependency + multi-paragraph → listening harder (+0.5→+1)
//     Simple, self-contained discourse → same level or slightly easier
//
//   Listening → Reading estimate:
//     High redundancy → reading is easier (redundancy doesn't help in print) (−1)
//     Fast delivery → no reading penalty (–0.5)
//     Dense inference content → same complexity in both modalities
// ═══════════════════════════════════════════════════════════════════════════════

export function buildCrossModalityNote(finalLevel, signals, modelResult, mode) {
  const s           = signals;
  const lsSpeechRate= ((modelResult || {}).lsSpeechRate || "moderate").toLowerCase();
  const lsRedundancy= ((modelResult || {}).lsRedundancy || "medium").toLowerCase();

  const idx = LEVELS.indexOf(finalLevel);
  if (idx < 0) return null;

  const otherMode = mode === "reading" ? "listening" : "reading";

  if (mode === "reading") {
    // ── Reading → Listening estimate ─────────────────────────────
    let raw = 0;

    // Dense inference content forces more active real-time construction
    if (s.heavyInference || s.implicitMeaning)           raw += 1;
    else if (s.significantInference || s.moderateInference) raw += 0.5;

    // Multi-paragraph integration without visual support is much harder
    if (s.multiparagraphArgument && s.paragraphDependency) raw += 0.5;

    // Abstract vocabulary without visual scanning → harder in listening
    if (s.conceptualVocabulary && s.abstractReasoning)   raw += 0.5;

    // Simple/disconnected discourse is not harder in listening
    if (s.noConnectedSentences || s.isolatedFacts || s.shortStatements) raw -= 0.5;
    if (s.simpleAdditiveText || s.simpleDescriptionPattern)             raw -= 0.3;

    const adjSteps  = Math.round(raw);
    const newIdx    = Math.max(0, Math.min(LEVELS.length - 1, idx + adjSteps));
    const otherLevel = LEVELS[newIdx];
    const same      = otherLevel === finalLevel;

    let note;
    if (same) {
      note = `This passage is rated ILR ${finalLevel} for reading. As listening material, the comprehension demand would likely remain at a similar level — the discourse complexity translates to spoken form without a significant shift in difficulty.`;
    } else if (newIdx > idx) {
      note = `This passage is rated ILR ${finalLevel} for reading. As listening material, it would likely function closer to ILR ${otherLevel} — real-time processing, working memory load, and the inability to re-read or re-scan increase the comprehension demand beyond what the written text alone requires.`;
    } else {
      note = `This passage is rated ILR ${finalLevel} for reading. As listening material, it would likely function closer to ILR ${otherLevel} — the simplified syntax and self-contained sentence structure reduce comprehension demands when the text is presented in spoken form.`;
    }

    return {
      note,
      currentMode:         "reading",
      otherMode:           "listening",
      currentLevel:        finalLevel,
      estimatedOtherLevel: otherLevel,
      isSameLevel:         same,
      direction:           newIdx > idx ? "harder" : newIdx < idx ? "easier" : "same",
    };

  } else {
    // ── Listening → Reading estimate ─────────────────────────────
    let raw = 0;

    // High redundancy helps in listening but not in reading
    if (lsRedundancy === "high")  raw -= 0.5;

    // Fast delivery is only a listening difficulty; reading removes this
    if (lsSpeechRate === "fast")  raw -= 0.5;

    // Content with heavy inference is equally hard in both modalities
    // (no adjustment for inference-heavy material)

    // Simple disconnected content is easy in both modalities
    if (s.noConnectedSentences || s.isolatedFacts) raw -= 0.3;

    const adjSteps   = Math.round(raw);
    const newIdx     = Math.max(0, Math.min(LEVELS.length - 1, idx + adjSteps));
    const otherLevel = LEVELS[newIdx];
    const same       = otherLevel === finalLevel;

    let note;
    if (same) {
      note = `This sample is rated ILR ${finalLevel} for listening. As reading material, the comprehension demand would likely remain at a similar level — the content's meaning demands translate directly to written form without a significant change in difficulty.`;
    } else if (newIdx < idx) {
      note = `This sample is rated ILR ${finalLevel} for listening. As reading material, it would likely function closer to ILR ${otherLevel} — features such as delivery pace and spoken redundancy that increase listening burden are absent in written form, making the text easier to process at your own pace.`;
    } else {
      note = `This sample is rated ILR ${finalLevel} for listening. As reading material, it would likely function closer to ILR ${otherLevel} — the written form adds structural complexity demands that the spoken delivery partially offsets through prosody and pacing.`;
    }

    return {
      note,
      currentMode:         "listening",
      otherMode:           "reading",
      currentLevel:        finalLevel,
      estimatedOtherLevel: otherLevel,
      isSameLevel:         same,
      direction:           newIdx > idx ? "harder" : newIdx < idx ? "easier" : "same",
    };
  }
}

// ── Auto-detect helper (server-side text heuristic) ──────────────────────────
//
// Examines raw text for spoken-language markers to choose the analysis branch
// when the user selects "Auto-detect" mode.  Returns "reading" or "listening".
// Used by server.js only; not part of the scoring engine.

export function detectModeFromText(text) {
  if (!text || typeof text !== "string") return "reading";

  // Speaker labels: "Speaker 1:", "Host:", "[Host]:", "Q:", "A:"
  if (/^(Speaker\s*\d+|Host|Interviewer|Interviewee|Moderator|Narrator|Q|A)\s*:/m.test(text)) {
    return "listening";
  }
  // Bracketed speaker labels: [John] or [0:32]
  if (/^\[.{1,30}\]/m.test(text)) return "listening";

  // Timestamps: (0:32) or [1:04:30]
  if (/\[\d{1,2}:\d{2}(:\d{2})?\]|\(\d{1,2}:\d{2}(:\d{2})?\)/m.test(text)) return "listening";

  // Spoken filler words in short samples (under 500 chars is likely spoken)
  if (text.length < 500 && /\b(um+|uh+|like,|you know|I mean|sort of|kind of)\b/i.test(text)) {
    return "listening";
  }

  // Well-formed paragraphs (blank line between blocks) → reading
  if (/\n\n/.test(text)) return "reading";

  return "reading"; // safe default
}
