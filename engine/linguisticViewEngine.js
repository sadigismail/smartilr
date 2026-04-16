// ─────────────────────────────────────────────────────────────────────────────
// engine/linguisticViewEngine.js
//
// Generates teacher-facing Linguistic View annotations for SmartILR.
// Called as a separate, non-blocking analysis after the main ILR rating.
// Does NOT affect the final ILR level assignment.
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from "openai";
import { LINGUISTIC_VIEW_MODEL } from "../config/modelConfig.js";

// Prefer Replit AI Integrations proxy vars; fall back to user-supplied key.
// maxRetries:0 — never retry; a single slow response already risks the 30s
//   Replit proxy hard-close.  Retries would guarantee a timeout.
// timeout:22000 — SDK-level hard cut-off at 22 s, 3 s before the proxy kills
//   the TCP connection at ~25 s, giving time to flush a clean JSON response.
const client = new OpenAI({
  apiKey:    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL:   process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL,
  maxRetries: 0,
  timeout:    22_000,
});

function buildPrompt(text, language) {
  const langNote = (language && language !== "Auto-detect")
    ? `The text is in ${language}.`
    : "Detect the language automatically.";

  const arabicNote = (language === "Arabic" || language === "العربية")
    ? `
Arabic-specific parsing rules:
- Arabic sentences are often verb-first (VSO order). The verb may appear before the subject.
- Subjects may be implicit (embedded in verb morphology). If no overt subject, use null.
- Attached pronouns (e.g. أصدرهم، رفعتها) count as object when applicable.
- Prepositional phrases starting with في، إلى، من، على، عند، لدى often encode Place or Time.
- Time expressions include: أمس، اليوم، غداً، خلال، بعد، قبل، منذ، الآن، فجأة.
- Use best-effort parsing. Do not force labels when the role is genuinely ambiguous.
`
    : "";

  return `You are generating a teacher-facing Linguistic View for SmartILR.
Your task is NOT to assign a final ILR level.
For the provided passage or transcript text, produce concise instructional annotations that support teacher interpretation of passage difficulty.
${langNote}
${arabicNote}
Return ONLY a valid JSON object with exactly this structure:
{
  "difficultWords": [
    { "word": "...", "syllables": ["syl1", "syl2", "syl3"], "note": "brief note, e.g. long academic noun" }
  ],
  "posTags": [
    { "word": "...", "pos": "noun" }
  ],
  "connectors": [
    { "word": "...", "function": "cause" }
  ],
  "ilrSignals": ["signal phrase 1", "signal phrase 2"],
  "instructionalMeaning": "One teacher-facing sentence about processing demand.",
  "discourseType": "Argumentative",
  "discourseExplanation": "One or two sentences explaining why this discourse type applies.",
  "clauseSnapshots": [
    {
      "connector":      "...",
      "subject":        "...",
      "verb":           "...",
      "object":         "...",
      "indirectObject": "...",
      "complement":     "...",
      "masdar":         "...",
      "prepPhrase":     "...",
      "circumstantial": "...",
      "time":           "...",
      "place":          "..."
    }
  ]
}

Rules:
1. difficultWords: select only 4–10 genuinely difficult or long content words. Not every word — only the ones a learner would struggle with. Include syllable breakdown showing natural spoken syllables.
2. posTags: tag major content words only — nouns, verbs, adjectives, adverbs. Skip function words (articles, prepositions, conjunctions, pronouns). Select 15–35 representative words. Each pos value must be exactly one of: noun, verb, adjective, adverb.
3. connectors: identify discourse markers and connectors. Label each with exactly one of: sequence, cause, result, contrast, concession, addition. Include both single-word and multi-word connectors.
4. ilrSignals: 3–7 concise strings such as: "abstract nouns present", "embedded relative clauses", "moderate modifier density", "clear connector usage", "long noun phrases", "lexical repetition supports comprehension", "nominalization patterns", "layered argumentation".
5. instructionalMeaning: one short teacher-facing sentence, e.g. "These features suggest well-organized discourse with moderate lexical density that may challenge learners at lower ILR levels."
6. clauseSnapshots: identify clause-level grammar roles for the 1–6 most important or representative clauses in the passage. Include ONLY the roles that genuinely apply — omit rather than guess. Keep extracted text brief (2–6 words max per slot). Available roles:
   • connector:      Conjunction or discourse connector introducing the clause (e.g. "وبينما", "لذلك")
   • subject:        Grammatical subject / فاعل (who or what performs the action)
   • verb:           Main verb / predicate (include tense marker if useful, e.g. "أعلن (past)")
   • object:         Direct object / مفعول به (what was acted upon)
   • indirectObject: Indirect object / مفعول له or مفعول غير مباشر (beneficiary / recipient)
   • complement:     Nominal or adjectival predicate (when verb is كان/أصبح or there is no verb)
   • masdar:         Verbal noun / infinitive phrase functioning as subject or object (e.g. "تجنب التصعيد")
   • prepPhrase:     Prepositional phrase indicating manner, cause, means, or agency (e.g. "بسبب الضربات")
   • circumstantial: Circumstantial adverb / حال — adjectival adverb (e.g. "مدنيين عُزَّلاً")
   • time:           Adverb of time / ظرف زمان (e.g. "الأسبوع الماضي", "أمس")
   • place:          Adverb of place / ظرف مكان (e.g. "في المنطقة الحدودية")
   A clause MUST have at least a verb OR a subject+complement to be included.
7. discourseType: classify the passage into exactly one of: Narrative, Explanatory, Procedural, Argumentative, Descriptive, Policy / Administrative, Mixed. Use "Mixed" only when two or more types are genuinely co-present with roughly equal weight. If the text is too short or ambiguous to classify confidently, set discourseType to null and discourseExplanation to null.
8. discourseExplanation: 1–2 teacher-facing sentences explaining why the passage belongs to that discourse type, referencing specific structural or lexical evidence from the text. Omit if discourseType is null.
9. Be concise. Do not assign an ILR level. Do not include more than specified.
10. If the text is very short or noisy, still provide best-effort annotations.

Text to analyze (maximum 3000 characters used):
"""
${text.slice(0, 3000)}
"""`;
}

// ── Production-safe timeout for the LV OpenAI call ──────────────────────────
// Replit's autoscale proxy hard-closes connections at ~30 s.
// The SDK-level timeout is 22 s (set on the client above).
// This AbortController fires at 23 s as a belt-and-suspenders fallback in case
// the SDK timeout fires but the SDK error isn't caught as a timeout.
const LV_TIMEOUT_MS = 23_000;

export async function computeLinguisticView(text, language) {
  if (!text || !text.trim()) {
    return { available: false, unavailableReason: "No text was provided for Linguistic View." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LV_TIMEOUT_MS);

  try {
    const completion = await client.chat.completions.create(
      {
        model: LINGUISTIC_VIEW_MODEL,
        messages: [{ role: "user", content: buildPrompt(text.trim(), language) }],
        response_format: { type: "json_object" },
        temperature: 0.15,
        max_tokens: 1100,
      },
      { signal: controller.signal }
    );
    clearTimeout(timer);

    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) throw new Error("Empty response from model");

    const parsed = JSON.parse(raw);

    return {
      available: true,
      difficultWords:       Array.isArray(parsed.difficultWords)      ? parsed.difficultWords      : [],
      posTags:              Array.isArray(parsed.posTags)             ? parsed.posTags             : [],
      connectors:           Array.isArray(parsed.connectors)          ? parsed.connectors          : [],
      ilrSignals:           Array.isArray(parsed.ilrSignals)          ? parsed.ilrSignals          : [],
      instructionalMeaning: typeof parsed.instructionalMeaning === "string" ? parsed.instructionalMeaning : "",
      clauseSnapshots:      Array.isArray(parsed.clauseSnapshots)     ? parsed.clauseSnapshots     : [],
      discourseType:        parsed.discourseType        || null,
      discourseExplanation: parsed.discourseExplanation || null,
    };
  } catch (err) {
    clearTimeout(timer);
    // Detect all flavours of timeout:
    //   • AbortError         — our AbortController fired (23 s fallback)
    //   • controller.signal.aborted — same, caught differently
    //   • APIConnectionTimeoutError — OpenAI SDK 22 s timeout fired
    //   • ETIMEDOUT / message text  — other network-level timeouts
    const isTimeout =
      err.name === "AbortError" ||
      controller.signal.aborted ||
      err.constructor?.name === "APIConnectionTimeoutError" ||
      err.code === "ETIMEDOUT" ||
      (typeof err.message === "string" && err.message.toLowerCase().includes("timed out"));
    if (isTimeout) {
      console.warn("[linguistic-view] timed out —", err.constructor?.name || err.name);
      return { available: false, unavailableReason: "Linguistic analysis timed out — please try again." };
    }
    console.error("[linguistic-view] analysis failed:", err.message, err.status, err.code);
    return { available: false, unavailableReason: "Linguistic analysis could not be completed." };
  }
}
