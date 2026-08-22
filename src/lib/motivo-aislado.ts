import { groqChatPlainText } from "./groq";
import { vacioSignosVitales, type RecetaPaciente, type SignosVitales } from "./nota-types";
import { extraerMedicamentosDeTexto, planDesdeBorrador } from "./plan-terapeutico";

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
  const pedir = () =>
    groqChatPlainText(
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
  try {
    let crudo = "";
    try {
      crudo = await pedir();
    } catch (error) {
      console.error(
        "Receta aislada medicamentos reintento:",
        error instanceof Error ? error.message : "error"
      );
      await new Promise((resolve) => setTimeout(resolve, 700));
      crudo = await pedir();
    }
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
Campo: Plan terapéutico.
Redacta un plan formal y estructurado, en frases clínicas (sin diálogo). Si el dictado menciona tratamiento, NO lo dejes vacío: reformúlalo.
Orden si el dato consta:
1) Un renglón por fármaco: nombre, dosis, vía, frecuencia y duración.
2) Estudios de gabinete solicitados.
3) Medidas generales (reposo, hidratación).
Ejemplo: Amoxicilina/ácido clavulánico 875 mg vía oral cada 12 horas por 7 días. Paracetamol 500 mg vía oral cada 8 horas. Radiografía de tórax de control. Reposo en casa y abundante hidratación.
No inventes fármacos, dosis ni estudios que no estén en el dictado.`,
  },
};

const PROMPTS_VITAL: Record<Exclude<CampoVital, "imc">, string> = {
  ta_sistolica:
    `${TONO_SOAP} Extrae SOLO la tensión arterial sistólica medida o dictada. Responde únicamente el número, sin unidades. Si dice 120/80 responde 120. Si dice 12/8 (notación mexicana) responde 120.`,
  ta_diastolica:
    `${TONO_SOAP} Extrae SOLO la tensión arterial diastólica medida o dictada. Responde únicamente el número. Si dice 120/80 responde 80. Si dice 12/8 responde 80.`,
  temperatura:
    `${TONO_SOAP} Extrae SOLO la temperatura en °C. Si hay fiebre referida (p. ej. 38.5) y una temperatura medida ahora en consulta, usa la medida ahora (p. ej. 37.8). Responde únicamente el número.`,
  fc: `${TONO_SOAP} Extrae SOLO la frecuencia cardíaca en lpm. Responde únicamente el número.`,
  fr: `${TONO_SOAP} Extrae SOLO la frecuencia respiratoria en rpm. Responde únicamente el número.`,
  spo2: `${TONO_SOAP} Extrae SOLO la saturación de oxígeno (SpO2) en %. Responde únicamente el número.`,
  peso: `${TONO_SOAP} Extrae SOLO el peso en kg. Responde únicamente el número.`,
  talla: `${TONO_SOAP} Extrae SOLO la talla en cm. Si está en metros (1.70), conviértela a 170. Responde únicamente el número.`,
  glucosa: `${TONO_SOAP} Extrae SOLO la glucosa. Responde únicamente el número.`,
};

const TONO_RECETA =
  "Redacta la receta para el paciente en español claro. Sin JSON, sin saludos, sin comillas envolventes. El borrador es un dictado conversacional: extrae y reformula el contenido clínico aunque no use las palabras título, resumen, indicaciones, alarmas o seguimiento. No dejes el campo vacío si el borrador ya menciona ese contenido. No inventes fármacos, dosis ni plazos que no estén.";

const PROMPTS_RECETA: Record<CampoRecetaTexto, { system: string; maxLen: number }> = {
  titulo: {
    maxLen: 180,
    system: `${TONO_RECETA}
Campo: Título.
Una frase breve si hay diagnóstico o tratamiento. Ejemplo: Tratamiento para bronquitis aguda.`,
  },
  resumen: {
    maxLen: 800,
    system: `${TONO_RECETA}
Campo: Resumen para el paciente.
Escribe 2 a 4 frases: qué tiene y qué debe hacer, según el borrador. Si no hay un resumen dictado, sintetízalo con el diagnóstico y las indicaciones que sí consten.`,
  },
  indicaciones: {
    maxLen: 1200,
    system: `${TONO_RECETA}
Campo: Indicaciones.
Desglosa reposo, hidratación, cómo tomar el tratamiento y estudios de gabinete si el médico los indicó (p. ej. radiografía de tórax).`,
  },
  alarmas: {
    maxLen: 800,
    system: `${TONO_RECETA}
Campo: Alarmas / cuándo acudir.
Extrae cuándo regresar o ir a urgencias (empeorar, más disnea, falta de aire). Ejemplo: Acudir de inmediato a urgencias si aumenta la disnea o empeoran los síntomas.`,
  },
  seguimiento: {
    maxLen: 400,
    system: `${TONO_RECETA}
Campo: Seguimiento.
Extrae la cita o plazo de revisión (p. ej. en 5 días). Ejemplo: Cita de revisión médica en 5 días.`,
  },
};

async function extraerRecetaTituloAislado(env: Env, textoBorrador: string): Promise<string> {
  const spec = PROMPTS_RECETA.titulo;
  const valor = await extraerCampoIndependiente(env, textoBorrador, "receta_titulo", spec.system, spec.maxLen);
  console.log("Receta título aislado:", valor || "(vacío)");
  return valor;
}

async function extraerRecetaResumenAislado(env: Env, textoBorrador: string): Promise<string> {
  const spec = PROMPTS_RECETA.resumen;
  const valor = await extraerCampoIndependiente(env, textoBorrador, "receta_resumen", spec.system, spec.maxLen);
  console.log("Receta resumen aislado:", valor || "(vacío)");
  return valor;
}

async function extraerRecetaIndicacionesAisladas(env: Env, textoBorrador: string): Promise<string> {
  const spec = PROMPTS_RECETA.indicaciones;
  const valor = await extraerCampoIndependiente(env, textoBorrador, "receta_indicaciones", spec.system, spec.maxLen);
  console.log("Receta indicaciones aisladas:", valor || "(vacío)");
  return valor;
}

async function extraerAlarmasAisladas(env: Env, textoBorrador: string): Promise<string> {
  const spec = PROMPTS_RECETA.alarmas;
  const valor = await extraerCampoIndependiente(env, textoBorrador, "receta_alarmas", spec.system, spec.maxLen);
  console.log("Alarmas aisladas:", valor || "(vacío)");
  return valor;
}

async function extraerSeguimientoAislado(env: Env, textoBorrador: string): Promise<string> {
  const spec = PROMPTS_RECETA.seguimiento;
  const valor = await extraerCampoIndependiente(env, textoBorrador, "receta_seguimiento", spec.system, spec.maxLen);
  console.log("Seguimiento aislado:", valor || "(vacío)");
  return valor;
}

function primeraFrase(texto: string): string {
  return texto.split(/[.\n]/).map((parte) => parte.trim()).find(Boolean) ?? "";
}

function frasesPorPatron(texto: string, patron: RegExp): string {
  const matches = texto.match(patron);
  if (!matches?.length) return "";
  return limpiarTextoPlano(matches.map((item) => item.trim()).join(" "), ["texto"], 800);
}

async function extraerPlanTerapeuticoAislado(env: Env, textoBorrador: string): Promise<string> {
  const spec = PROMPTS_SOAP.plan;
  const valor = await extraerCampoIndependiente(env, textoBorrador, "plan", spec.system, spec.maxLen);
  console.log("Plan aislado:", valor || "(vacío)");
  return valor;
}

/** Fase 2: espera el plan y, con ese texto, extrae medicamentos. No se mezcla con S/O. */
async function extraerPlanYMedicamentosControlado(
  env: Env,
  textoBorrador: string
): Promise<{ plan: string; medicamentos: RecetaAislada["medicamentos"] }> {
  let plan = await extraerPlanTerapeuticoAislado(env, textoBorrador);
  if (!plan) {
    plan = planDesdeBorrador(textoBorrador);
    console.log("Plan aislado (rescate desde borrador):", plan || "(vacío)");
  }
  const fuenteMeds = plan || textoBorrador;
  let medicamentos = await extraerMedicamentosIndependiente(env, fuenteMeds);
  if (!medicamentos.length) {
    medicamentos = extraerMedicamentosDeTexto(`${plan}\n${textoBorrador}`);
    console.log("Receta aislada medicamentos (rescate):", medicamentos.length ? medicamentos : "(vacío)");
  }
  return { plan, medicamentos };
}

function completarRecetaSiFalta(receta: RecetaAislada, texto: string, analisis: string, plan: string): RecetaAislada {
  const fuente = `${texto}\n${plan}`;
  if (!receta.titulo.trim()) {
    const dx = primeraFrase(analisis).replace(/\s*\(.*$/, "").slice(0, 80);
    receta.titulo = dx ? `Tratamiento para ${dx}` : plan ? "Tratamiento indicado" : "";
  }
  if (!receta.indicaciones.trim()) {
    receta.indicaciones = plan || frasesPorPatron(
      fuente,
      /[^.?!]*(?:reposo|hidrataci[oó]n|radiograf[ií]a|tomar|v[ií]a oral|cada\s+\d+)[^.?!]*[.?!]?/gi
    );
  }
  if (!receta.alarmas.trim()) {
    receta.alarmas = frasesPorPatron(
      fuente,
      /[^.?!]*(?:urgenc|empeor|falta(?:r)?(?:le)?(?:\s+m[aá]s)?\s+el aire|disnea|si (?:aumenta|empeora|se pone peor)|alarma)[^.?!]*[.?!]?/gi
    );
  }
  if (!receta.seguimiento.trim()) {
    receta.seguimiento = frasesPorPatron(
      fuente,
      /[^.?!]*(?:en\s+\d+\s*d[ií]as|control(?:\s+ambulatorio)?|cita de revisi[oó]n|seguimiento|revisi[oó]n m[eé]dica)[^.?!]*[.?!]?/gi
    );
  }
  if (!receta.resumen.trim()) {
    const dx = primeraFrase(analisis);
    const partes = [
      dx ? `Le diagnosticaron ${dx}.` : "",
      receta.indicaciones || plan,
    ].filter(Boolean);
    receta.resumen = partes.join(" ").slice(0, 800);
  }
  if (!receta.medicamentos.length) {
    receta.medicamentos = extraerMedicamentosDeTexto(`${plan}\n${texto}`);
  }
  return receta;
}

/** Cada campo se pide a Groq por separado. SOAP, signos y receta arrancan juntos. */
export async function extraerSoapAislado(env: Env, textoBorrador: string): Promise<SoapAislado> {
  const texto = textoBorrador.trim();
  if (!texto) return { ...SOAP_VACIO, signos_vitales: vacioSignosVitales(), receta: { ...RECETA_VACIA, medicamentos: [] } };

  const camposSoap: CampoSoap[] = [
    "motivo_consulta",
    "padecimiento_actual",
    "objetivo",
    "analisis",
  ];
  const camposVital = Object.keys(PROMPTS_VITAL) as Array<Exclude<CampoVital, "imc">>;

  const [
    valoresSoap,
    valoresVital,
    titulo,
    resumen,
    indicaciones,
    alarmas,
    seguimiento,
    planYMeds,
  ] = await Promise.all([
    Promise.all(
      camposSoap.map((campo) => {
        const spec = PROMPTS_SOAP[campo];
        return extraerCampoIndependiente(env, texto, campo, spec.system, spec.maxLen);
      })
    ),
    Promise.all(
      camposVital.map((campo) => extraerVitalIndependiente(env, texto, campo, PROMPTS_VITAL[campo]))
    ),
    extraerRecetaTituloAislado(env, texto),
    extraerRecetaResumenAislado(env, texto),
    extraerRecetaIndicacionesAisladas(env, texto),
    extraerAlarmasAisladas(env, texto),
    extraerSeguimientoAislado(env, texto),
    extraerPlanYMedicamentosControlado(env, texto),
  ]);

  const soap: SoapAislado = {
    ...SOAP_VACIO,
    signos_vitales: vacioSignosVitales(),
    receta: { ...RECETA_VACIA, medicamentos: [] },
  };
  camposSoap.forEach((campo, index) => {
    soap[campo] = valoresSoap[index] ?? "";
  });
  soap.plan = planYMeds.plan;
  soap.subjetivo = soap.padecimiento_actual;
  camposVital.forEach((campo, index) => {
    soap.signos_vitales[campo] = valoresVital[index] ?? "";
  });
  soap.signos_vitales.imc = calcImc(soap.signos_vitales.peso, soap.signos_vitales.talla);
  soap.receta = completarRecetaSiFalta(
    {
      titulo,
      resumen,
      indicaciones,
      medicamentos: planYMeds.medicamentos,
      alarmas,
      seguimiento,
    },
    texto,
    soap.analisis,
    soap.plan
  );

  console.log("Receta aislada lista:", {
    titulo: soap.receta.titulo || "(vacío)",
    resumen: soap.receta.resumen || "(vacío)",
    indicaciones: soap.receta.indicaciones || "(vacío)",
    medicamentos: soap.receta.medicamentos.length,
    alarmas: soap.receta.alarmas || "(vacío)",
    seguimiento: soap.receta.seguimiento || "(vacío)",
  });
  console.log("SOAP aislado (worker):", JSON.stringify(soap));
  return soap;
}

export async function extraerMotivoConsultaAislado(env: Env, textoBorrador: string): Promise<string> {
  const soap = await extraerSoapAislado(env, textoBorrador);
  return soap.motivo_consulta;
}
