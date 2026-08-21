const SYMPTOM_KEYWORDS = [
  "pain", "ache", "fever", "cough", "nausea", "vomiting", "diarrhea",
  "fatigue", "weakness", "dizziness", "headache", "shortness of breath",
  "chest pain", "swelling", "rash", "dolor", "fiebre", "tos", "nauseas",
  "náusea", "cefalea", "mareo", "diarrea", "vómito", "vomito",
];

const NON_CLINICAL = [
  /\b(?:weather|traffic|parking|weekend|holiday|vacation)\b/i,
  /\b(?:how are you|nice to see you|have a good|take care)\b/i,
  /\b(?:insurance|copay|billing|appointment|schedule)\b/i,
  /^(?:hola|buenos?\s*d[ií]as?|buenas\s*(?:tardes|noches)|hello|hi|hey)\b/i,
  /\b(?:prueba(?:\s+de)?\s*(?:micr[oó]fono|audio|sonido)|testing|mic\s*check|uno\s+dos\s+tres)\b/i,
  /\b(?:ya\s+(?:qued[oó]|funciona|trabaja(?:\s+bien)?|listo)|me\s+escuchas|se\s+escucha)\b/i,
];

export type ExtractedEntities = {
  chief_complaint: string;
  symptoms: string[];
  medications: string[];
  allergies: string[];
  procedures: string[];
  diagnoses: string[];
  family_history_mentions: string[];
  social_history_mentions: string[];
  exam_findings: string[];
  plan_items: string[];
  follow_up: string[];
};

export function extractClinicalEntities(transcript: string): ExtractedEntities {
  const sentences = splitSentences(transcript).filter((s) => {
    return s.length > 5 && !NON_CLINICAL.some((p) => p.test(s));
  });

  const pick = (pattern: RegExp) => sentences.filter((s) => pattern.test(s));

  return {
    chief_complaint: sentences.find((s) =>
      /(?:here|came|coming|visit|complain|concern|reason for|what brings|motivo|viene por|consulta por|acude por|me duele|dolor de)/i.test(s)
    ) ?? "",
    symptoms: sentences.filter((s) => SYMPTOM_KEYWORDS.some((k) => s.toLowerCase().includes(k))),
    medications: pick(/\b(?:prescribed?|taking|started?|dose|mg|mcg|units?|tablets?|medicamento|tableta|c[aá]psula|toma )\b/i),
    allergies: pick(/\b(?:allergic|allergy|allergies|reacci[oó]n|alerg)/i),
    procedures: pick(/\b(?:surgery|biopsy|scan|x-ray|mri|ct|ultrasound|ecg|ekg|colonoscopy|endoscopy|cirug[ií]a|radiograf[ií]a|ultrasonido)\b/i),
    diagnoses: pick(/\b(?:diagnos|assessment|impression|suspect|differential|rule out|r\/o|diagn[oó]stic|impresi[oó]n|cuadro de)\b/i),
    family_history_mentions: pick(/\b(?:father|mother|parent|brother|sister|family|grandmother|grandfather|padre|madre|hermano|familia)\b/i),
    social_history_mentions: pick(/\b(?:smok|alcohol|drink|occupation|married|exercise|tobacco|vap|fuma|bebe|ocupaci[oó]n)\b/i),
    exam_findings: pick(/\b(?:exam|palpat|auscultat|inspect|tender|swollen|murmur|vital|exploraci[oó]n|abdomen|pulm[oó]n|\bta\b|\bfc\b)\b/i),
    plan_items: pick(/\b(?:prescri|order|refer|start|increase|decrease|discontinue|recommend|indicar|recetar|tratamiento|plan|tomar)\b/i),
    follow_up: pick(/\b(?:follow.?up|return|come back|weeks?|months?|call if|warning|seguimiento|regresar|cita|volver)\b/i),
  };
}

export function mapToNoteSections(entities: ExtractedEntities): Record<string, string> {
  return {
    chief_complaint: entities.chief_complaint,
    hpi: entities.symptoms.join(" "),
    medications: entities.medications.join("\n"),
    allergies: entities.allergies.join("\n"),
    family_history: entities.family_history_mentions.join("\n"),
    social_history: entities.social_history_mentions.join("\n"),
    assessment: entities.diagnoses.join("\n"),
    plan: entities.plan_items.join("\n"),
    follow_up: entities.follow_up.join("\n"),
    physical_examination: entities.exam_findings.map((f) => `- ${f}`).join("\n"),
  };
}

export function validateNoteSafety(
  polished: Record<string, unknown>,
  transcript: string
): { is_safe: boolean; missing_sections: string[]; uncertain_fields: string[]; warnings: string[] } {
  const required = [
    "chief_complaint", "hpi", "past_medical_history", "medications",
    "allergies", "assessment", "plan", "follow_up",
  ];
  const missing = required.filter((k) => {
    const v = polished[k];
    return !v || String(v).trim() === "" || String(v).includes("[NOT DISCUSSED]");
  });
  const uncertain = Array.isArray(polished.uncertain_fields)
    ? (polished.uncertain_fields as string[])
    : [];
  const warnings: string[] = [];
  if (transcript.length < 40) warnings.push("Transcript is very short; note may be incomplete.");
  return {
    is_safe: warnings.length === 0,
    missing_sections: missing,
    uncertain_fields: uncertain,
    warnings,
  };
}

function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\[(?:Physician|Patient|Unknown)\]:\s*/g, "");
  return cleaned.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}
