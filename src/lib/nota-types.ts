export type IndicacionTerapeutica = {
  medicamento: string;
  dosis: string;
  via: string;
  periodicidad: string;
};

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
  estudios: string;
  diagnostico_presuntivo: string;
  diagnosticos_diferenciales: string;
  diagnostico: string;
  pronostico: string;
  plan: string;
  tratamiento: IndicacionTerapeutica[];
  seguimiento: string;
  notas_evolucion: string;
  resumen: string;
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
