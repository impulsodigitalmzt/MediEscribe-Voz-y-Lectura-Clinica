export type IndicacionTerapeutica = {
  medicamento: string;
  dosis: string;
  via: string;
  periodicidad: string;
};

export type SignosVitales = {
  ta_sistolica: string;
  ta_diastolica: string;
  temperatura: string;
  fc: string;
  fr: string;
  spo2: string;
  peso: string;
  talla: string;
  imc: string;
  glucosa: string;
};

export function vacioSignosVitales(): SignosVitales {
  return {
    ta_sistolica: "",
    ta_diastolica: "",
    temperatura: "",
    fc: "",
    fr: "",
    spo2: "",
    peso: "",
    talla: "",
    imc: "",
    glucosa: "",
  };
}

export type NotaClinica = {
  nombre_paciente: string;
  edad: string;
  sexo: string;
  domicilio: string;
  ocupacion: string;
  fecha: string;
  hora: string;
  medico_nombre: string;
  medico_cedula: string;
  medico_especialidad: string;
  motivo_consulta: string;
  padecimiento_actual: string;
  interrogatorio: string;
  antecedentes_personales: string;
  antecedentes_quirurgicos: string;
  medicamentos: string;
  alergias: string;
  antecedentes_familiares: string;
  antecedentes_sociales: string;
  exploracion_fisica: string;
  signos_vitales: SignosVitales;
  estudios: string;
  solicitudes_estudio: string[];
  diagnostico_presuntivo: string;
  diagnosticos_diferenciales: string;
  diagnostico: string;
  diagnostico_cie10: string;
  pronostico: string;
  plan: string;
  tratamiento: IndicacionTerapeutica[];
  seguimiento: string;
  notas_evolucion: string;
  resumen: string;
  subjetivo: string;
  objetivo: string;
  analisis: string;
  campos_inciertos: string[];
  secciones_faltantes: string[];
  sello_responsable: string;
};

export type RecetaPaciente = {
  idioma: string;
  idioma_nombre: string;
  titulo: string;
  resumen: string;
  indicaciones: string;
  medicamentos: Array<{
    medicamento: string;
    dosis: string;
    via: string;
    periodicidad: string;
    instruccion: string;
  }>;
  alarmas: string;
  seguimiento: string;
};

export type DocumentacionConsulta = {
  nota: NotaClinica;
  receta: RecetaPaciente;
  idioma_detectado: string;
};

export type DatosMedico = {
  medicoNombre?: string;
  medicoCedula?: string;
  medicoEspecialidad?: string;
  sexo?: string;
  domicilio?: string;
};
