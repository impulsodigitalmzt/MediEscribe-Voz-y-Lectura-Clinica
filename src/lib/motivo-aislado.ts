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

function textoSinAporte(texto: string): boolean {
  return /^(no (hay|se menciona|se indica|se refiere|aplica)|ningun[ao]s?(\s+\w+)?|sin (alarmas?|seguimiento|dato|informaci[oó]n)|no mencionado|n\/?a)$/i.test(
    texto.trim()
  );
}

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
  if (!texto || /^\(?vac[ií]o\)?$/i.test(texto) || /^n\/?a$/i.test(texto) || texto === "[]" || textoSinAporte(texto)) {
    return "";
  }
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

const CONCURRENCIA_GROQ = 4;

async function ejecutarEnLotes<T>(tareas: Array<() => Promise<T>>, tamano = CONCURRENCIA_GROQ): Promise<T[]> {
  const resultados: T[] = [];
  for (let i = 0; i < tareas.length; i += tamano) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    const lote = tareas.slice(i, i + tamano);
    const parte = await Promise.all(lote.map((tarea) => tarea()));
    resultados.push(...parte);
  }
  return resultados;
}

async function extraerCampoIndependiente(
  env: Env,
  textoBorrador: string,
  campo: string,
  system: string,
  maxLen: number
): Promise<string> {
  const pedir = () =>
    groqChatPlainText(
      env,
      [
        { role: "system", content: system },
        { role: "user", content: textoBorrador },
      ],
      { temperature: 0.2, maxTokens: 1024, timeoutMs: 16_000 }
    );
  try {
    let crudo = "";
    try {
      crudo = await pedir();
    } catch (error) {
      console.error(
        `SOAP aislado ${campo} reintento:`,
        error instanceof Error ? error.message : "error"
      );
      await new Promise((resolve) => setTimeout(resolve, 700));
      crudo = await pedir();
    }
    const valor = limpiarTextoPlano(crudo, [campo, campo.replace(/^receta_/, ""), "texto", "content"], maxLen);
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
  const pedir = () =>
    groqChatPlainText(
      env,
      [
        { role: "system", content: system },
        { role: "user", content: textoBorrador },
      ],
      { temperature: 0.2, maxTokens: 512, timeoutMs: 16_000 }
    );
  try {
    let crudo = "";
    try {
      crudo = await pedir();
    } catch (error) {
      console.error(
        `Signo vital aislado ${campo} reintento:`,
        error instanceof Error ? error.message : "error"
      );
      await new Promise((resolve) => setTimeout(resolve, 700));
      crudo = await pedir();
    }
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
            "Eres un médico. Extrae SOLO los medicamentos que el dictado indique recetar. Responde ÚNICAMENTE un JSON array. Cada item: {\"medicamento\":\"\",\"dosis\":\"\",\"via\":\"\",\"periodicidad\":\"\",\"instruccion\":\"\"}. Usa dosis, vía, frecuencia y duración EXACTAS si constan (p. ej. dosis 875 mg, via oral, periodicidad cada 12 horas, instruccion durante 7 días). No inventes fármacos ni dosis. Si no hay medicamentos, responde [].",
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

const TONO_SOAP =
  "Redacta como nota SOAP formal NOM-004: tono clínico, objetivo, tercera persona. Sin saludos, sin diálogo crudo, sin JSON, sin comillas envolventes. Si el dato no aparece en el texto, responde una cadena vacía. No inventes hallazgos, fármacos, dosis, estudios ni citas.";

const PROMPTS_SOAP: Record<CampoSoap, { system: string; maxLen: number }> = {
  motivo_consulta: {
    maxLen: 280,
    system: `${TONO_SOAP}
Campo: Motivo de consulta.
Responde ÚNICAMENTE una frase clínica formal que nombre el síntoma o motivo principal y, si consta, el tiempo de evolución.
Ejemplo de estilo: Tos productiva y disnea de tres días de evolución.`,
  },
  padecimiento_actual: {
    maxLen: 1600,
    system: `${TONO_SOAP}
Campo: Padecimiento actual (Subjetivo).
Redacta en tercera persona, formato clínico formal, comenzando por "Paciente refiere cuadro de..." cuando el texto lo permita.
Incluye solo lo referido: tiempo de evolución, síntomas, características (p. ej. expectoración), intensidad, fiebre cuantificada y síntomas acompañantes.
No copies el diálogo. No pongas exploración física ni plan.
Ejemplo de estilo: Paciente refiere cuadro de 3 días con tos con expectoración verde, dolor dorsal secundario a la tos y disnea de medianos esfuerzos. Fiebre cuantificada de hasta 38.5 °C hace dos noches.`,
  },
  objetivo: {
    maxLen: 1200,
    system: `${TONO_SOAP}
Campo: Objetivo / exploración física.
Extrae de forma limpia y directa ÚNICAMENTE los hallazgos físicos o signos vitales que el texto mencione como medidos o explorados por el médico.
Organiza en frases clínicas (tórax, abdomen, etc.). Los síntomas solo referidos por el paciente NO van aquí.
Ejemplo de estilo: Tórax / campos pulmonares: ruidos agregados a la auscultación en hemitórax derecho. Resto sin datos relevantes mencionados.
Si no hay exploración ni signos tomados en consulta, cadena vacía.`,
  },
  analisis: {
    maxLen: 1200,
    system: `${TONO_SOAP}
Campo: Análisis.
Consolida el diagnóstico principal y un breve análisis clínico formal, basados solo en lo que el texto permite inferir.
Primera frase: diagnóstico (o impresión diagnóstica). Segunda: justificación clínica breve (síntomas y hallazgos citados).
No inventes estudios ni exploración no dictada.
Ejemplo de estilo: Bronquitis aguda (con sospecha de progresión a neumonía leve). Cuadro respiratorio bajo con compromiso inflamatorio e infeccioso, sustentado por fiebre, expectoración mucopurulenta y ruidos patológicos a la auscultación.`,
  },
  plan: {
    maxLen: 1600,
    system: `${TONO_SOAP}
Campo: Plan.
Redacta el plan formal SOLO con lo dictado, en este orden si existe: tratamiento farmacológico (fármaco, dosis, vía, frecuencia y duración), estudios de gabinete, medidas generales (reposo, hidratación) y mención de seguimiento o alarmas si se dictaron.
No inventes antibióticos, dosis ni radiografías.
Si no hay plan, receta ni indicaciones, cadena vacía.`,
  },
};

const PROMPTS_VITAL: Record<Exclude<CampoVital, "imc">, string> = {
  ta_sistolica:
    `${TONO_SOAP} Extrae SOLO la tensión arterial sistólica medida o dictada. Responde únicamente el número, sin unidades. Si dice 120/80 responde 120. Si dice 12/8 (notación mexicana) responde 120.`,
  ta_diastolica:
    `${TONO_SOAP} Extrae SOLO la tensión arterial diastólica medida o dictada. Responde únicamente el número. Si dice 120/80 responde 80. Si dice 12/8 responde 80.`,
  temperatura:
    `${TONO_SOAP} Extrae SOLO la temperatura en °C si el texto la menciona (fiebre, calentura o temp). Responde únicamente el número, p. ej. 38.5 o 37.8.`,
  fc: `${TONO_SOAP} Extrae SOLO la frecuencia cardíaca en lpm. Responde únicamente el número.`,
  fr: `${TONO_SOAP} Extrae SOLO la frecuencia respiratoria en rpm. Responde únicamente el número.`,
  spo2: `${TONO_SOAP} Extrae SOLO la saturación de oxígeno (SpO2) en %. Responde únicamente el número.`,
  peso: `${TONO_SOAP} Extrae SOLO el peso en kg. Responde únicamente el número.`,
  talla: `${TONO_SOAP} Extrae SOLO la talla en cm. Si está en metros (1.70), conviértela a 170. Responde únicamente el número.`,
  glucosa: `${TONO_SOAP} Extrae SOLO la glucosa. Responde únicamente el número.`,
};

const PROMPTS_RECETA: Record<"titulo" | "resumen" | "indicaciones", { system: string; maxLen: number }> = {
  titulo: {
    maxLen: 180,
    system: `${TONO_SOAP}
Campo: Título de receta.
Una frase formal breve si hay tratamiento o receta. Ejemplo: Tratamiento para bronquitis aguda.`,
  },
  resumen: {
    maxLen: 800,
    system: `${TONO_SOAP}
Campo: Resumen para el paciente.
Párrafo corto (2 a 4 frases) en lenguaje claro, pero con rigor clínico: qué tiene y qué debe hacer, según el texto. Si no hay un resumen dictado, sintetiza uno breve a partir de síntomas e indicaciones. Vacío solo si no hay clínica.`,
  },
  indicaciones: {
    maxLen: 1200,
    system: `${TONO_SOAP}
Campo: Indicaciones.
Desglosa de forma formal SOLO lo dictado: medidas generales (reposo, hidratación), cómo tomar el tratamiento y estudios de gabinete (p. ej. radiografía de tórax) si se solicitaron.
No inventes reposo ni estudios. Si no hay indicaciones, cadena vacía.`,
  },
};

const PROMPT_ALARMAS = `${TONO_SOAP}
Campo: Alarmas / cuándo acudir.
Extrae SOLO datos de alarma o emergencias mencionados. Estilo: Acudir de inmediato a urgencias en caso de incremento de la disnea o empeoramiento general.
No inventes alarmas genéricas. Si no hay alertas en el texto, cadena vacía.`;

const PROMPT_SEGUIMIENTO = `${TONO_SOAP}
Campo: Seguimiento.
Extrae SOLO la cita o plazo de revisión dictado. Estilo: Cita de revisión médica en 5 días.
No inventes la fecha ni el intervalo. Si no hay seguimiento en el texto, cadena vacía.`;

async function extraerAlarmasAisladas(env: Env, textoBorrador: string): Promise<string> {
  const valor = await extraerCampoIndependiente(
    env,
    textoBorrador,
    "alarmas",
    PROMPT_ALARMAS,
    800
  );
  const limpio = limpiarTextoPlano(valor, ["alarmas", "alarma", "receta_alarmas"], 800);
  console.log("Alarmas aisladas:", limpio || "(vacío)");
  return limpio;
}

async function extraerSeguimientoAislado(env: Env, textoBorrador: string): Promise<string> {
  const valor = await extraerCampoIndependiente(
    env,
    textoBorrador,
    "seguimiento",
    PROMPT_SEGUIMIENTO,
    400
  );
  const limpio = limpiarTextoPlano(valor, ["seguimiento", "follow_up", "receta_seguimiento", "control", "cita"], 400);
  console.log("Seguimiento aislado:", limpio || "(vacío)");
  return limpio;
}

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
  const camposReceta = Object.keys(PROMPTS_RECETA) as Array<"titulo" | "resumen" | "indicaciones">;

  const valoresSoap = await ejecutarEnLotes(
    camposSoap.map((campo) => {
      const spec = PROMPTS_SOAP[campo];
      return () => extraerCampoIndependiente(env, texto, campo, spec.system, spec.maxLen);
    })
  );
  const valoresReceta = await ejecutarEnLotes(
    camposReceta.map((campo) => {
      const spec = PROMPTS_RECETA[campo];
      return () => extraerCampoIndependiente(env, texto, `receta_${campo}`, spec.system, spec.maxLen);
    })
  );
  const [medicamentos, alarmas, seguimiento] = await Promise.all([
    extraerMedicamentosIndependiente(env, texto),
    extraerAlarmasAisladas(env, texto),
    extraerSeguimientoAislado(env, texto),
  ]);
  const valoresVital = await ejecutarEnLotes(
    camposVital.map((campo) => () => extraerVitalIndependiente(env, texto, campo, PROMPTS_VITAL[campo]))
  );

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
  soap.receta.alarmas = alarmas;
  soap.receta.seguimiento = seguimiento;

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
