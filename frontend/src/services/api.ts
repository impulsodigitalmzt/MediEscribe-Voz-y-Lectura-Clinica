/**
 * API Service — Centralized HTTP client with JWT auth interceptors.
 *
 * Handles:
 * - All API communication with the backend
 * - Automatic token refresh on 401
 * - Token storage and retrieval
 * - Request/response interceptors
 */

import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import type {
  AuthTokens, LoginRequest, RegisterRequest, User,
  Encounter, EncounterCreateRequest, EncounterListResponse,
  ClinicalNote, NoteEditRequest, TranscriptSegment,
  SpecialtyTemplate, NoteVersion, ConsultaMedica, ConsultaProcessResponse,
  PacienteExpediente, ConsultaHistorialItem, NotaClinica, DictamenNom004,
  AntecedentesImportantes, RecetaPaciente, NotaAclaracion,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function isCredentialAuthUrl(url?: string): boolean {
  if (!url) return false;
  return url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/refresh');
}

export class ConsultaValidacionError extends Error {
  guia: string[];
  nota?: NotaClinica;
  constructor(message: string, guia: string[] = [], nota?: NotaClinica) {
    super(message);
    this.name = 'ConsultaValidacionError';
    this.guia = guia;
    this.nota = nota;
  }
}

function throwConsultaFailure(
  data: { detail?: string; error?: string; code?: string; guia?: string[]; nota?: NotaClinica; faltantes?: Array<{ mensaje: string }> },
  fallback: string,
): never {
  const message = data.detail || data.error || fallback;
  if (data.code === 'NOM004_INCOMPLETA' || data.guia?.length || data.faltantes?.length) {
    throw new ConsultaValidacionError(
      message,
      data.guia?.length ? data.guia : (data.faltantes ?? []).map((item) => item.mensaje),
      data.nota,
    );
  }
  throw new Error(message);
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  const ax = err as {
    response?: { data?: unknown; status?: number };
    message?: string;
  };
  const data = ax.response?.data;
  const status = ax.response?.status;
  const detail =
    data && typeof data === "object" && data !== null && "detail" in data
      ? (data as { detail?: unknown }).detail
      : undefined;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (typeof data === "string" && data.trim()) {
    if (data.trimStart().startsWith("<")) {
      return `El servidor no respondió como API (HTTP ${status ?? "?"}). Vuelva a publicar el Worker.`;
    }
    return data.slice(0, 240);
  }
  if (!ax.response) {
    return ax.message && ax.message !== "Network Error"
      ? ax.message
      : "No se pudo conectar con el servidor. Si está en Cloudflare, vuelva a publicar el Worker.";
  }
  return `${fallback}${status ? ` (HTTP ${status})` : ""}`;
}

async function readApiJson<T>(response: Response, fallback: string): Promise<T> {
  const raw = await response.text();
  let data: T & { detail?: string; code?: string } = {} as T & { detail?: string; code?: string };
  if (raw.trim()) {
    try {
      data = JSON.parse(raw) as T & { detail?: string; code?: string };
    } catch {
      if (raw.trimStart().startsWith('<')) {
        throw new Error(`El servidor no respondió como API (HTTP ${response.status}). Vuelva a publicar el Worker.`);
      }
      throw new Error(raw.slice(0, 240) || fallback);
    }
  }
  if (!response.ok) {
    throwConsultaFailure(data, fallback);
  }
  return data;
}

async function readConsultaIa(response: Response, fallback: string): Promise<ConsultaProcessResponse> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    return readApiJson<ConsultaProcessResponse>(response, fallback);
  }
  if (!response.body) throw new Error(fallback);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete: ConsultaProcessResponse | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((item) => item.startsWith('data:')) ?? '';
      const payload = line.replace(/^data:\s*/, '').trim();
      if (!payload) continue;
      try {
        const event = JSON.parse(payload) as ConsultaProcessResponse & {
          type?: string;
          detail?: string;
          code?: string;
          guia?: string[];
          nota?: NotaClinica;
          faltantes?: Array<{ mensaje: string }>;
        };
        if (event.type === 'error') {
          throwConsultaFailure(event, fallback);
        }
        if (event.type === 'complete') complete = event;
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
  if (!complete?.ok && !complete?.nota) throw new Error(fallback);
  return complete;
}

class ApiService {
  private client: AxiosInstance;
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: `${API_BASE}/api/v1`,
      headers: { 'Content-Type': 'application/json' },
      timeout: 90000, // Groq note generation can take 20–40s on long transcripts
    });

    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        if (isCredentialAuthUrl(config.url)) return config;
        const token = this.getAccessToken();
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (isCredentialAuthUrl(originalRequest?.url)) {
          return Promise.reject(error);
        }
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          try {
            const newToken = await this.refreshAccessToken();
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return this.client(originalRequest);
          } catch {
            this.clearTokens();
            window.location.href = '/login';
            return Promise.reject(error);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // --- Token Management ---

  getAccessToken(): string | null {
    return localStorage.getItem('medscribe_access_token') || sessionStorage.getItem('medscribe_access_token');
  }

  getRefreshToken(): string | null {
    return localStorage.getItem('medscribe_refresh_token') || sessionStorage.getItem('medscribe_refresh_token');
  }

  setTokens(tokens: AuthTokens): void {
    localStorage.setItem('medscribe_access_token', tokens.access_token);
    localStorage.setItem('medscribe_refresh_token', tokens.refresh_token);
    sessionStorage.removeItem('medscribe_access_token');
    sessionStorage.removeItem('medscribe_refresh_token');
  }

  clearTokens(): void {
    localStorage.removeItem('medscribe_access_token');
    localStorage.removeItem('medscribe_refresh_token');
    sessionStorage.removeItem('medscribe_access_token');
    sessionStorage.removeItem('medscribe_refresh_token');
  }

  isAuthenticated(): boolean {
    return !!this.getAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const refreshToken = this.getRefreshToken();
      if (!refreshToken) throw new Error('No refresh token');
      const { data } = await axios.post(`${API_BASE}/api/v1/auth/refresh`, {
        refresh_token: refreshToken,
      });
      this.setTokens(data);
      return data.access_token;
    })();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  // --- Auth ---

  async login(credentials: LoginRequest): Promise<AuthTokens> {
    const { data } = await this.client.post<AuthTokens>('/auth/login', credentials);
    if (!data?.access_token || !data?.refresh_token) {
      throw new Error('El servidor no devolvió una sesión válida.');
    }
    this.setTokens(data);
    return data;
  }

  async register(details: RegisterRequest): Promise<AuthTokens> {
    const { data } = await this.client.post<AuthTokens>('/auth/register', details);
    if (!data?.access_token || !data?.refresh_token) {
      throw new Error('El servidor no devolvió una sesión válida.');
    }
    this.setTokens(data);
    return data;
  }

  async getProfile(): Promise<User> {
    const { data } = await this.client.get<User>('/auth/profile');
    return data;
  }

  async updateProfile(updates: Partial<User>): Promise<User> {
    const { data } = await this.client.patch<User>('/auth/profile', updates);
    return data;
  }

  logout(): void {
    this.clearTokens();
  }

  // --- Encounters ---

  async createEncounter(request: EncounterCreateRequest): Promise<Encounter> {
    const { data } = await this.client.post<Encounter>('/encounters', request);
    return data;
  }

  async listEncounters(page = 1, pageSize = 20, statusFilter?: string): Promise<EncounterListResponse> {
    const params: Record<string, unknown> = { page, page_size: pageSize };
    if (statusFilter) params.status_filter = statusFilter;
    const { data } = await this.client.get<EncounterListResponse>('/encounters', { params });
    return data;
  }

  async getEncounter(id: string): Promise<Encounter> {
    const { data } = await this.client.get<Encounter>(`/encounters/${id}`);
    return data;
  }

  async deleteEncounter(id: string): Promise<void> {
    await this.client.delete(`/encounters/${id}`);
  }

  async pauseRecording(id: string): Promise<void> {
    await this.client.post(`/encounters/${id}/pause`);
  }

  async resumeRecording(id: string): Promise<void> {
    await this.client.post(`/encounters/${id}/resume`);
  }

  async stopRecording(id: string): Promise<void> {
    await this.client.post(`/encounters/${id}/stop`);
  }

  // --- Consent ---

  async recordConsent(encounterId: string, consented: boolean, consentedBy = ''): Promise<void> {
    await this.client.post(`/encounters/${encounterId}/consent`, {
      consent_type: 'recording',
      consented,
      consented_by: consentedBy,
    });
  }

  // --- Transcript ---

  async getTranscript(encounterId: string): Promise<{ segments: TranscriptSegment[] }> {
    const { data } = await this.client.get(`/encounters/${encounterId}/transcript`);
    return data;
  }

  async submitManualTranscript(encounterId: string, text: string, encounterMode?: string): Promise<void> {
    await this.client.post(`/encounters/${encounterId}/manual-transcript`, { text, encounter_mode: encounterMode });
  }

  async uploadEncounterAudio(encounterId: string, file: File): Promise<{ text: string; characters: number }> {
    const form = new FormData();
    form.append('audio', file);
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/v1/encounters/${encounterId}/audio`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const data = (await response.json()) as { text?: string; characters?: number; detail?: string };
    if (!response.ok) {
      throw new Error(data.detail || 'No se pudo transcribir el audio.');
    }
    return { text: data.text ?? '', characters: data.characters ?? 0 };
  }

  async procesarConsultaAudio(
    file: File,
    pacienteId: string,
    especialidad = 'medicina_general',
    extras: { medicoNombre?: string; medicoCedula?: string; consultaId?: string } = {}
  ): Promise<ConsultaProcessResponse> {
    const form = new FormData();
    form.append('audio', file);
    form.append('paciente_id', pacienteId);
    form.append('especialidad', especialidad);
    if (extras.medicoNombre) form.append('medico_nombre', extras.medicoNombre);
    if (extras.medicoCedula) form.append('medico_cedula', extras.medicoCedula);
    if (extras.consultaId) form.append('consulta_id', extras.consultaId);
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/consultas-medicas`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream, application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form,
      signal: AbortSignal.timeout(90_000),
    });
    return readConsultaIa(response, 'No se pudo procesar la consulta médica.');
  }

  async procesarConsultaTexto(
    transcripcion: string,
    pacienteId: string,
    especialidad = 'medicina_general',
    extras: { medicoNombre?: string; medicoCedula?: string; consultaId?: string } = {}
  ): Promise<ConsultaProcessResponse> {
    const textoBorrador = transcripcion;
    console.log('Enviando a IA:', textoBorrador);
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/consultas-medicas/texto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        transcripcion,
        paciente_id: pacienteId,
        especialidad,
        medico_nombre: extras.medicoNombre,
        medico_cedula: extras.medicoCedula,
        consulta_id: extras.consultaId,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const raw = await response.text();
    console.log('[SOAP fetch] status=', response.status, 'ok=', response.ok, 'content-type=', contentType);
    console.log('[SOAP fetch] cuerpo crudo:', raw);
    if (!response.ok) {
      console.error('[SOAP fetch] Worker error HTTP', response.status, {
        contentType,
        body: raw,
      });
      throw new Error(raw.slice(0, 800) || 'No se pudo procesar la consulta médica.');
    }
    if (!contentType.toLowerCase().includes('application/json')) {
      console.error('[SOAP fetch] Content-Type inesperado (se esperaba application/json):', contentType, raw.slice(0, 400));
    }
    let respuesta: ConsultaProcessResponse;
    try {
      respuesta = JSON.parse(raw) as ConsultaProcessResponse;
    } catch (err) {
      console.error('[SOAP fetch] JSON inválido:', err, raw.slice(0, 800));
      throw new Error('El Worker no devolvió JSON válido.');
    }
    console.log('Respuesta de IA recibida:', respuesta);
    return respuesta;
  }

  async extraerMotivoAislado(texto: string): Promise<string> {
    const soap = await this.extraerSoapAislado(texto);
    return soap.motivo_consulta;
  }

  async extraerSoapAislado(texto: string): Promise<{
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
    signos_vitales: {
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
    receta: {
      titulo: string;
      resumen: string;
      indicaciones: string;
      medicamentos: Array<{ medicamento: string; dosis: string; via: string; periodicidad: string; instruccion: string }>;
      alarmas: string;
      seguimiento: string;
    };
  }> {
    const vacioSignos = {
      ta_sistolica: '', ta_diastolica: '', temperatura: '', fc: '', fr: '',
      spo2: '', peso: '', talla: '', imc: '', glucosa: '',
    };
    const vacioReceta = {
      titulo: '', resumen: '', indicaciones: '', medicamentos: [] as Array<{
        medicamento: string; dosis: string; via: string; periodicidad: string; instruccion: string;
      }>, alarmas: '', seguimiento: '',
    };
    const vacio = {
      motivo_consulta: '',
      padecimiento_actual: '',
      interrogatorio: '',
      subjetivo: '',
      objetivo: '',
      exploracion_fisica: '',
      analisis: '',
      pronostico: '',
      plan: '',
      notas_evolucion: '',
      seguimiento: '',
      signos_vitales: { ...vacioSignos },
      receta: { ...vacioReceta, medicamentos: [] },
    };
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/consultas-medicas/soap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ texto }),
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await response.text();
    console.log('[SOAP aislado] HTTP', response.status, raw);
    if (!response.ok) {
      throw new Error(raw.slice(0, 400) || 'No se pudo sintetizar el SOAP.');
    }
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      console.log('[SOAP] JSON completo del Worker:', json);
      console.log('[SOAP] Llaves del Worker:', Object.keys(json));
      const recetaRaw = json.receta && typeof json.receta === 'object'
        ? json.receta as Record<string, unknown>
        : {};
      console.log('[SOAP] receta anidada:', recetaRaw);
      const textoDe = (...keys: string[]) => {
        for (const fuente of [json, recetaRaw]) {
          for (const key of keys) {
            const value = fuente[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
          }
        }
        return '';
      };
      const signosRaw = json.signos_vitales && typeof json.signos_vitales === 'object'
        ? json.signos_vitales as Record<string, unknown>
        : {};
      const signo = (key: string) => {
        const value = signosRaw[key];
        return typeof value === 'string' && value.trim() && value.trim() !== '0' ? value.trim() : '';
      };
      const medsRaw = Array.isArray(recetaRaw.medicamentos)
        ? recetaRaw.medicamentos
        : json.medicamentos;
      const medicamentos = Array.isArray(medsRaw)
        ? medsRaw
          .map((item) => {
            const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            const t = (k: string) => typeof row[k] === 'string' ? row[k].trim() : '';
            return {
              medicamento: t('medicamento') || t('nombre'),
              dosis: t('dosis'),
              via: t('via') || t('vía'),
              periodicidad: t('periodicidad') || t('frecuencia'),
              instruccion: t('instruccion') || t('duracion') || t('duración'),
            };
          })
          .filter((row) => row.medicamento)
        : [];
      const deFuente = (fuente: Record<string, unknown>, ...keys: string[]) => {
        for (const key of keys) {
          const value = fuente[key];
          if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
      };
      const recetaMapeada = {
        titulo:
          deFuente(json, 'titulo_receta', 'receta_titulo')
          || deFuente(recetaRaw, 'titulo_receta', 'titulo', 'receta_titulo'),
        resumen:
          deFuente(json, 'resumen_paciente', 'receta_resumen', 'resumen_para_el_paciente')
          || deFuente(recetaRaw, 'resumen_paciente', 'resumen', 'receta_resumen'),
        indicaciones:
          deFuente(json, 'indicaciones_receta', 'receta_indicaciones')
          || deFuente(recetaRaw, 'indicaciones_receta', 'indicaciones', 'receta_indicaciones'),
        medicamentos,
        alarmas:
          deFuente(json, 'alarmas', 'receta_alarmas', 'alarmas_receta')
          || deFuente(recetaRaw, 'alarmas', 'receta_alarmas', 'alarmas_receta'),
        seguimiento:
          deFuente(json, 'seguimiento', 'receta_seguimiento', 'seguimiento_receta')
          || deFuente(recetaRaw, 'seguimiento', 'receta_seguimiento', 'seguimiento_receta'),
      };
      const soap = {
        motivo_consulta: textoDe('motivo_consulta', 'motivo'),
        padecimiento_actual: textoDe('padecimiento_actual', 'subjetivo'),
        interrogatorio: textoDe('interrogatorio'),
        subjetivo: textoDe('subjetivo', 'padecimiento_actual'),
        objetivo: textoDe('objetivo', 'exploracion_fisica'),
        exploracion_fisica: textoDe('exploracion_fisica', 'objetivo'),
        analisis: textoDe('analisis', 'diagnostico'),
        pronostico: textoDe('pronostico', 'pronóstico'),
        plan: textoDe('plan', 'plan_tratamiento'),
        notas_evolucion: textoDe('notas_evolucion', 'notas_de_evolucion'),
        seguimiento: recetaMapeada.seguimiento,
        signos_vitales: {
          ta_sistolica: signo('ta_sistolica'),
          ta_diastolica: signo('ta_diastolica'),
          temperatura: signo('temperatura'),
          fc: signo('fc'),
          fr: signo('fr'),
          spo2: signo('spo2'),
          peso: signo('peso'),
          talla: signo('talla'),
          imc: signo('imc'),
          glucosa: signo('glucosa'),
        },
        receta: recetaMapeada,
      };
      console.log('[SOAP] Receta mapeada a casillas:', soap.receta);
      console.log('SOAP aislado recibido:', soap);
      return soap;
    } catch {
      const plano = raw.trim();
      return { ...vacio, motivo_consulta: plano };
    }
  }

  async getConsulta(id: string): Promise<ConsultaMedica> {
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/consultas-medicas/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = (await response.json()) as {
      consulta: ConsultaMedica;
      historial?: ConsultaHistorialItem[];
      aclaraciones?: ConsultaMedica['aclaraciones'];
      detail?: string;
    };
    if (!response.ok) throw new Error(data.detail || 'No se pudo cargar la consulta.');
    return {
      ...data.consulta,
      historial: data.historial ?? data.consulta.historial ?? [],
      aclaraciones: data.aclaraciones ?? data.consulta.aclaraciones ?? [],
    };
  }

  async abrirConsulta(input: {
    pacienteId: string;
    especialidad?: string;
    medicoNombre?: string;
    medicoCedula?: string;
  }): Promise<{ consulta: ConsultaMedica; historial: ConsultaHistorialItem[] }> {
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/consultas-medicas/abrir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        paciente_id: input.pacienteId,
        especialidad: input.especialidad,
        medico_nombre: input.medicoNombre,
        medico_cedula: input.medicoCedula,
      }),
    });
    const data = (await response.json()) as {
      consulta: ConsultaMedica;
      historial?: ConsultaHistorialItem[];
      detail?: string;
    };
    if (!response.ok) throw new Error(data.detail || 'No se pudo abrir la consulta.');
    return {
      consulta: { ...data.consulta, historial: data.historial ?? data.consulta.historial ?? [] },
      historial: data.historial ?? data.consulta.historial ?? [],
    };
  }

  async registrarConsentimientoConsulta(id: string, titularNombre: string): Promise<{
    consentimiento_informado_aceptado: boolean;
    consentimiento_informado_en: string | null;
    consentimiento_informado_titular: string;
    consentimiento_ia_aceptado: boolean;
    consentimiento_version: string;
  }> {
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/consultas-medicas/${id}/consentimiento`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        titular_nombre: titularNombre,
        consentimiento_informado: true,
        consentimiento_ia: true,
      }),
    });
    const data = await readApiJson<{
      consentimiento: {
        consentimiento_informado_aceptado: boolean;
        consentimiento_informado_en: string | null;
        consentimiento_informado_titular: string;
        consentimiento_ia_aceptado: boolean;
        consentimiento_version: string;
      };
    }>(response, 'No se pudo registrar el consentimiento.');
    return data.consentimiento;
  }

  async guardarConsultaNota(id: string, nota: NotaClinica, receta?: RecetaPaciente): Promise<{
    consulta: ConsultaMedica;
    nota: NotaClinica | null;
    receta?: RecetaPaciente | null;
    guardia_legal?: DictamenNom004;
  }> {
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/consultas-medicas/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ nota, receta }),
    });
    const data = (await response.json()) as {
      consulta: ConsultaMedica;
      nota: NotaClinica | null;
      receta?: RecetaPaciente | null;
      guardia_legal?: DictamenNom004;
      detail?: string;
    };
    if (!response.ok) throw new Error(data.detail || 'No se pudo guardar la nota.');
    return data;
  }

  async finalizarConsulta(id: string, nota?: NotaClinica, receta?: RecetaPaciente): Promise<{
    consulta: ConsultaMedica;
    nota: NotaClinica | null;
    receta?: RecetaPaciente | null;
    guardia_legal?: DictamenNom004;
  }> {
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/consultas-medicas/${id}/finalizar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ nota, receta }),
    });
    const data = (await response.json()) as {
      consulta: ConsultaMedica;
      nota: NotaClinica | null;
      receta?: RecetaPaciente | null;
      guardia_legal?: DictamenNom004;
      detail?: string;
      guia?: string[];
    };
    if (!response.ok) throw new Error(data.detail || data.guia?.join(' ') || 'No se pudo finalizar la nota.');
    return data;
  }

  async crearNotaAclaracion(
    consultaId: string,
    input: { tipo: 'aclaracion' | 'rectificacion'; motivo: string; contenido: string }
  ): Promise<NotaAclaracion> {
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/consultas-medicas/${consultaId}/aclaraciones`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(input),
    });
    const data = (await response.json()) as { aclaracion: NotaAclaracion; detail?: string };
    if (!response.ok) throw new Error(data.detail || 'No se pudo registrar la nota de aclaración.');
    return data.aclaracion;
  }

  async cerrarNotaAclaracion(consultaId: string, aclaracionId: string): Promise<NotaAclaracion> {
    const token = this.getAccessToken();
    const response = await fetch(
      `${API_BASE}/api/consultas-medicas/${consultaId}/aclaraciones/${aclaracionId}/cerrar`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      }
    );
    const data = (await response.json()) as { aclaracion: NotaAclaracion; detail?: string };
    if (!response.ok) throw new Error(data.detail || 'No se pudo cerrar la nota de aclaración.');
    return data.aclaracion;
  }

  async buscarPacientes(query: {
    q?: string;
    nombre?: string;
    apellido_paterno?: string;
    apellido_materno?: string;
    fecha_nacimiento?: string;
    curp?: string;
  }): Promise<{
    pacientes: PacienteExpediente[];
    requiere_desambiguacion: boolean;
    alta_requerida: boolean;
  }> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value?.trim()) params.set(key, value.trim());
    });
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/pacientes/buscar?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = (await response.json()) as {
      pacientes: PacienteExpediente[];
      requiere_desambiguacion: boolean;
      alta_requerida: boolean;
      detail?: string;
    };
    if (!response.ok) throw new Error(data.detail || 'No se pudo buscar el expediente.');
    return data;
  }

  async crearPaciente(input: {
    nombre: string;
    apellido_paterno: string;
    apellido_materno?: string;
    fecha_nacimiento: string;
    sexo: string;
    domicilio: string;
    curp?: string;
    ocupacion?: string;
    antecedentes_importantes?: Partial<AntecedentesImportantes>;
    consentimiento_privacidad_aceptado: boolean;
  }): Promise<PacienteExpediente> {
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/pacientes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(input),
    });
    const data = (await response.json()) as { paciente: PacienteExpediente; detail?: string };
    if (!response.ok) throw new Error(data.detail || 'No se pudo dar de alta el expediente.');
    return data.paciente;
  }

  async getPaciente(id: string): Promise<{ paciente: PacienteExpediente; historial: ConsultaHistorialItem[] }> {
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/pacientes/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = (await response.json()) as {
      paciente: PacienteExpediente;
      historial: ConsultaHistorialItem[];
      detail?: string;
    };
    if (!response.ok) throw new Error(data.detail || 'No se pudo cargar el expediente.');
    return data;
  }

  async listConsultas(page = 1, pageSize = 20): Promise<{ consultas: ConsultaMedica[]; total: number }> {
    const token = this.getAccessToken();
    const response = await fetch(
      `${API_BASE}/api/consultas-medicas?page=${page}&page_size=${pageSize}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    const data = (await response.json()) as { consultas: ConsultaMedica[]; total: number; detail?: string };
    if (!response.ok) {
      throw new Error(data.detail || 'No se pudieron listar las consultas.');
    }
    return data;
  }

  // --- Note ---

  async generateNote(encounterId: string): Promise<ClinicalNote> {
    const { data } = await this.client.post<ClinicalNote>(`/encounters/${encounterId}/generate-note`);
    return data;
  }

  async getNote(encounterId: string): Promise<ClinicalNote> {
    const { data } = await this.client.get<ClinicalNote>(`/encounters/${encounterId}/note`);
    return data;
  }

  async editNote(encounterId: string, edit: NoteEditRequest): Promise<ClinicalNote> {
    const { data } = await this.client.patch<ClinicalNote>(`/encounters/${encounterId}/note`, edit);
    return data;
  }

  async saveNoteSections(encounterId: string, sections: Record<string, unknown>): Promise<ClinicalNote> {
    const { data } = await this.client.patch<ClinicalNote>(`/encounters/${encounterId}/note`, {
      sections,
      change_description: 'Correcciones del médico en la nota generada',
    });
    return data;
  }

  async signOffNote(encounterId: string): Promise<void> {
    await this.client.post(`/encounters/${encounterId}/sign-off`, { confirmation: true });
  }

  async getNoteVersions(encounterId: string): Promise<{ versions: NoteVersion[]; current_version: number }> {
    const { data } = await this.client.get(`/encounters/${encounterId}/note/versions`);
    return data;
  }

  // --- PDF Export ---

  async exportPdf(encounterId: string): Promise<Blob> {
    const { data } = await this.client.get(`/encounters/${encounterId}/export/pdf`, {
      responseType: 'blob',
    });
    return data;
  }

  // --- Templates ---

  async listTemplates(): Promise<SpecialtyTemplate[]> {
    const { data } = await this.client.get('/templates');
    return data.templates;
  }

  async getTemplate(id: string): Promise<SpecialtyTemplate> {
    const { data } = await this.client.get<SpecialtyTemplate>(`/templates/${id}`);
    return data;
  }

  // --- WebSocket URL ---

  getWsUrl(encounterId: string): string {
    const wsBase = import.meta.env.VITE_WS_URL || window.location.origin.replace('http', 'ws');
    const token = this.getAccessToken();
    return `${wsBase}/api/v1/ws/audio/${encounterId}?token=${token}`;
  }
}

export const api = new ApiService();
export default api;
