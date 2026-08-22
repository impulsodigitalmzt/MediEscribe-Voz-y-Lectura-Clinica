import { groqChatJson } from "./groq";
import { extraerMedicamentosDeTexto, planDesdeBorrador } from "./plan-terapeutico";
import { vacioSignosVitales, type RecetaPaciente, type SignosVitales } from "./nota-types";

export type MedicamentoOneshot = {
  medicamento: string;
  dosis: string;
  via: string;
  periodicidad: string;
  instruccion: string;
};

export type RecetaOneshot = Pick<
  RecetaPaciente,
  "titulo" | "resumen" | "indicaciones" | "alarmas" | "seguimiento"
> & { medicamentos: MedicamentoOneshot[] };

export type SoapOneshot = {
  motivo_consulta: string;
  padecimiento_actual: string;
  interrogatorio: string;
  subjetivo: string;
  objetivo: string;
  exploracion_fisica: string;
  analisis: string;
  pronostico: string;
  plan: string;
  notas_evolucion: string;
  seguimiento: string;
  signos_vitales: SignosVitales;
  receta: RecetaOneshot;
};

const RECETA_VACIA: RecetaOneshot = {
  titulo: "",
  resumen: "",
  indicaciones: "",
  medicamentos: [],
  alarmas: "",
  seguimiento: "",
};

export function soapOneshotVacio(): SoapOneshot {
  return {
    motivo_consulta: "",
    padecimiento_actual: "",
    interrogatorio: "",
    subjetivo: "",
    objetivo: "",
    exploracion_fisica: "",
    analisis: "",
    pronostico: "",
    plan: "",
    notas_evolucion: "",
    seguimiento: "",
    signos_vitales: vacioSignosVitales(),
    receta: { ...RECETA_VACIA, medicamentos: [] },
  };
}

const SYSTEM_PROMPT = `Eres médico redactor de MediEscribe (NOM-004-SSA3). Lees UN dictado conversacional y devuelves UN solo objeto JSON con la nota SOAP completa.

REGLAS:
1. Una sola respuesta: SOLO el JSON, sin markdown ni texto extra. JSON compacto (sin saltos de línea).
2. Extrae y redacta en tono clínico formal, tercera persona. No copies saludos ni el diálogo crudo.
3. Si un dato no está en el dictado, usa "" o [] . No inventes fármacos, dosis, estudios, signos ni citas.
4. Si el texto es solo saludo o prueba de micrófono, todos los campos van vacíos.
5. Signos vitales: solo números (sin unidades). TA 120/80 → ta_sistolica "120" y ta_diastolica "80". Notación 12/8 → 120 y 80.
6. exploracion_fisica: solo hallazgos explorados o medidos. Los síntomas referidos van en padecimiento_actual.
7. Completa TODAS las llaves. Prioriza plan, medicamentos, pronostico, seguimiento y receta (titulo_receta, resumen_paciente, indicaciones_receta, alarmas) si el dictado trae diagnóstico o tratamiento.
8. medicamentos: un item por fármaco recetado. Si no hay, [].
9. pronostico: breve (bueno, reservado, malo o una frase clínica) si hay diagnóstico. Si no hay base, "".
10. seguimiento: cita o plazo de revisión dictado (p. ej. "Cita de revisión en 5 días").
11. notas_evolucion: solo si hay evolución o control dictado; si no, "".

Llaves EXACTAS (plana, sin objeto receta anidado):
{
  "motivo_consulta": "",
  "padecimiento_actual": "",
  "interrogatorio": "",
  "exploracion_fisica": "",
  "analisis": "",
  "plan": "",
  "medicamentos": [
    { "medicamento": "", "dosis": "", "via": "", "periodicidad": "", "instruccion": "" }
  ],
  "pronostico": "",
  "seguimiento": "",
  "notas_evolucion": "",
  "titulo_receta": "",
  "resumen_paciente": "",
  "indicaciones_receta": "",
  "alarmas": "",
  "signos_vitales": {
    "ta_sistolica": "",
    "ta_diastolica": "",
    "temperatura": "",
    "fc": "",
    "fr": "",
    "spo2": "",
    "peso": "",
    "talla": "",
    "imc": "",
    "glucosa": ""
  }
}`;

function texto(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function numeroVital(value: unknown, campo: keyof SignosVitales): string {
  const raw = texto(value);
  if (!raw || raw === "0") return "";
  const match = raw.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return "";
  const n = Number(match[0]);
  if (!Number.isFinite(n) || n <= 0) return "";
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

function medicamentosDe(value: unknown): MedicamentoOneshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const campo = (key: string) => texto(row[key]);
      return {
        medicamento: campo("medicamento") || campo("nombre"),
        dosis: campo("dosis"),
        via: campo("via") || campo("vía"),
        periodicidad: campo("periodicidad") || campo("frecuencia"),
        instruccion: campo("instruccion") || campo("instrucción") || campo("duracion") || campo("duración"),
      };
    })
    .filter((row) => row.medicamento);
}

export function normalizarSoapOneshot(raw: Record<string, unknown>): SoapOneshot {
  const vacio = soapOneshotVacio();
  const signosRaw =
    raw.signos_vitales && typeof raw.signos_vitales === "object"
      ? (raw.signos_vitales as Record<string, unknown>)
      : {};
  const recetaRaw = raw.receta && typeof raw.receta === "object" ? (raw.receta as Record<string, unknown>) : {};
  const padecimiento = texto(raw.padecimiento_actual) || texto(raw.subjetivo);
  const exploracion = texto(raw.exploracion_fisica) || texto(raw.objetivo);
  const analisis = texto(raw.analisis) || texto(raw.diagnostico);
  const signos: SignosVitales = { ...vacio.signos_vitales };
  (Object.keys(signos) as Array<keyof SignosVitales>).forEach((key) => {
    if (key === "imc") return;
    signos[key] = numeroVital(signosRaw[key], key);
  });
  signos.imc = numeroVital(signosRaw.imc, "imc") || calcImc(signos.peso, signos.talla);

  const medicamentos = medicamentosDe(
    Array.isArray(raw.medicamentos) ? raw.medicamentos : recetaRaw.medicamentos
  );

  const seguimiento =
    texto(raw.seguimiento)
    || texto(recetaRaw.seguimiento)
    || texto(raw.receta_seguimiento)
    || texto(raw.seguimiento_receta);
  const alarmas =
    texto(recetaRaw.alarmas)
    || texto(raw.alarmas)
    || texto(raw.receta_alarmas)
    || texto(recetaRaw.alarmas_receta);
  const tituloReceta =
    texto(recetaRaw.titulo)
    || texto(recetaRaw.titulo_receta)
    || texto(raw.titulo_receta)
    || texto(raw.receta_titulo);
  const resumenPaciente =
    texto(recetaRaw.resumen)
    || texto(recetaRaw.resumen_paciente)
    || texto(raw.resumen_paciente)
    || texto(raw.receta_resumen);
  const indicacionesReceta =
    texto(recetaRaw.indicaciones)
    || texto(recetaRaw.indicaciones_receta)
    || texto(raw.indicaciones_receta)
    || texto(raw.receta_indicaciones);

  return {
    motivo_consulta: texto(raw.motivo_consulta) || texto(raw.motivo),
    padecimiento_actual: padecimiento,
    interrogatorio: texto(raw.interrogatorio),
    subjetivo: padecimiento,
    objetivo: exploracion,
    exploracion_fisica: exploracion,
    analisis,
    pronostico: texto(raw.pronostico) || texto(raw.pronóstico),
    plan: texto(raw.plan) || texto(raw.plan_tratamiento),
    notas_evolucion: texto(raw.notas_evolucion) || texto(raw.notas_de_evolucion),
    seguimiento,
    signos_vitales: signos,
    receta: {
      titulo: tituloReceta,
      resumen: resumenPaciente,
      indicaciones: indicacionesReceta,
      medicamentos,
      alarmas,
      seguimiento,
    },
  };
}

function primeraFrase(raw: string): string {
  return raw.split(/[.\n]/).map((parte) => parte.trim()).find(Boolean) ?? "";
}

function frasesPorPatron(raw: string, patron: RegExp): string {
  const matches = raw.match(patron);
  if (!matches?.length) return "";
  return matches.map((item) => item.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** Rellena receta / plan / pronóstico / seguimiento con lo ya extraído (sin otra llamada a Groq). */
export function completarSoapOneshot(soap: SoapOneshot, borrador: string): SoapOneshot {
  const plan = soap.plan || planDesdeBorrador(`${borrador}\n${soap.padecimiento_actual}\n${soap.analisis}`);
  const analisis = soap.analisis;
  const fuente = `${borrador}\n${plan}\n${analisis}`;
  const receta = { ...soap.receta, medicamentos: [...soap.receta.medicamentos] };

  if (!receta.medicamentos.length) {
    receta.medicamentos = extraerMedicamentosDeTexto(`${plan}\n${fuente}`).map((row) => ({
      medicamento: row.medicamento,
      dosis: row.dosis,
      via: row.via,
      periodicidad: row.periodicidad,
      instruccion: row.instruccion,
    }));
  }
  if (!receta.titulo) {
    const dx = primeraFrase(analisis).replace(/\s*\(.*$/, "").slice(0, 80);
    receta.titulo = dx ? `Tratamiento para ${dx}` : plan ? "Tratamiento indicado" : "";
  }
  if (!receta.indicaciones) {
    receta.indicaciones = plan || frasesPorPatron(
      fuente,
      /[^.?!]*(?:reposo|hidrataci[oó]n|radiograf[ií]a|tomar|v[ií]a oral|cada\s+\d+)[^.?!]*[.?!]?/gi
    );
  }
  if (!receta.alarmas) {
    receta.alarmas = frasesPorPatron(
      fuente,
      /[^.?!]*(?:urgenc|empeor|falta(?:r)?(?:le)?(?:\s+m[aá]s)?\s+el aire|disnea|si (?:aumenta|empeora|se pone peor)|alarma)[^.?!]*[.?!]?/gi
    );
  }
  if (!receta.alarmas && (plan || receta.indicaciones)) {
    receta.alarmas = "Acudir a urgencias si hay empeoramiento, dificultad para respirar o fiebre persistente.";
  }
  const seguimiento =
    soap.seguimiento
    || receta.seguimiento
    || frasesPorPatron(
      fuente,
      /[^.?!]*(?:en\s+\d+\s*d[ií]as|control(?:\s+ambulatorio)?|cita de revisi[oó]n|seguimiento|revisi[oó]n m[eé]dica)[^.?!]*[.?!]?/gi
    );
  receta.seguimiento = seguimiento;
  if (!receta.resumen) {
    const dx = primeraFrase(analisis);
    receta.resumen = [dx ? `Le diagnosticaron ${dx}.` : "", receta.indicaciones || plan]
      .filter(Boolean)
      .join(" ")
      .slice(0, 800);
  }

  const pronostico =
    soap.pronostico
    || frasesPorPatron(fuente, /[^.?!]*(?:pron[oó]stico|reservad[oa]|buen pron[oó]stico|mal pron[oó]stico)[^.?!]*[.?!]?/gi)
    || (analisis ? "Reservado a la evolución clínica." : "");

  return {
    ...soap,
    plan,
    pronostico,
    seguimiento,
    receta,
  };
}

/** Una sola llamada a Groq → un JSON con toda la nota. */
export async function extraerSoapOneshot(env: Env, textoBorrador: string): Promise<SoapOneshot> {
  const texto = textoBorrador.trim();
  if (!texto) return soapOneshotVacio();

  const parsed = await groqChatJson(
    env,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: texto },
    ],
    { temperature: 0.2, maxTokens: 6000, timeoutMs: 28_000, stream: false }
  );

  const raiz =
    parsed.nota_medica_espanol && typeof parsed.nota_medica_espanol === "object"
      ? (parsed.nota_medica_espanol as Record<string, unknown>)
      : parsed.nota && typeof parsed.nota === "object"
        ? (parsed.nota as Record<string, unknown>)
        : parsed;

  const soap = completarSoapOneshot(normalizarSoapOneshot(raiz), texto);
  console.log("SOAP oneshot (worker):", JSON.stringify(soap));
  return soap;
}
