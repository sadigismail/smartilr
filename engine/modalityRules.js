// ─────────────────────────────────────────────────────────────────────────────
// engine/modalityRules.js
//
// Ceiling and floor enforcement that depends on the evaluation modality
// (reading vs. listening).
//
// Reading ceilings: factual ceiling, ILR 0+ ceiling, ILR 1 ceiling.
// Listening ceilings: four ceiling rules (factual structure × delivery × inference).
// Listening floors: three floor rules (extended+analytical+significant→ILR 3, analytical→ILR 2+, extended+significant→ILR 2+).
// ─────────────────────────────────────────────────────────────────────────────

import { FACTUAL_DISCOURSE_TYPES, FACTUAL_CEILING } from "../config/scoringConfig.js";
import { LEVEL_CAPS } from "../config/gateConfig.js";
import { LISTENING_CEILING_LABELS, LISTENING_FLOOR_LABELS } from "../config/explanationConfig.js";

import {
  levelIndex,
  normalizeSignals,
  isShortDisconnectedOnly,
  isShortConnectedOnly,
  meetsIlr2Conditions,
  meetsIlr2PlusConditions,
} from "./ilrRules.js";

// ── Reading ceiling rules ─────────────────────────────────────────────────────
//
// Returns { finalLevel, ceilingApplied, ceilingLabel, ceilingReason }.
// Applies rules in order; the first matching ceiling wins.

export function applyReadingCeilings(finalLevel, discourseType, signals) {
  const s = normalizeSignals(signals);
  const inferenceDemandLow = !s.moderateInference && !s.significantInference && !s.heavyInference;
  const abstractionNone    = !s.abstractReasoning;

  // ── Ceiling R1: factual report + low inference + no abstraction → max ILR 2 ──
  if (
    discourseType === "factual report" &&
    inferenceDemandLow &&
    abstractionNone &&
    levelIndex(finalLevel) > levelIndex(FACTUAL_CEILING)
  ) {
    return {
      finalLevel: FACTUAL_CEILING,
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R1",
      ceilingReason:
        "The passage presents a factual report with no inference demand and no abstraction. Comprehension requires identifying explicitly stated main ideas and supporting details; the reader is not required to construct implied meaning, evaluate authorial stance, or integrate abstract reasoning across the passage. Maximum level is ILR 2.",
    };
  }

  // ── Ceiling R2: any factual discourse type → max ILR 2 ───────────────────
  if (
    FACTUAL_DISCOURSE_TYPES.includes(discourseType) &&
    levelIndex(finalLevel) > levelIndex(FACTUAL_CEILING)
  ) {
    return {
      finalLevel: FACTUAL_CEILING,
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R2",
      ceilingReason:
        "The passage belongs to a factual or explicitly structured discourse type. Content is conveyed through direct statement rather than implication, and comprehension does not require sustained paragraph-level inference or interpretive reasoning beyond the explicitly stated main idea and supporting details. Maximum level is ILR 2.",
    };
  }

  // ── Ceiling R3: recognition-only material → max ILR 0+ ───────────────────
  if (s.noConnectedSentences && levelIndex(finalLevel) > levelIndex("0+")) {
    return {
      finalLevel: "0+",
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R3",
      ceilingReason:
        "Comprehension is limited to recognition of isolated letters, names, numbers, words, or memorized phrases. No connected discourse is present, and the material does not require the reader to integrate meaning across sentence boundaries or construct discourse-level understanding. Maximum level is ILR 0+.",
    };
  }

  // ── Ceiling R4: short disconnected sentences → max ILR 1 ─────────────────
  if (isShortDisconnectedOnly(s) && levelIndex(finalLevel) > levelIndex("1")) {
    return {
      finalLevel: "1",
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R4",
      ceilingReason:
        "The passage consists of short, disconnected sentences presenting explicit information in isolation. No cross-sentence integration signals are present; each sentence can be processed independently, and comprehension does not require tracking discourse relationships or integrating information across sentence boundaries. Maximum level is ILR 1.",
    };
  }

  // ── Ceiling R4a: functional / additive text → max ILR 1 ─────────────────
  // The passage is a simple functional notice, announcement, job ad, school
  // message, or public information text.  Any additional clauses are routine
  // additive details (phone numbers, contact instructions, dates, addresses,
  // application steps, office hours, prices) that do NOT require the reader to
  // hold or integrate information from one sentence to another.  Longer length
  // or the presence of a second clause alone cannot upgrade this to ILR 1+.
  //
  // Only fires when: no paragraph-level integration signals, no inference
  // demand, and the level was pushed above ILR 1.
  if (
    LEVEL_CAPS.ENABLE_FUNCTIONAL_TEXT_CAP &&
    s.simpleAdditiveText &&
    !s.paragraphLevelDiscourse &&
    !s.factualReportingChain &&
    !s.chronologicalSequence &&
    !s.explicitRelationships &&
    !s.detailIntegration &&
    !s.moderateInference &&
    !s.significantInference &&
    !s.heavyInference &&
    levelIndex(finalLevel) > levelIndex("1")
  ) {
    return {
      finalLevel: "1",
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R4a",
      ceilingReason:
        "The passage is a functional or public information text — a practical notice, " +
        "announcement, job posting, school message, or similar format — in which any " +
        "additional clauses constitute routine additive detail such as contact " +
        "information, dates, prices, application steps, or office hours. Each element " +
        "conveys a discrete, independently interpretable fact; the reader is not " +
        "required to hold information from one sentence to interpret another. Sentence " +
        "length or the presence of additional clauses does not independently elevate " +
        "the comprehension requirement to ILR 1+. For the rating to reach ILR 1+, " +
        "the passage must contain sentences that are genuinely connected — where " +
        "understanding one sentence depends on information conveyed in a prior " +
        "sentence, or where the reader must track a discourse relationship such as " +
        "cause and effect, condition and action, or description and elaboration " +
        "across sentence boundaries. Maximum level is ILR 1.",
    };
  }

  // ── Ceiling R13: simple narration without full paragraph development → max ILR 1+ ──
  //
  // "Simple narration" describes what happened, but does not develop ideas
  // across a paragraph.  The DEFAULT ceiling for this discourse type is ILR 1+.
  // ILR 2 is only warranted when ALL four conditions are met simultaneously:
  //   1. Multiple distinct events (not a single event explained)
  //   2. Paragraph-level discourse (sentences build a shared paragraph idea)
  //   3. Detail integration or factual reporting chain (explanation across sentences)
  //   4. Multiple distinct ideas (supporting information developed together)
  //
  // If any of these four conditions is absent, the passage is ILR 1+ at most.
  // This ceiling applies before R5/R6 and overrides any floor gate that produced
  // an ILR 2 floor from chronological sequence or connected sentences alone.
  if (
    discourseType === "simple narration" &&
    levelIndex(finalLevel) > levelIndex("1+")
  ) {
    const allowsIlr2 =
      !s.singleEventExplained        &&   // multiple events (not just one)
      s.paragraphLevelDiscourse       &&   // paragraph-level development present
      (s.detailIntegration || s.factualReportingChain) &&  // explanation across sentences
      s.multipleDistinctIdeas;             // supporting information developed

    if (!allowsIlr2) {
      return {
        finalLevel: "1+",
        ceilingApplied: true,
        ceilingLabel: "READING-CEILING-R13",
        ceilingReason:
          "The passage is classified as simple narration. Simple narration has a " +
          "default ceiling of ILR 1+ unless all four development conditions are " +
          "simultaneously present: (1) multiple distinct events rather than a single " +
          "event, (2) paragraph-level discourse in which sentences build a shared " +
          "idea, (3) detail integration or a factual reporting chain providing " +
          "explanation across sentences, and (4) multiple distinct supporting ideas " +
          "developed together. At least one of these conditions is absent in this " +
          "passage; simple narration without full paragraph development does not " +
          "reach ILR 2. Maximum level is ILR 1+.",
      };
    }
  }

  // ── Ceiling R11: single sentence → max ILR 1+ ────────────────────────────
  //
  // The entire passage is a single sentence.  Even with complex subordinate
  // clauses, embedded phrases, or explicit causal/temporal relationships, a
  // single sentence cannot produce paragraph-level integration across multiple
  // sentences.  Comprehension is capped at ILR 1+ regardless of syntactic
  // complexity or inference signals within the sentence.
  if (s.singleSentence && levelIndex(finalLevel) > levelIndex("1+")) {
    return {
      finalLevel: "1+",
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R11",
      ceilingReason:
        "The passage consists of a single sentence. Paragraph-level integration — " +
        "the defining characteristic of ILR 2 comprehension — requires the reader " +
        "to track and integrate meaning across multiple sentences. A single sentence, " +
        "however complex its clause structure, cannot produce that cross-sentence " +
        "integration demand. Subordinate clauses, causal connectives, and embedded " +
        "phrases within one sentence constitute sentence-level, not paragraph-level, " +
        "processing. Maximum level is ILR 1+.",
    };
  }

  // ── Ceiling R12: single event explained, no multiple distinct ideas → max ILR 1+ ──
  //
  // The passage narrates or explains a single event, action, or proposition
  // without developing multiple distinct supporting ideas.  Short narration,
  // single event explanation, and simple cause-effect descriptions cannot
  // satisfy ILR 2's requirement for multi-idea discourse development across
  // a paragraph, regardless of inference level.
  if (
    s.singleEventExplained &&
    !s.multipleDistinctIdeas &&
    levelIndex(finalLevel) > levelIndex("1+")
  ) {
    return {
      finalLevel: "1+",
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R12",
      ceilingReason:
        "The passage describes or explains a single event, action, or proposition " +
        "without developing multiple distinct supporting ideas. ILR 2 requires the " +
        "reader to integrate a main idea with multiple supporting details distributed " +
        "across a paragraph — a discourse structure that short narration or single-event " +
        "explanation inherently cannot provide. Simple cause-effect relationships, " +
        "short event descriptions, and single-proposition explanations do not reach " +
        "the paragraph-level integration demand of ILR 2. Maximum level is ILR 1+.",
    };
  }

  // ── Ceiling R5: short connected discourse only → max ILR 1+ ──────────────
  // The passage has sentence-to-sentence links but no paragraph-level
  // integration.  The reader tracks short connections but does not integrate
  // information across a full paragraph.  Cannot exceed ILR 1+.
  if (
    LEVEL_CAPS.ENABLE_1PLUS_SHORTCONNECTED_CAP &&
    isShortConnectedOnly(s) &&
    levelIndex(finalLevel) > levelIndex("1+")
  ) {
    return {
      finalLevel: "1+",
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R5",
      ceilingReason:
        "The passage contains sentence-to-sentence connections but does not require integration of information across a full paragraph. The reader must track short discourse relationships between adjacent sentences; however, comprehension does not require holding a main idea in working memory and integrating it with supporting detail distributed across a paragraph. Maximum level is ILR 1+.",
    };
  }

  // ── Ceiling R6: paragraph integration present but ILR 2 gate not met → max ILR 1+ ──
  // The passage triggered a paragraph-level floor but does not satisfy the
  // FULL ILR 2 entry conditions (discourse relationship + integration signal
  // together, or any inference level).  Cap at ILR 1+.
  if (
    LEVEL_CAPS.ENABLE_2_GATE_CAP &&
    !meetsIlr2Conditions(s) &&
    levelIndex(finalLevel) > levelIndex("1+")
  ) {
    return {
      finalLevel: "1+",
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R6",
      ceilingReason:
        "Paragraph-level integration signals are present in the passage, but the full conditions for ILR 2 are not met. Comprehension requires some cross-sentence processing, but does not require the full combination of discourse relationship tracking, main-idea integration with supporting detail, and at least minimal inference that characterises ILR 2 comprehension. Maximum level is ILR 1+.",
    };
  }

  // ── Ceiling R7: ILR 2 conditions met but ILR 2+ criteria absent → max ILR 2 ──
  // The passage reaches ILR 2 but does not show the interpretive demand needed
  // for ILR 2+: no significant/heavy inference, no stance-with-abstraction,
  // no sustained multi-paragraph reasoning with abstraction.  Cap at ILR 2.
  if (
    LEVEL_CAPS.ENABLE_2_CAP &&
    meetsIlr2Conditions(s) &&
    !meetsIlr2PlusConditions(s) &&
    levelIndex(finalLevel) > levelIndex("2")
  ) {
    return {
      finalLevel: "2",
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R7",
      ceilingReason:
        "The passage meets ILR 2 comprehension conditions but does not generate the interpretive demands required for ILR 2+. Comprehension does not require sustained multi-paragraph inference, evaluation of authorial stance or viewpoint, or integration of abstract reasoning with supporting evidence. The reader processes explicitly stated main ideas and supporting details without being required to construct heavily implied meaning or evaluate competing perspectives. Maximum level is ILR 2.",
    };
  }

  // ── Ceiling R9: isExplanatoryText → max ILR 2+ ───────────────────────────
  //
  // Explanatory text — structured, organized writing whose primary function is
  // to help the reader understand — cannot reach ILR 3.  This ceiling applies
  // regardless of how abstract, multi-paragraph, sophisticated, or analytically
  // dense the explanation is.  Well-written analytical essays, structured policy
  // analysis, comparative analysis, organized academic argument, and editorial
  // commentary with explicit argument structure are ALL explanatory text.
  //
  // Toggled by LEVEL_CAPS.ENABLE_3_EXPLANATORY_CAP (default true).
  if (
    LEVEL_CAPS.ENABLE_3_EXPLANATORY_CAP &&
    s.isExplanatoryText &&
    levelIndex(finalLevel) > levelIndex("2+")
  ) {
    return {
      finalLevel: "2+",
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R9",
      ceilingReason:
        "The passage functions primarily as explanatory writing: it presents information, " +
        "arguments, or analysis in an organized, clear way to promote understanding. " +
        "ILR 3 is reserved for discourse in which meaning is systematically withheld, " +
        "layered, and embedded — not for structured explanatory text, however abstract " +
        "or analytically sophisticated. Well-organized analytical essays, structured " +
        "policy analysis, comparative analysis, and editorial commentary with explicit " +
        "argument structure all fall under explanatory text and cannot exceed ILR 2+. " +
        "Maximum level is ILR 2+.",
    };
  }

  // ── Ceiling R10: isSimpleArgument → max ILR 2+ ───────────────────────────
  //
  // A simple argument — one in which the main claim, supporting evidence, and
  // conclusion are all explicitly stated and the logical structure is transparent
  // — cannot reach ILR 3.  The topic or vocabulary may be sophisticated; what
  // matters is whether the argument architecture is explicit and accessible.
  //
  // Toggled by LEVEL_CAPS.ENABLE_3_EXPLANATORY_CAP (shared toggle, default true).
  if (
    LEVEL_CAPS.ENABLE_3_EXPLANATORY_CAP &&
    s.isSimpleArgument &&
    levelIndex(finalLevel) > levelIndex("2+")
  ) {
    return {
      finalLevel: "2+",
      ceilingApplied: true,
      ceilingLabel: "READING-CEILING-R10",
      ceilingReason:
        "The passage presents a clear, explicit argument in which the main claim, " +
        "supporting evidence, and conclusion are all stated or easily identifiable. " +
        "ILR 3 requires layered non-linear reasoning and implicit meaning construction " +
        "that goes substantially beyond what the text states. A transparent, well-organized " +
        "argument — even on an abstract or complex topic — does not satisfy ILR 3 " +
        "requirements. Maximum level is ILR 2+.",
    };
  }

  // ── Ceiling R8: single-paragraph OR low inference+abstraction → max ILR 2+ ──
  //
  // ILR 3 requires extended multi-paragraph discourse with sustained abstract
  // reasoning AND heavy inference simultaneously.  A passage that lacks
  // multi-paragraph structure, or that does not combine heavy inference with
  // abstraction, cannot meet those requirements and is capped at ILR 2+.
  //
  // Fires when the proposed level is above ILR 2+ AND either:
  //   (a) the text has no multi-paragraph argument and no paragraph-to-paragraph
  //       dependency (i.e. it is effectively a single paragraph), OR
  //   (b) the text lacks both heavy inference AND abstract reasoning
  //       (inference < high AND abstraction < high).
  if (
    LEVEL_CAPS.ENABLE_3_SINGLE_PARA_CAP &&
    levelIndex(finalLevel) > levelIndex("2+")
  ) {
    const isLimitedToOneParagraph    = !s.multiparagraphArgument && !s.paragraphDependency;
    const hasLowInferenceAndAbstraction = !s.heavyInference && !s.abstractReasoning;

    if (isLimitedToOneParagraph) {
      return {
        finalLevel: "2+",
        ceilingApplied: true,
        ceilingLabel: "READING-CEILING-R8a",
        ceilingReason:
          "ILR 3 requires extended multi-paragraph discourse in which argument or " +
          "reasoning is explicitly developed across more than one paragraph and " +
          "comprehension requires integrating meaning across paragraph boundaries. " +
          "This passage does not contain multi-paragraph argument structure or " +
          "paragraph-to-paragraph dependency; comprehension is contained within a " +
          "single paragraph or dense block, regardless of length. " +
          "Maximum level is ILR 2+.",
      };
    }

    if (hasLowInferenceAndAbstraction) {
      return {
        finalLevel: "2+",
        ceilingApplied: true,
        ceilingLabel: "READING-CEILING-R8b",
        ceilingReason:
          "ILR 3 requires heavy multi-layer inference and sustained abstract " +
          "conceptual reasoning to be present simultaneously. This passage does " +
          "not require heavy inference — the reader can construct the main idea " +
          "and supporting details without going substantially beyond what is " +
          "explicitly stated — and does not require sustained abstract reasoning. " +
          "Clear linear or moderately abstract reasoning with less than heavy " +
          "inference demand does not satisfy ILR 3 requirements. " +
          "Maximum level is ILR 2+.",
      };
    }
  }

  return {
    finalLevel,
    ceilingApplied: false,
    ceilingLabel: null,
    ceilingReason: null,
  };
}

// ── Listening ceiling and floor rules ────────────────────────────────────────
//
// Returns {
//   finalLevel, ceilingApplied, ceilingLabel, ceilingReason,
//   listeningFloorApplied, listeningFloorLabel, listeningFloorReason
// }.
//
// Ceiling rules are evaluated first (in order); the first match wins.
// Floor rules are evaluated after ceilings; the first match wins.

export function applyListeningRules(finalLevel, modelResult) {
  const lsStructure       = (modelResult.lsStructure       || "").toLowerCase().trim();
  const lsInference       = (modelResult.lsInference       || "").toLowerCase().trim();
  const lsDelivery        = (modelResult.lsDelivery        || "").toLowerCase().trim();
  const lsDiscourseLength = (modelResult.lsDiscourseLength || "").toLowerCase().trim();
  const lsRedundancy      = (modelResult.lsRedundancy      || "").toLowerCase().trim();
  const discourseType     = (modelResult.discourseType     || "").toLowerCase().trim();

  // Derived: news broadcast / political / institutional reporting
  // Matches "news broadcast", "news report", "news", etc.
  const isNewsBroadcast = discourseType.includes("news");

  const _inputLevel = finalLevel;

  let result = {
    finalLevel,
    ceilingApplied: false,
    ceilingLabel: null,
    ceilingReason: null,
    listeningFloorApplied: false,
    listeningFloorLabel: null,
    listeningFloorReason: null,
    // ── Debug trace ─────────────────────────────────────────────────────────
    _debug: {
      lsDiscourseLength_raw:  modelResult.lsDiscourseLength ?? null,
      lsDiscourseLength_used: lsDiscourseLength,
      lsInference_raw:        modelResult.lsInference ?? null,
      lsInference_used:       lsInference,
      lsStructure_used:       lsStructure,
      levelIn:                _inputLevel,
      CEILING_4_FIRED:        false,
      CEILING_8_FIRED:        false,
      CEILING_1_FIRED:        false,
      CEILING_2_FIRED:        false,
      CEILING_3_FIRED:        false,
      CEILING_5_FIRED:        false,
      CEILING_6_FIRED:        false,
      CEILING_7_FIRED:        false,
      FLOOR_A_FIRED:          false,
      FLOOR_B_FIRED:          false,
      FLOOR_C_FIRED:          false,
      levelOut:               finalLevel,
    },
  };

  // ── CEILING-4: short + high redundancy + no inference → max ILR 1+ ───────
  // Placed FIRST — more restrictive than CEILING-8 (caps at 1+, not 2).
  // Must run before CEILING-8 so that its early return does not block this rule.
  if (
    lsDiscourseLength === "short" &&
    lsRedundancy === "high" &&
    lsInference === "none" &&
    levelIndex(result.finalLevel) > levelIndex("1+")
  ) {
    result.finalLevel    = "1+";
    result.ceilingApplied = true;
    result.ceilingLabel  = "CEILING-4";
    result.ceilingReason = LISTENING_CEILING_LABELS["CEILING-4"];
    result._debug.CEILING_4_FIRED = true;
    result._debug.levelOut = result.finalLevel;
    return result;
  }

  // ── CEILING-8: short/paragraph discourse + non-significant inference → max ILR 2 ──
  //
  // Authoritative upper-bound guard for brief samples.  ILR 2+ requires SUSTAINED
  // analytical discourse — evaluative stance, layered reasoning, and elevated
  // inference demand maintained throughout the full sample.  A short or
  // paragraph-level sample cannot physically sustain those features regardless of
  // vocabulary complexity, topic domain, or how the model classified the discourse
  // structure.
  //
  // Gate: purely on the two prompt-constrained listening dimension fields
  //   • lsDiscourseLength ≠ "extended"   — not a sustained multi-segment sample
  //   • lsInference ≠ "significant"      — listener not building implicit conclusions
  //
  // No boolean-signal guard is used here (layeredReasoning, etc.) because those
  // flags are unreliably set for conceptually dense vocabulary in factual reports.
  // lsInference is the authoritative prompt-enforced inference rating.
  //
  // CEILING-4 runs first (above) to handle the more-restrictive 1+ cap before
  // this rule fires.  This rule must precede CEILING-3, CEILING-5, and FLOOR-A.
  if (
    lsDiscourseLength !== "extended" &&
    lsInference !== "significant" &&
    levelIndex(result.finalLevel) > levelIndex("2")
  ) {
    result.finalLevel    = "2";
    result.ceilingApplied = true;
    result.ceilingLabel  = "CEILING-8";
    result.ceilingReason =
      `The spoken sample is short or paragraph-level (lsDiscourseLength: ${lsDiscourseLength}) ` +
      `with non-significant inference demand (lsInference: ${lsInference}). ` +
      "ILR 2+ requires sustained analytical organization, evaluative stance, and elevated " +
      "inference demand maintained throughout the full discourse. A brief factual or " +
      "narrative sample cannot satisfy those criteria even when its vocabulary is " +
      "conceptually dense or the topic is institutional or complex. Maximum level is ILR 2.";
    result._debug.CEILING_8_FIRED = true;
    result._debug.levelOut = result.finalLevel;
    return result;
  }

  // ── CEILING-1: factual + no inference → max ILR 2 ────────────────────────
  if (
    lsStructure === "factual" &&
    lsInference === "none" &&
    levelIndex(finalLevel) > levelIndex("2")
  ) {
    result.finalLevel    = "2";
    result.ceilingApplied = true;
    result.ceilingLabel  = "CEILING-1";
    result.ceilingReason = LISTENING_CEILING_LABELS["CEILING-1"];
    result._debug.CEILING_1_FIRED = true;
    result._debug.levelOut = result.finalLevel;
    return result;
  }

  // ── CEILING-2: factual + clear/natural delivery + moderate inference → max ILR 2 ──
  if (
    lsStructure === "factual" &&
    lsInference === "moderate" &&
    (lsDelivery === "clear" || lsDelivery === "natural") &&
    levelIndex(finalLevel) > levelIndex("2")
  ) {
    result.finalLevel    = "2";
    result.ceilingApplied = true;
    result.ceilingLabel  = "CEILING-2";
    result.ceilingReason = LISTENING_CEILING_LABELS["CEILING-2"];
    result._debug.CEILING_2_FIRED = true;
    result._debug.levelOut = result.finalLevel;
    return result;
  }

  // ── CEILING-3: factual + moderate inference + extended discourse → max ILR 2+ ──
  // Note: short/paragraph factual+moderate is already handled by CEILING-8 above.
  // This rule only applies when lsDiscourseLength = "extended" so that a sustained
  // factual sample with moderate inference can reach 2+ but not higher.
  if (
    lsStructure === "factual" &&
    lsInference === "moderate" &&
    lsDiscourseLength === "extended" &&
    levelIndex(finalLevel) > levelIndex("2+")
  ) {
    result.finalLevel    = "2+";
    result.ceilingApplied = true;
    result.ceilingLabel  = "CEILING-3";
    result.ceilingReason = LISTENING_CEILING_LABELS["CEILING-3"];
    result._debug.CEILING_3_FIRED = true;
    result._debug.levelOut = result.finalLevel;
    return result;
  }

  // ── CEILING-5: non-analytical speech + moderate-or-no inference → max ILR 2 ──
  // Factual and narrative speech without significant or heavy inference demand
  // cannot exceed ILR 2.  CEILING-1 and CEILING-2 already cover factual+clear
  // delivery; this rule catches narrative/conversational samples and any
  // non-analytical sample that slipped through those filters.
  if (
    LEVEL_CAPS.ENABLE_LISTENING_2_CAP &&
    lsStructure !== "analytical" &&
    (lsInference === "none" || lsInference === "moderate") &&
    levelIndex(result.finalLevel) > levelIndex("2")
  ) {
    result.finalLevel    = "2";
    result.ceilingApplied = true;
    result.ceilingLabel  = "CEILING-5";
    result.ceilingReason =
      `The spoken sample presents non-analytical discourse (discourse structure: ${lsStructure}) in which comprehension requires identifying explicitly stated information and, at most, moderately implied meaning. Sustained ILR 2+ listening comprehension requires spoken discourse that is analytically organized and places significant inference demand on the listener. The structure and inference profile of this sample are not consistent with ILR 2+ assignment. Maximum level is ILR 2.`;
    result._debug.CEILING_5_FIRED = true;
    result._debug.levelOut = result.finalLevel;
    return result;
  }

  // ── CEILING-6: news broadcast + non-significant inference → max ILR 2+ ──────
  //
  // News broadcasts, political reporting, judicial news, and institutional
  // descriptions are factual discourse regardless of vocabulary complexity.
  // Political/institutional terminology (judiciary, separation of powers,
  // resignation, campaign) is concrete reference, NOT abstract reasoning.
  // Competing viewpoints quoted in a news report and procedural events narrated
  // do NOT constitute "analytical" structure or "significant" inference.
  //
  // This ceiling prevents FLOOR-C from over-promoting news broadcasts to ILR 3
  // when the model misclassifies political vocabulary as analytical abstraction.
  // Even if the model assigns lsStructure="analytical" and lsInference="significant"
  // for a news broadcast, this ceiling fires first and caps at ILR 2+.
  //
  // Guard: only fires when the discourseType is a news broadcast AND the
  // inference is NOT genuinely significant (i.e., listener does not need to
  // construct implicit conclusions, unstated causal logic, or evaluative argument).
  if (
    isNewsBroadcast &&
    lsInference !== "significant" &&
    levelIndex(result.finalLevel) > levelIndex("2+")
  ) {
    result.finalLevel    = "2+";
    result.ceilingApplied = true;
    result.ceilingLabel  = "CEILING-6";
    result.ceilingReason =
      "The spoken sample is a news broadcast or political/institutional report. " +
      "Political and institutional vocabulary (judiciary, resignation, separation of powers, " +
      "campaign, court rulings, quoted reactions) describes concrete events and institutional " +
      "facts — it is not abstract reasoning. Reporting on political events and quoting " +
      "competing viewpoints is factual discourse, not analytical argument. The inference " +
      "demand does not reach the level of requiring the listener to construct implicit " +
      "conclusions or unstated causal logic throughout the discourse. Maximum level is ILR 2+.";
    result._debug.CEILING_6_FIRED = true;
    result._debug.levelOut = result.finalLevel;
    return result;
  }

  // ── CEILING-7: news broadcast with any inference → hard cap ILR 2+ ────────
  //
  // Even when a news broadcast is misclassified as "analytical" with "significant"
  // inference (model error from institutional vocabulary), it cannot reach ILR 3.
  // ILR 3 requires sustained abstract argument and heavy inference throughout — a
  // criterion that news reporting of political/institutional events cannot meet
  // regardless of topic complexity or vocabulary register.
  if (
    isNewsBroadcast &&
    levelIndex(result.finalLevel) > levelIndex("2+")
  ) {
    result.finalLevel    = "2+";
    result.ceilingApplied = true;
    result.ceilingLabel  = "CEILING-7";
    result.ceilingReason =
      "The spoken sample is a news broadcast or political/institutional report. " +
      "News reporting — even on complex judicial, political, or geopolitical topics — " +
      "cannot reach ILR 3. ILR 3 requires sustained abstract argument with heavy " +
      "inference demand throughout the full discourse; news broadcasts convey explicit " +
      "factual information and do not place that interpretive burden on the listener. " +
      "Maximum level is ILR 2+.";
    result._debug.CEILING_7_FIRED = true;
    result._debug.levelOut = result.finalLevel;
    return result;
  }

  // ── FLOOR-C: extended analytical discourse + significant inference → min ILR 3 ─
  //
  // Extended analytical speech that places significant inference demand on the
  // listener satisfies all three ILR 3 listening criteria simultaneously:
  //   • lsDiscourseLength="extended"  — sustained discourse processing required
  //   • lsStructure="analytical"      — argument-driven, not merely factual/narrative
  //   • lsInference="significant"     — listener must construct beyond explicit content
  //
  // This triple combination is not achievable below ILR 3.  Apply this floor
  // before FLOOR-A and FLOOR-B so the stronger guarantee wins.
  //
  // GUARD: news broadcasts are excluded — political/institutional vocabulary is
  // concrete reference, not abstract reasoning. CEILING-6/7 fire before this floor
  // for news broadcasts, so this guard is a belt-and-suspenders safety net.
  if (
    lsDiscourseLength === "extended" &&
    lsStructure === "analytical" &&
    lsInference === "significant" &&
    !isNewsBroadcast &&
    levelIndex(result.finalLevel) < levelIndex("3")
  ) {
    result.finalLevel            = "3";
    result.listeningFloorApplied = true;
    result.listeningFloorLabel   = "FLOOR-C";
    result.listeningFloorReason  = LISTENING_FLOOR_LABELS["FLOOR-C"];
    result._debug.FLOOR_C_FIRED = true;
    result._debug.levelOut = result.finalLevel;
    return result;
  }

  // ── FLOOR-A: analytical + any inference → min ILR 2+ ─────────────────────
  if (
    lsStructure === "analytical" &&
    lsInference !== "none" &&
    lsInference !== "" &&
    levelIndex(result.finalLevel) < levelIndex("2+")
  ) {
    result.finalLevel           = "2+";
    result.listeningFloorApplied = true;
    result.listeningFloorLabel  = "FLOOR-A";
    result.listeningFloorReason = LISTENING_FLOOR_LABELS["FLOOR-A"];
    result._debug.FLOOR_A_FIRED = true;
    result._debug.levelOut = result.finalLevel;
    return result;
  }

  // ── FLOOR-B: extended discourse + significant inference → min ILR 2+ ──────
  if (
    lsDiscourseLength === "extended" &&
    lsInference === "significant" &&
    levelIndex(result.finalLevel) < levelIndex("2+")
  ) {
    result.finalLevel           = "2+";
    result.listeningFloorApplied = true;
    result.listeningFloorLabel  = "FLOOR-B";
    result.listeningFloorReason = LISTENING_FLOOR_LABELS["FLOOR-B"];
    result._debug.FLOOR_B_FIRED = true;
    result._debug.levelOut = result.finalLevel;
    return result;
  }

  result._debug.levelOut = result.finalLevel;
  return result;
}
