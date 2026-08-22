import { groqChatPlainText } from "./groq";
import { vacioSignosVitales, type RecetaPaciente, type SignosVitales } from "./nota-types";

export type RecetaAislada = Pick<
  RecetaPaciente,
  "titulo" | "resumen" | "indicaciones" | "medicamentos" | "alarmas" | "seguimiento"
>;

export type SoapAislado = {
  motivo_consulta: string;
  padecimiento_actual: string;
  subjetivo: string;
  objetivo: string;
  analisis: string;
  plan: string;
  signos_vitales: SignosVitales;
  receta: RecetaAislada;
};

const RECETA_VACIA: RecetaAislada = {
  titulo: "",
  resumen: "",
  indicaciones: "",
  medicamentos: [],
  alarmas: "",
  seguimiento: "",
};

const SOAP_VACIO: SoapAislado = {
  motivo_consulta: "",
  padecimiento_actual: "",
  subjetivo: "",
  objetivo: "",
  analisis: "",
  plan: "",
  signos_vitales: vacioSignosVitales(),
  receta: { ...RECETA_VACIA, medicamentos: [] },
};

type CampoSoap = "motivo_consulta" | "padecimiento_actual" | "objetivo" | "analisis" | "plan";
type CampoVital = keyof SignosVitales;
type CampoRecetaTexto = "titulo" | "resumen" | "indicaciones" | "alarmas" | "seguimiento";

function limpiarTextoPlano(raw: string, keys: string[], maxLen: number): string {
  let texto = (raw ?? "").trim();
  texto = texto.replace(/^```(?:text|json)?\s*/i, "").replace(/```$/i, "").trim();
  texto = texto.replace(/^["'«»]+|["'«»]+$/g, "").trim();
  if (texto.startsWith("{")) {
    try {
      const obj = JSON.parse(texto) as Record<string, unknown>;
      for (const key of keys) {
        const extraido = obj[key];
        if (typeof extraido === "string" && extraido.trim()) {
          texto = extraido.trim();
          break;
        }
      }
    } catch {
      /* se conserva el texto crudo */
    }
  }
  texto = texto.replace(/\s+/g, " ").trim();
  if (!texto || /^\(?vac[ií]o\)?$/i.test(texto) || /^n\/?a$/i.test(texto) || texto === "[]") return "";
  return texto.slice(0, maxLen);
}

function limpiarNumeroVital(raw: string, campo: CampoVital): string {
  const texto = limpiarTextoPlano(raw, [campo, "valor", "value"], 40);
  if (!texto) return "";
  const normalizado = texto.replace(",", ".");
  const match = normalizado.match(/-?\d+(?:\.\d+)?/);
  if (!match) return "";
  const n = Number(match[0]);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "";
  if (campo === "ta_sistolica" && n > 0 && n < 30) return String(Math.round(n * 10));
  if (campo === "ta_diastolica" && n > 0 && n < 20) return String(Math.round(n * 10));
  return Number.isInteger(n) ? String(n) : String(n);
}

function calcImc(peso: string, talla: string): string {
  const kg = Number.parseFloat(peso.replace(",", "."));
  const cm = Number.parseFloat(talla.replace(",", "."));
  if (!Number.isFinite(kg) || !Number.isFinite(cm) || kg <= 0 || cm <= 0) return "";
  const metros = cm > 3 ? cm / 100 : cm;
  return (kg / (metros * metros)).toFixed(2);
}

async function extraerCampoIndependiente(
  env: Env,
  textoBorrador: string,
  campo: string,
  system: string,
  maxLen: number
): Promise<string> {
  try {
    const crudo = await groqChatPlainText(
      env,
      [
        { role: "system", content: system },
        { role: "user", content: textoBorrador },
      ],
      { temperature: 0.2, maxTokens: 1024, timeoutMs: 16_000 }
    );
    const valor = limpiarTextoPlano(crudo, [campo, "texto", "content"], maxLen);
    console.log(`SOAP aislado ${campo}:`, valor || "(vacío)");
    return valor;
  } catch (error) {
    console.error(
      `SOAP aislado ${campo} falló:`,
      error instanceof Error ? error.message : "error"
    );
    return "";
  }
}

async function extraerVitalIndependiente(
  env: Env,
  textoBorrador: string,
  campo: CampoVital,
  system: string
): Promise<string> {
  try {
    const crudo = await groqChatPlainText(
      env,
      [
        { role: "system", content: system },
        { role: "user", content: textoBorrador },
      ],
      { temperature: 0.2, maxTokens: 512, timeoutMs: 16_000 }
    );
    const valor = limpiarNumeroVital(crudo, campo);
    console.log(`Signo vital aislado ${campo}:`, valor || "(vacío)");
    return valor;
  } catch (error) {
    console.error(
      `Signo vital aislado ${campo} falló:`,
      error instanceof Error ? error.message : "error"
    );
    return "";
  }
}

function parseMedicamentos(raw: string): RecetaAislada["medicamentos"] {
  let texto = (raw ?? "").trim();
  texto = texto.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  if (!texto || texto === "[]") return [];
  try {
    const parsed = JSON.parse(texto) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { medicamentos?: unknown }).medicamentos)
        ? (parsed as { medicamentos: unknown[] }).medicamentos
        : [];
    return rows
      .map((item) => {
        const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const text = (key: string) => (typeof row[key] === "string" ? row[key].trim() : "");
        return {
          medicamento: text("medicamento") || text("nombre") || (typeof item === "string" ? item.trim() : ""),
          dosis: text("dosis"),
          via: text("via") || text("vía"),
          periodicidad: text("periodicidad") || text("frecuencia"),
          instruccion: text("instruccion") || text("instrucción") || text("duracion") || text("duración"),
        };
      })
      .filter((row) => row.medicamento);
  } catch {
    return [];
  }
}

async function extraerMedicamentosIndependiente(env: Env, textoBorrador: string): Promise<RecetaAislada["medicamentos"]> {
  try {
    const crudo = await groqChatPlainText(
      env,
      [
        {
          role: "system",
          content:
            'Eres un médico. Extrae SOLO los medicamentos que el dictado indique recetar o indicar. Responde ÚNICAMENTE un JSON array. Cada item: {"medicamento":"","dosis":"","via":"","periodicidad":"","instruccion":""}. periodicidad = frecuencia. instruccion = duración y cómo tomarlo. No inventes fármacos. Si no hay medicamentos, responde [].',
        },
        { role: "user", content: textoBorrador },
      ],
      { temperature: 0.2, maxTokens: 1024, timeoutMs: 16_000 }
    );
    const meds = parseMedicamentos(crudo);
    console.log("Receta aislada medicamentos:", meds.length ? meds : "(vacío)");
    return meds;
  } catch (error) {
    console.error(
      "Receta aislada medicamentos falló:",
      error instanceof Error ? error.message : "error"
    );
    return [];
  }
}

const PROMPTS_SOAP: Record<CampoSoap, { system: string; maxLen: number }> = {
  motivo_consulta: {
    maxLen: 220,
    system:
      "Eres un médico. Responde ÚNICAMENTE con el motivo de consulta en una frase clínica corta (2 a 8 palabras) en español. Sin JSON, sin comillas, sin saludos, sin explicación. Ejemplos: Odinofagia y fiebre. Faringitis aguda. Si no hay clínica, responde una cadena vacía.",
  },
  padecimiento_actual: {
    maxLen: 1200,
    system:
      "Eres un médico. Responde ÚNICAMENTE con el padecimiento actual: narrativa clínica en tercera persona, en español, basada solo en lo que dijo el paciente. Incluye síntomas, tiempo e intensidad referidos. Sin JSON, sin saludos, sin copiar el diálogo literal. Si no hay clínica, responde una cadena vacía.",
  },
  objetivo: {
    maxLen: 800,
    system:
      "Eres un médico. Responde ÚNICAMENTE con el Objetivo: exploración física o signos vitales que el texto mencione como medidos o hallados por el médico. La fiebre o síntomas referidos por el paciente NO son objetivo. Sin JSON. Si no hay exploración, responde una cadena vacía.",
  },
  analisis: {
    maxLen: 800,
    system:
      "Eres un médico. Responde ÚNICAMENTE con una impresión diagnóstica breve en español, basada solo en los síntomas referidos. No inventes exploración ni estudios. Sin JSON. Ejemplo: Faringitis aguda probable. Si no hay clínica suficiente, responde una cadena vacía.",
  },
  plan: {
    maxLen: 800,
    system:
      "Eres un médico. Responde ÚNICAMENTE con el plan terapéutico si el dictado menciona tratamiento, receta o indicaciones. No inventes medicamentos ni estudios. Sin JSON. Si no hay plan dictado, responde una cadena vacía.",
  },
};

const PROMPTS_VITAL: Record<Exclude<CampoVital, "imc">, string> = {
  ta_sistolica:
    "Eres un médico. Extrae SOLO la tensión arterial sistólica. Responde únicamente el número, sin unidades. Si dice 120/80 responde 120. Si dice 12/8 (notación mexicana) responde 120. Si no hay TA, cadena vacía.",
  ta_diastolica:
    "Eres un médico. Extrae SOLO la tensión arterial diastólica. Responde únicamente el número, sin unidades. Si dice 120/80 responde 80. Si dice 12/8 responde 80. Si no hay TA, cadena vacía.",
  temperatura:
    "Eres un médico. Extrae SOLO la temperatura en °C si el texto la menciona (fiebre, calentura o temp). Responde únicamente el número, p. ej. 38 o 37.5. Si no hay temperatura, cadena vacía.",
  fc: "Eres un médico. Extrae SOLO la frecuencia cardíaca en lpm. Responde únicamente el número. Si no está, cadena vacía.",
  fr: "Eres un médico. Extrae SOLO la frecuencia respiratoria en rpm. Responde únicamente el número. Si no está, cadena vacía.",
  spo2: "Eres un médico. Extrae SOLO la saturación de oxígeno (SpO2) en %. Responde únicamente el número. Si no está, cadena vacía.",
  peso: "Eres un médico. Extrae SOLO el peso en kg. Responde únicamente el número. Si no está, cadena vacía.",
  talla: "Eres un médico. Extrae SOLO la talla/estatura en cm. Si está en metros (1.70), conviértela a cm (170). Responde únicamente el número. Si no está, cadena vacía.",
  glucosa: "Eres un médico. Extrae SOLO la glucosa capilar o sérica. Responde únicamente el número. Si no está, cadena vacía.",
};

const PROMPTS_RECETA: Record<CampoRecetaTexto, { system: string; maxLen: number }> = {
  titulo: {
    maxLen: 180,
    system:
      "Eres un médico. Responde ÚNICAMENTE con un título breve de receta para el paciente, en español, solo si el dictado indica tratamiento o receta. Ejemplo: Tratamiento para faringitis. Sin JSON. Si no hay receta, cadena vacía.",
  },
  resumen: {
    maxLen: 800,
    system:
      "Eres un médico que explica al paciente. Escribe ÚNICAMENTE un párrafo corto (2 a 4 frases) en español sencillo, sin jerga, sin JSON y sin saludos. Explica de forma simple qué tiene (según síntomas o diagnóstico del texto) y qué debe hacer. Si el dictado no trae un resumen listo, SINTETIZA uno breve a partir de los síntomas y las indicaciones principales. No lo dejes vacío si hay contenido clínico. Solo responde cadena vacía si el texto no tiene nada médico.",
  },
  indicaciones: {
    maxLen: 1200,
    system:
      "Eres un médico. Responde ÚNICAMENTE con las indicaciones para el paciente (cuidados, dieta, reposo, cómo tomar lo recetado) si constan en el dictado. No inventes. Sin JSON. Si no hay, cadena vacía.",
  },
  alarmas: {
    maxLen: 800,
    system:
      "Eres un médico. Responde ÚNICAMENTE con las alarmas o cuándo debe regresar/acudir a urgencias, solo si el dictado las menciona. No inventes. Sin JSON. Si no hay, cadena vacía.",
  },
  seguimiento: {
    maxLen: 400,
    system:
      "Eres un médico. Responde ÚNICAMENTE con la cita o seguimiento (p. ej. revalorar en 48 h) si el dictado lo menciona. No inventes. Sin JSON. Si no hay, cadena vacía.",
  },
};

/** Cada campo se pide a Groq por separado. Un fallo no rompe los demás. */
export async function extraerSoapAislado(env: Env, textoBorrador: string): Promise<SoapAislado> {
  const texto = textoBorrador.trim();
  if (!texto) return { ...SOAP_VACIO, signos_vitales: vacioSignosVitales(), receta: { ...RECETA_VACIA, medicamentos: [] } };

  const camposSoap: CampoSoap[] = [
    "motivo_consulta",
    "padecimiento_actual",
    "objetivo",
    "analisis",
    "plan",
  ];
  const camposVital = Object.keys(PROMPTS_VITAL) as Array<Exclude<CampoVital, "imc">>;
  const camposReceta = Object.keys(PROMPTS_RECETA) as CampoRecetaTexto[];

  const [valoresSoap, valoresVital, valoresReceta, medicamentos] = await Promise.all([
    Promise.all(
      camposSoap.map((campo) => {
        const spec = PROMPTS_SOAP[campo];
        return extraerCampoIndependiente(env, texto, campo, spec.system, spec.maxLen);
      })
    ),
    Promise.all(
      camposVital.map((campo) => extraerVitalIndependiente(env, texto, campo, PROMPTS_VITAL[campo]))
    ),
    Promise.all(
      camposReceta.map((campo) => {
        const spec = PROMPTS_RECETA[campo];
        return extraerCampoIndependiente(env, texto, `receta_${campo}`, spec.system, spec.maxLen);
      })
    ),
    extraerMedicamentosIndependiente(env, texto),
  ]);

  const soap: SoapAislado = {
    ...SOAP_VACIO,
    signos_vitales: vacioSignosVitales(),
    receta: { ...RECETA_VACIA, medicamentos: [] },
  };
  camposSoap.forEach((campo, index) => {
    soap[campo] = valoresSoap[index] ?? "";
  });
  soap.subjetivo = soap.padecimiento_actual;
  camposVital.forEach((campo, index) => {
    soap.signos_vitales[campo] = valoresVital[index] ?? "";
  });
  soap.signos_vitales.imc = calcImc(soap.signos_vitales.peso, soap.signos_vitales.talla);
  camposReceta.forEach((campo, index) => {
    soap.receta[campo] = valoresReceta[index] ?? "";
  });
  soap.receta.medicamentos = medicamentos;

  if (!soap.receta.resumen.trim()) {
    const contexto = [
      soap.analisis && `Diagnóstico: ${soap.analisis}`,
      soap.plan && `Plan: ${soap.plan}`,
      soap.receta.titulo && `Título: ${soap.receta.titulo}`,
      soap.receta.indicaciones && `Indicaciones: ${soap.receta.indicaciones}`,
      soap.receta.medicamentos.length
        ? `Medicamentos: ${soap.receta.medicamentos.map((m) => [m.medicamento, m.dosis, m.periodicidad].filter(Boolean).join(" ")).join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const sintetizado = await extraerCampoIndependiente(
      env,
      `${texto}\n\n${contexto}`,
      "resumen",
      "Eres un médico que explica al paciente. Escribe ÚNICAMENTE un párrafo corto (2 a 4 frases) en español sencillo. Resume el diagnóstico de forma simple y las indicaciones principales (qué debe hacer). Sin JSON, sin saludos. Si solo hay indicaciones, conviértelas en un resumen breve. No lo dejes vacío si hay clínica o indicaciones.",
      800
    );
    soap.receta.resumen = sintetizado || soap.receta.indicaciones.slice(0, 400);
    console.log("Receta resumen aislado (síntesis):", soap.receta.resumen || "(vacío)");
  }

  console.log("SOAP aislado (worker):", JSON.stringify(soap));
  return soap;
}

export async function extraerMotivoConsultaAislado(env: Env, textoBorrador: string): Promise<string> {
  const soap = await extraerSoapAislado(env, textoBorrador);
  return soap.motivo_consulta;
}
