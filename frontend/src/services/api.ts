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

class ApiService {
  private client: AxiosInstance;
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: `${API_BASE}/api/v1`,
      headers: { 'Content-Type': 'application/json' },
      timeout: 90000, // Groq note generation can take 20–40s on long transcripts
    });

    // Request interceptor — attach access token
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const token = this.getAccessToken();
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor — handle 401 with token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
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
    return sessionStorage.getItem('medscribe_access_token');
  }

  getRefreshToken(): string | null {
    return sessionStorage.getItem('medscribe_refresh_token');
  }

  setTokens(tokens: AuthTokens): void {
    sessionStorage.setItem('medscribe_access_token', tokens.access_token);
    sessionStorage.setItem('medscribe_refresh_token', tokens.refresh_token);
  }

  clearTokens(): void {
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
    this.setTokens(data);
    return data;
  }

  async register(details: RegisterRequest): Promise<AuthTokens> {
    const { data } = await this.client.post<AuthTokens>('/auth/register', details);
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
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const data = (await response.json()) as ConsultaProcessResponse & { detail?: string };
    if (!response.ok) {
      throw new Error(data.detail || 'No se pudo procesar la consulta médica.');
    }
    return data;
  }

  async procesarConsultaTexto(
    transcripcion: string,
    pacienteId: string,
    especialidad = 'medicina_general',
    extras: { medicoNombre?: string; medicoCedula?: string; consultaId?: string } = {}
  ): Promise<ConsultaProcessResponse> {
    const token = this.getAccessToken();
    const response = await fetch(`${API_BASE}/api/consultas-medicas/texto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
    });
    const data = (await response.json()) as ConsultaProcessResponse & { detail?: string };
    if (!response.ok) {
      throw new Error(data.detail || 'No se pudo procesar la consulta médica.');
    }
    return data;
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
