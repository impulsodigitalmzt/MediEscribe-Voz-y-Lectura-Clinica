import { groqChatJson } from "./groq";
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
  plan: string;
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
    plan: "",
    signos_vitales: vacioSignosVitales(),
    receta: { ...RECETA_VACIA, medicamentos: [] },
  };
}

const SYSTEM_PROMPT = `Eres médico redactor de MediEscribe (NOM-004-SSA3). Lees UN dictado conversacional y devuelves UN solo objeto JSON con la nota SOAP completa.

REGLAS:
1. Una sola respuesta: SOLO el JSON, sin markdown ni texto extra.
2. Extrae y redacta en tono clínico formal, tercera persona. No copies saludos ni el diálogo crudo.
3. Si un dato no está en el dictado, usa "" o [] . No inventes fármacos, dosis, estudios, signos ni citas.
4. Si el texto es solo saludo o prueba de micrófono, todos los campos van vacíos.
5. Signos vitales: solo números (sin unidades). TA 120/80 → ta_sistolica "120" y ta_diastolica "80". Notación 12/8 → 120 y 80. Si hay fiebre referida y una temperatura medida ahora, usa la medida ahora.
6. exploracion_fisica: solo hallazgos explorados o medidos. Los síntomas referidos van en padecimiento_actual.
7. plan: formal y estructurado (fármaco, dosis, vía, frecuencia, duración; estudios; reposo/hidratación) SOLO con lo dictado.
8. medicamentos: un item por fármaco recetado. Si no hay, [].
9. Receta para el paciente: rellena receta.titulo / titulo_receta, receta.resumen / resumen_paciente, receta.indicaciones / indicaciones_receta, alarmas y seguimiento. Si el dictado trae tratamiento, no dejes esos campos vacíos.

Llaves EXACTAS:
{
  "motivo_consulta": "",
  "padecimiento_actual": "",
  "interrogatorio": "",
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
  },
  "exploracion_fisica": "",
  "analisis": "",
  "plan": "",
  "medicamentos": [
    { "medicamento": "", "dosis": "", "via": "", "periodicidad": "", "instruccion": "" }
  ],
  "receta": {
    "titulo": "",
    "resumen": "",
    "indicaciones": "",
    "alarmas": "",
    "seguimiento": ""
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

  return {
    motivo_consulta: texto(raw.motivo_consulta) || texto(raw.motivo),
    padecimiento_actual: padecimiento,
    interrogatorio: texto(raw.interrogatorio),
    subjetivo: padecimiento,
    objetivo: exploracion,
    exploracion_fisica: exploracion,
    analisis,
    plan: texto(raw.plan) || texto(raw.plan_tratamiento),
    signos_vitales: signos,
    receta: {
      titulo:
        texto(recetaRaw.titulo)
        || texto(recetaRaw.titulo_receta)
        || texto(raw.titulo_receta)
        || texto(raw.receta_titulo),
      resumen:
        texto(recetaRaw.resumen)
        || texto(recetaRaw.resumen_paciente)
        || texto(raw.resumen_paciente)
        || texto(raw.receta_resumen),
      indicaciones:
        texto(recetaRaw.indicaciones)
        || texto(recetaRaw.indicaciones_receta)
        || texto(raw.indicaciones_receta)
        || texto(raw.receta_indicaciones),
      medicamentos,
      alarmas:
        texto(recetaRaw.alarmas)
        || texto(raw.alarmas)
        || texto(raw.receta_alarmas)
        || texto(recetaRaw.alarmas_receta),
      seguimiento:
        texto(recetaRaw.seguimiento)
        || texto(raw.seguimiento)
        || texto(raw.receta_seguimiento)
        || texto(recetaRaw.seguimiento_receta),
    },
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
    { temperature: 0.2, maxTokens: 2800, timeoutMs: 40_000, stream: false }
  );

  const raiz =
    parsed.nota_medica_espanol && typeof parsed.nota_medica_espanol === "object"
      ? (parsed.nota_medica_espanol as Record<string, unknown>)
      : parsed.nota && typeof parsed.nota === "object"
        ? (parsed.nota as Record<string, unknown>)
        : parsed;

  const soap = normalizarSoapOneshot(raiz);
  console.log("SOAP oneshot (worker):", JSON.stringify(soap));
  return soap;
}
