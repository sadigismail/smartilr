// ─────────────────────────────────────────────────────────────────────────────
// config/explanationConfig.js
//
// Explanation templates, mandatory boilerplate phrases, and scope-of-rating
// language.  Edit this file to change what is written in the report without
// touching any engine or scoring logic.
//
// Sections:
//   1.  MANDATORY_PHRASES        — level-specific opening sentences that must
//                                  appear verbatim in ilrDescriptorJustification
//   2.  SCOPE_OF_RATING          — per-modality scope disclaimer
//   3.  LISTENING_CEILING_LABELS — human-readable labels for ceiling rules
//   4.  LISTENING_FLOOR_LABELS   — human-readable labels for floor rules
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Mandatory level-specific phrases ──────────────────────────────────────
//
// These exact strings must appear in ilrDescriptorJustification for the given
// level.  Edit phrase wording here to change the required descriptor language
// in the justification section of every report.
//
export const MANDATORY_PHRASES = Object.freeze({
  "0+":
    "Material is limited to recognition of isolated words, names, numbers, or " +
    "memorized phrases in the target language. No connected discourse is present, " +
    "and comprehension does not require integration of meaning across utterances.",
  "1":
    "Each sentence in this passage presents explicit, concrete information that " +
    "can be understood independently. Comprehension does not require cross-sentence " +
    "integration, sustained inference, or paragraph-level discourse processing.",
  "1+":
    "The passage contains simple or loosely connected statements that convey " +
    "explicit information with limited sentence-to-sentence integration. " +
    "Comprehension does not require sustained paragraph-level reasoning or " +
    "integration of main ideas with supporting detail distributed across " +
    "multiple sentences.",
  "2":
    "The passage presents connected prose requiring integration of explicitly " +
    "stated main ideas and supporting details distributed across sentences. " +
    "Paragraph-level comprehension is required; the reader must track discourse " +
    "relationships and integrate information across sentence boundaries.",
});

// ── 2. Scope-of-rating boilerplate ────────────────────────────────────────────
//
// Appears at the top of each formal report section to clarify that the ILR
// rating applies to the original target-language text, not any translation.
//
export const SCOPE_OF_RATING = Object.freeze({
  reading:
    "The assigned ILR rating applies to the original target-language passage. " +
    "Any English translation is used only as an internal analytical aid to support " +
    "meaning verification and discourse analysis. The rating reflects the comprehension " +
    "demands of the text in the target language, not the translation.",
  listening:
    "The assigned ILR rating applies to the original target-language spoken sample. " +
    "Any English translation is used only as an internal analytical aid. The rating " +
    "reflects the comprehension demands placed on the listener in real time, not on " +
    "a reader of a transcript.",
});

// ── 3. Listening ceiling rule labels ─────────────────────────────────────────
//
// Short rationale strings displayed in the ceiling-rule log when a listening
// ceiling fires.  The condition logic lives in engine/modalityRules.js;
// only the human-readable labels live here.
//
export const LISTENING_CEILING_LABELS = Object.freeze({
  "CEILING-1":
    "The spoken sample presents a factual discourse structure with no inference " +
    "demand. Comprehension requires identifying explicitly stated main ideas and " +
    "supporting details only; the listener is not required to construct implied " +
    "meaning, evaluate authorial stance, or integrate reasoning beyond what is " +
    "directly conveyed. Maximum level is ILR 2.",

  "CEILING-2":
    "The spoken sample presents a factual discourse structure with clear or natural " +
    "delivery conditions. Comprehension is anchored to explicitly conveyed content; " +
    "even where moderate inference is required, the structure of the discourse " +
    "does not generate listening comprehension demands consistent with ILR 2+. " +
    "Maximum level is ILR 2.",

  "CEILING-3":
    "The spoken sample presents a factual discourse structure in which the listener " +
    "must integrate supporting detail with the main idea and draw moderate inferences. " +
    "However, the discourse does not require the listener to construct heavily implied " +
    "meaning, track layered reasoning, or evaluate authorial purpose across an " +
    "extended analytical passage. Maximum level is ILR 2+.",

  "CEILING-4":
    "The spoken sample is short in length, offers high redundancy or restatement, " +
    "and places no inference demand on the listener. Comprehension is supported by " +
    "repeated or paraphrased content; the listener is not required to integrate " +
    "information across utterances or sustain attention across an extended discourse " +
    "sequence. Maximum level is ILR 1+.",
});

// ── 4. Listening floor rule labels ────────────────────────────────────────────
//
// Short rationale strings displayed in the floor-rule log when a listening
// floor fires.
//
export const LISTENING_FLOOR_LABELS = Object.freeze({
  "FLOOR-A":
    "The spoken sample presents analytical discourse structure in which comprehension " +
    "requires the listener to construct meaning that extends beyond explicitly " +
    "conveyed content. The listener must integrate main ideas with implied reasoning " +
    "and track the speaker's purpose or stance across the discourse sequence. These " +
    "demands are consistent with ILR 2+ listening comprehension requirements. " +
    "Minimum level is ILR 2+.",

  "FLOOR-B":
    "The spoken sample presents extended discourse in which significant inference " +
    "is required. The listener must sustain attention across a full discourse sequence " +
    "and construct meaning that is only partially conveyed by explicitly stated " +
    "content. These demands are consistent with ILR 2+ listening comprehension " +
    "requirements. Minimum level is ILR 2+.",

  "FLOOR-C":
    "The spoken sample presents extended analytical discourse in which significant " +
    "inference demand is sustained throughout. The listener must actively construct " +
    "meaning across the full discourse arc, integrate implied reasoning across " +
    "segments, and track the speaker's stance and argument development without " +
    "explicit restatement. These demands — extended length, analytical structure, " +
    "and significant inference — are collectively the hallmarks of ILR 3 listening " +
    "comprehension. Minimum level is ILR 3.",
});
