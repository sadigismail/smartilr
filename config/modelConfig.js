// ─────────────────────────────────────────────────────────────────────────────
// config/modelConfig.js
//
// Central model configuration for SmartILR.
//
// To swap the audio scoring model without a code change, set the
// AUDIO_SCORING_MODEL environment variable before starting the server.
//
//   Model options (Replit AI proxy supported):
//     "gpt-audio-mini"  — default; faster, lower cost, good accuracy
//     "gpt-audio"       — stronger analysis, higher cost, slightly slower
//
//   Models that are NOT supported by the Replit proxy:
//     "gpt-4o-audio-preview"      — returns "unknown model"
//     "gpt-4o-mini-audio-preview" — returns "unknown model"
//
//   API notes:
//     • Both supported models accept audio via input_audio content type
//     • response_format: json_object is NOT supported — use prompt-based JSON
//     • Minimum audio duration: 0.1 seconds
//     • modalities: ["text"] (text output only)
// ─────────────────────────────────────────────────────────────────────────────

// Text analysis model (reading + listening text path)
export const TEXT_SCORING_MODEL = "gpt-4o";

// Linguistic View model (ILR Signals tab — teacher-facing annotations).
// gpt-4o-mini is 5–10× faster than gpt-4o for structured JSON tasks and
// avoids Replit's 30 s proxy hard-close that kills slower gpt-4o calls.
// Override with LINGUISTIC_VIEW_MODEL env var to swap without a deploy.
export const LINGUISTIC_VIEW_MODEL =
  process.env.LINGUISTIC_VIEW_MODEL || "gpt-4o-mini";

// Word analysis model (Grammar Analysis chip — per-word morphology).
// gpt-4o-mini is 5–10× faster than gpt-4o for JSON-output tasks and produces
// accurate Arabic morphological annotations. Override with env var to swap
// without a code change: WORD_ANALYSIS_MODEL=gpt-4o
export const WORD_ANALYSIS_MODEL =
  process.env.WORD_ANALYSIS_MODEL || "gpt-4o-mini";

// Audio scoring model (listening audio path only)
// Override with AUDIO_SCORING_MODEL env var to swap without a deploy.
export const AUDIO_SCORING_MODEL =
  process.env.AUDIO_SCORING_MODEL || "gpt-audio-mini";

// Transcription model (teacher reference only — never used for scoring)
export const TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
