import { AppError } from "./errors";
import { extractClinicalEntities, mapToNoteSections } from "./nlp";

const SYSTEM_PROMPT = `You are MedScribe's clinical documentation engine. Transform raw clinical conversation extracts into polished, professional, detailed medical documentation.

STRICT RULES:
1. NEVER HALLUCINATE: Do not add clinical details not stated in the transcript. Mark uncertain items with [UNCERTAIN].
2. PRESERVE UNCERTAINTY: Never convert uncertain statements into definitive assertions.
3. REMOVE NON-CLINICAL CONTENT: Remove greetings, small talk, filler words.
4. PROFESSIONAL LANGUAGE: Use standard medical terminology and abbreviations.
5. MISSING SECTIONS: Output "[NOT DISCUSSED]" for sections with no content.
6. recommended_plan must end with: "These are AI-generated suggestions based on available guidelines and do not replace clinical judgment."
7. Return ONLY a valid JSON object with keys:
   chief_complaint, hpi, on_direct_questioning, past_medical_history, past_surgical_history,
   drug_history, medications, allergies, family_history, social_history, nutritional_history,
   immunization_history, developmental_history, gynecological_history, obstetric_history,
   review_of_systems (object), physical_examination (object), lab_investigations,
   imaging_investigations, investigation_comments, provisional_diagnosis, differential_diagnosis,
   final_diagnosis, assessment, plan, recommended_plan, sbar_summary, follow_up,
   primary_survey, secondary_survey, uncertain_fields (array), missing_sections (array).`;

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", pt: "Portuguese",
  ar: "Arabic", zh: "Mandarin Chinese", hi: "Hindi", sw: "Swahili",
};

export type PolishedNote = Record<string, unknown>;

export type GroqChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function maxTokensForModel(model: string, requested?: number): number {
  const compact = /gpt-3\.5|turbo-instruct|8b/i.test(model) ? 2200 : 3500;
  return Math.min(requested ?? compact, compact);
}

function shrinkMessages(messages: GroqChatMessage[], maxChars: number): GroqChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" || message.content.length <= maxChars) return message;
    return {
      ...message,
      content: `${message.content.slice(0, maxChars)}\n\n[Transcripción recortada por límite de tokens]`,
    };
  });
}

export async function groqChatJson(
  env: Env,
  messages: GroqChatMessage[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<Record<string, unknown>> {
  if (!env.GROQ_API_KEY) {
    throw new AppError(503, "GROQ_API_KEY no está configurada.", "GROQ_NOT_CONFIGURED");
  }

  const model = env.GROQ_MODEL || "llama-3.1-8b-instant";
  let maxTokens = maxTokensForModel(model, options?.maxTokens);
  let payload = messages;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: options?.temperature ?? 0.2,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: payload,
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      if (!content.trim()) {
        throw new AppError(502, "Groq devolvió una respuesta vacía.", "GROQ_EMPTY_RESPONSE");
      }
      try {
        return parseJsonObject(content);
      } catch {
        throw new AppError(502, "Groq devolvió JSON inválido para la nota médica.", "GROQ_INVALID_JSON");
      }
    }

    const errText = await response.text();
    console.error(
      JSON.stringify({ event: "groq_chat_failed", status: response.status, body: errText.slice(0, 300) })
    );

    if (response.status === 413 && attempt === 0) {
      maxTokens = Math.min(maxTokens, 900);
      payload = shrinkMessages(payload, 3500);
      continue;
    }

    throw new AppError(502, "No se pudo redactar la nota médica con Groq.", "GROQ_CHAT_FAILED");
  }

  throw new AppError(502, "No se pudo redactar la nota médica con Groq.", "GROQ_CHAT_FAILED");
}

export async function polishNote(
  env: Env,
  transcriptText: string,
  template: string,
  outputLanguage: string,
  encounterType: string
): Promise<PolishedNote> {
  if (!env.GROQ_API_KEY) {
    return fallbackNote(mapToNoteSections(extractClinicalEntities(transcriptText)));
  }

  const entities = extractClinicalEntities(transcriptText);
  const mapped = mapToNoteSections(entities);
  const lang = LANGUAGE_NAMES[outputLanguage] ?? "English";
  const emergency = encounterType === "emergency" || encounterType === "trauma";

  const userPrompt = `Specialty Template: ${template}
Output Language: ${lang}
ENCOUNTER TYPE: ${emergency ? encounterType.toUpperCase() : "REGULAR CLERKING"}
${emergency
    ? "Populate primary_survey (ABCDE) and secondary_survey (head-to-toe)."
    : 'Set primary_survey and secondary_survey to "[N/A - Regular Encounter]".'}

=== FULL TRANSCRIPT ===
${transcriptText}

=== EXTRACTED CLINICAL DATA ===
${JSON.stringify(mapped, null, 2)}

Transform the above into a polished clinical note. Return ONLY JSON.`;

  return groqChatJson(env, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);
}

export type TranscripcionWhisper = {
  text: string;
  language: string;
};

const WHISPER_LANG_NAMES: Record<string, string> = {
  spanish: "es",
  english: "en",
  french: "fr",
  portuguese: "pt",
  german: "de",
  italian: "it",
  arabic: "ar",
  chinese: "zh",
  mandarin: "zh",
  hindi: "hi",
  japanese: "ja",
  korean: "ko",
  russian: "ru",
  dutch: "nl",
  polish: "pl",
  turkish: "tr",
  vietnamese: "vi",
  thai: "th",
  indonesian: "id",
  malay: "ms",
  swahili: "sw",
  catalan: "ca",
  galician: "gl",
};

export function normalizeLanguageCode(raw?: string | null): string {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value === "und" || value === "unknown") return "";
  if (WHISPER_LANG_NAMES[value]) return WHISPER_LANG_NAMES[value];
  const iso = value.match(/^([a-z]{2})(?:[-_][a-z]{2})?$/i);
  return iso ? iso[1].toLowerCase() : value.slice(0, 8);
}

/** Transcribe sin forzar idioma: Whisper detecta el idioma de la conversación. */
export async function transcribeAudio(
  env: Env,
  audio: Blob,
  filename: string,
  _languageHint?: string
): Promise<TranscripcionWhisper> {
  if (!env.GROQ_API_KEY) {
    throw new AppError(503, "GROQ_API_KEY no está configurada.", "GROQ_NOT_CONFIGURED");
  }

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", env.GROQ_WHISPER_MODEL || "whisper-large-v3");
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(
      JSON.stringify({ event: "groq_whisper_failed", status: response.status, body: errText.slice(0, 300) })
    );
    throw new AppError(502, "No se pudo transcribir el audio con Whisper.", "GROQ_WHISPER_FAILED");
  }

  const data = (await response.json()) as { text?: string; language?: string };
  const text = (data.text ?? "").trim();
  if (!text) {
    throw new AppError(422, "Whisper no detectó habla en el audio.", "TRANSCRIPT_EMPTY");
  }
  return { text, language: normalizeLanguageCode(data.language) };
}

export function parseJsonObject(content: string): PolishedNote {
  let text = content.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return JSON.parse(text) as PolishedNote;
}

function fallbackNote(raw: Record<string, string>): PolishedNote {
  return {
    chief_complaint: raw.chief_complaint || "[NOT DISCUSSED]",
    hpi: raw.hpi || "[NOT DISCUSSED]",
    on_direct_questioning: "[NOT DISCUSSED]",
    past_medical_history: "[NOT DISCUSSED]",
    past_surgical_history: "[NOT DISCUSSED]",
    drug_history: "[NOT DISCUSSED]",
    medications: raw.medications || "[NOT DISCUSSED]",
    allergies: raw.allergies || "[NOT DISCUSSED]",
    family_history: raw.family_history || "[NOT DISCUSSED]",
    social_history: raw.social_history || "[NOT DISCUSSED]",
    nutritional_history: "[NOT DISCUSSED]",
    immunization_history: "[NOT DISCUSSED]",
    developmental_history: "[NOT DISCUSSED]",
    gynecological_history: "[NOT DISCUSSED]",
    obstetric_history: "[NOT DISCUSSED]",
    review_of_systems: {},
    physical_examination: {},
    lab_investigations: "[NOT DISCUSSED]",
    imaging_investigations: "[NOT DISCUSSED]",
    investigation_comments: "[NOT DISCUSSED]",
    provisional_diagnosis: "[NOT DISCUSSED]",
    differential_diagnosis: "[NOT DISCUSSED]",
    final_diagnosis: "[PENDING INVESTIGATIONS]",
    assessment: raw.assessment || "[NOT DISCUSSED]",
    plan: raw.plan || "[NOT DISCUSSED]",
    recommended_plan: "AI recommendation not available — GROQ_API_KEY missing.",
    sbar_summary: "[NOT GENERATED]",
    primary_survey: "[N/A - Regular Encounter]",
    secondary_survey: "[N/A - Regular Encounter]",
    follow_up: raw.follow_up || "[NOT DISCUSSED]",
    uncertain_fields: [],
    missing_sections: Object.entries(raw).filter(([, v]) => !v).map(([k]) => k),
  };
}

export function polishedToNoteFields(polished: PolishedNote): Record<string, unknown> {
  const text = (key: string) => String(polished[key] ?? "");
  const obj = (key: string) =>
    polished[key] && typeof polished[key] === "object" && !Array.isArray(polished[key])
      ? polished[key]
      : {};
  const arr = (key: string) => (Array.isArray(polished[key]) ? polished[key] : []);

  return {
    chief_complaint: text("chief_complaint"),
    hpi: text("hpi"),
    on_direct_questioning: text("on_direct_questioning"),
    past_medical_history: text("past_medical_history"),
    past_surgical_history: text("past_surgical_history"),
    drug_history: text("drug_history"),
    medications: text("medications"),
    allergies: text("allergies"),
    family_history: text("family_history"),
    social_history: text("social_history"),
    nutritional_history: text("nutritional_history"),
    immunization_history: text("immunization_history"),
    developmental_history: text("developmental_history"),
    gynecological_history: text("gynecological_history"),
    obstetric_history: text("obstetric_history"),
    review_of_systems: obj("review_of_systems"),
    physical_examination: obj("physical_examination"),
    lab_investigations: text("lab_investigations"),
    imaging_investigations: text("imaging_investigations"),
    investigation_comments: text("investigation_comments"),
    provisional_diagnosis: text("provisional_diagnosis"),
    differential_diagnosis: text("differential_diagnosis"),
    final_diagnosis: text("final_diagnosis"),
    assessment: text("assessment"),
    plan: text("plan"),
    recommended_plan: text("recommended_plan"),
    sbar_summary: text("sbar_summary"),
    primary_survey: text("primary_survey"),
    secondary_survey: text("secondary_survey"),
    follow_up: text("follow_up"),
    missing_sections: arr("missing_sections"),
    uncertain_fields: arr("uncertain_fields"),
    status: "pending_review",
    ai_generated: true,
  };
}

export function formatNoteForWhatsApp(note: Record<string, unknown>): string {
  const lines = [
    "*MedScribe — nota clínica (borrador IA)*",
    "_Requiere revisión médica. No es un diagnóstico._",
    "",
    `*Motivo:* ${note.chief_complaint ?? ""}`,
    `*HPI:* ${note.hpi ?? ""}`,
    `*Antecedentes:* ${note.past_medical_history ?? ""}`,
    `*Medicación:* ${note.medications ?? ""}`,
    `*Alergias:* ${note.allergies ?? ""}`,
    `*Diagnóstico provisional:* ${note.provisional_diagnosis ?? ""}`,
    `*Plan:* ${note.plan ?? ""}`,
    `*SBAR:* ${note.sbar_summary ?? ""}`,
    `*Seguimiento:* ${note.follow_up ?? ""}`,
  ];
  return lines.join("\n").slice(0, 4000);
}
