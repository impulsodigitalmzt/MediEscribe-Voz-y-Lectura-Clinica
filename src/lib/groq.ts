import { AppError } from "./errors";
import { extractClinicalEntities, mapToNoteSections } from "./nlp";
import {
  GROQ_CHAT_TIMEOUT_MS,
  GROQ_WHISPER_TIMEOUT_MS,
  MAX_GROQ_JSON_CHARS,
  fetchTimeout,
  groqTimeoutError,
  isTimeoutError,
} from "./edge";
import { logSinPhi } from "./phi";

const SYSTEM_PROMPT = `You are MedScribe's clinical documentation engine. Extract ONLY verifiable medical facts from the transcript into a JSON clinical note.

STRICT RULES:
1. NEVER HALLUCINATE: Do not add clinical details not stated in the transcript. Do not invent diagnoses, plans, or generic filler.
2. PRESERVE UNCERTAINTY: Never convert uncertain statements into definitive assertions. Mark residual uncertainty with [UNCERTAIN].
3. NOISE FILTER: Ignore greetings, small talk, microphone/audio tests, and comments about whether the recorder works (e.g. "hola buenos días", "prueba de micrófono", "ya trabaja bien", "testing", "hello"). They must not appear in any field, even paraphrased.
4. SEMANTIC ASSIGNMENT: Fill each field only when the transcript contains real, pertinent clinical information for that specific section (chief complaint, HPI, exam, diagnosis, plan, etc.).
5. EMPTY BY DEFAULT: If a section has no medical content, use "" (empty string) or [] / {} as appropriate. Never use greetings as chief_complaint. Never pad with generic phrases.
6. PROFESSIONAL LANGUAGE: Use standard medical terminology only for content that was actually stated.
7. recommended_plan: leave "" unless a plan was dictated. If you do output a plan, end it with: "These are AI-generated suggestions based on available guidelines and do not replace clinical judgment."
8. Return ONLY a valid JSON object with keys:
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

function logGroq(event: string, payload: Record<string, unknown>): void {
  logSinPhi(event, payload);
}

function groqKeyMeta(env: Env): Record<string, unknown> {
  return {
    hasGroqApiKey: Boolean(env.GROQ_API_KEY),
    groqModel: env.GROQ_MODEL || "llama-3.3-70b-versatile",
  };
}

function groqPrivacyHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GROQ_API_KEY}`,
    "Content-Type": "application/json",
  };
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

async function readGroqStreamContent(response: Response, maxChars: number): Promise<string> {
  if (!response.body) {
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
        };
        const chunk = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
        if (chunk) content += chunk;
        if (content.length > maxChars) {
          await reader.cancel().catch(() => undefined);
          throw new AppError(502, "La nota generada excedió el tamaño permitido.", "GROQ_RESPONSE_TOO_LARGE");
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
      }
    }
  }
  return content;
}

export async function groqChatJson(
  env: Env,
  messages: GroqChatMessage[],
  options?: { temperature?: number; maxTokens?: number; timeoutMs?: number; stream?: boolean }
): Promise<Record<string, unknown>> {
  if (!env.GROQ_API_KEY) {
    logGroq("groq_chat_missing_key", {
      ...groqKeyMeta(env),
      detail: "GROQ_API_KEY no está en el Worker. Sin esta clave no hay llamada al modelo.",
    });
    throw new AppError(503, "GROQ_API_KEY no está configurada.", "GROQ_NOT_CONFIGURED");
  }

  const model = env.GROQ_MODEL || "llama-3.3-70b-versatile";
  let maxTokens = maxTokensForModel(model, options?.maxTokens);
  let payload = messages;
  const userChars = messages.find((m) => m.role === "user")?.content.length ?? 0;
  const groqUrl = "https://api.groq.com/openai/v1/chat/completions";
  let omitirStore = false;
  let useStream = options?.stream !== false;
  const timeoutMs = options?.timeoutMs ?? GROQ_CHAT_TIMEOUT_MS;

  logGroq("groq_chat_request", {
    ...groqKeyMeta(env),
    maxTokens,
    userChars,
    messageCount: messages.length,
    stream: useStream,
    privacy: { store: false, training: "forbidden" },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const body: Record<string, unknown> = {
      model,
      temperature: options?.temperature ?? 0.2,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: payload,
      stream: useStream,
    };
    if (!omitirStore) body.store = false;

    let response: Response;
    try {
      response = await fetch(groqUrl, {
        method: "POST",
        headers: groqPrivacyHeaders(env),
        body: JSON.stringify(body),
        signal: fetchTimeout(timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) throw groqTimeoutError("chat");
      throw error;
    }

    const errText = response.ok ? "" : await response.text();
    logGroq("groq_chat_http", {
      ...groqKeyMeta(env),
      attempt,
      httpStatus: response.status,
      ok: response.ok,
      stream: useStream,
    });
    if (!response.ok) {
      const authFail = response.status === 401 || response.status === 403;
      logGroq(authFail ? "groq_chat_auth_failed" : "groq_chat_failed", {
        ...groqKeyMeta(env),
        httpStatus: response.status,
        attempt,
        bodyChars: errText.length,
      });
      if ((response.status === 400 || response.status === 413) && attempt === 0) {
        if (response.status === 400) {
          omitirStore = true;
          useStream = false;
        }
        if (response.status === 413) {
          maxTokens = Math.min(maxTokens, 900);
          payload = shrinkMessages(payload, 3500);
        }
        continue;
      }
      throw new AppError(
        502,
        authFail
          ? "Groq rechazó la autenticación (API key inválida o ausente)."
          : "No se pudo redactar la nota médica con Groq.",
        authFail ? "GROQ_AUTH_FAILED" : "GROQ_CHAT_FAILED"
      );
    }

    let content = "";
    try {
      if (useStream) {
        content = await readGroqStreamContent(response, MAX_GROQ_JSON_CHARS);
      } else {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          error?: { message?: string };
        };
        content = data.choices?.[0]?.message?.content ?? "";
        if (content.length > MAX_GROQ_JSON_CHARS) {
          throw new AppError(502, "La nota generada excedió el tamaño permitido.", "GROQ_RESPONSE_TOO_LARGE");
        }
      }
    } catch (error) {
      if (isTimeoutError(error)) throw groqTimeoutError("chat");
      throw error;
    }

    logGroq("groq_chat_raw_content", {
      ...groqKeyMeta(env),
      httpStatus: response.status,
      contentChars: content.length,
      privacy: { store: false, training: "forbidden" },
    });
    console.log("GROQ RAW ANTES DE PARSEAR:", content);
    if (!content.trim()) {
      if (useStream && attempt === 0) {
        useStream = false;
        continue;
      }
      throw new AppError(502, "Groq devolvió una respuesta vacía.", "GROQ_EMPTY_RESPONSE");
    }
    try {
      const parsed = parseJsonObject(content);
      const nota = (parsed.nota_medica_espanol ?? parsed.nota ?? parsed) as Record<string, unknown>;
      logGroq("groq_chat_parsed_json", {
        topKeys: Object.keys(parsed),
        notaKeys: nota && typeof nota === "object" ? Object.keys(nota).slice(0, 40) : [],
        motivoChars: typeof nota?.motivo_consulta === "string" ? nota.motivo_consulta.length : 0,
        padecimientoChars: typeof nota?.padecimiento_actual === "string" ? nota.padecimiento_actual.length : 0,
        diagnosticoChars: typeof nota?.diagnostico === "string" ? nota.diagnostico.length : 0,
        exploracionChars: typeof nota?.exploracion_fisica === "string" ? nota.exploracion_fisica.length : 0,
        planChars:
          typeof nota?.plan_tratamiento === "string"
            ? nota.plan_tratamiento.length
            : typeof nota?.plan === "string"
              ? nota.plan.length
              : 0,
      });
      console.log("GROQ JSON PARSEADO (llaves):", Object.keys(parsed));
      return parsed;
    } catch (parseError) {
      console.error("GROQ JSON INVÁLIDO. Texto crudo:", content);
      logGroq("groq_chat_invalid_json", {
        message: parseError instanceof Error ? parseError.message : "parse_error",
        contentChars: content.length,
      });
      throw new AppError(502, "Groq devolvió JSON inválido para la nota médica.", "GROQ_INVALID_JSON");
    }
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

Transform the above into a clinical note. Fill a field only with medical facts from the transcript. Greetings and mic tests must not appear. Empty string if a section has no clinical content. Return ONLY JSON.`;

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

  let response: Response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
      signal: fetchTimeout(GROQ_WHISPER_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeoutError(error)) throw groqTimeoutError("whisper");
    throw error;
  }

  if (!response.ok) {
    logGroq("groq_whisper_failed", { status: response.status });
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
