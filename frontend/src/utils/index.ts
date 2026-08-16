/**
 * Frontend Utilities — Formatting, validation, and shared helpers.
 */

/**
 * Format seconds into HH:MM:SS or MM:SS display string.
 */
export function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(String(h).padStart(2, '0'));
  parts.push(String(m).padStart(2, '0'));
  parts.push(String(s).padStart(2, '0'));
  return parts.join(':');
}

/**
 * Format duration in seconds to human-readable string.
 */
export function formatDuration(seconds: number): string {
  if (seconds === 0) return '0 min';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

/**
 * Get a greeting based on time of day.
 */
export function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

/**
 * Validate password strength against MedScribe requirements.
 */
export interface PasswordValidation {
  isValid: boolean;
  rules: { label: string; passed: boolean }[];
}

export function validatePassword(password: string): PasswordValidation {
  const rules = [
    { label: 'At least 8 characters', passed: password.length >= 8 },
    { label: 'One uppercase letter', passed: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', passed: /[a-z]/.test(password) },
    { label: 'One number', passed: /[0-9]/.test(password) },
    { label: 'One special character', passed: /[^A-Za-z0-9]/.test(password) },
  ];
  return {
    isValid: rules.every((r) => r.passed),
    rules,
  };
}

/**
 * Validate email format.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Capitalize first letter of each word.
 */
export function titleCase(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Truncate text with ellipsis.
 */
export function truncate(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Status color mapping for encounter statuses.
 */
export const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  recording: { bg: 'bg-red-100', text: 'text-red-800', label: 'Recording' },
  paused: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Paused' },
  transcribing: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Transcribing' },
  generating_note: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Generating' },
  pending_review: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Pending Review' },
  signed_off: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Signed Off' },
  locked: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Locked' },
  finalizada: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Cerrada' },
  borrador: { bg: 'bg-teal-100', text: 'text-teal-800', label: 'Borrador' },
  amended: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Amended' },
};

/**
 * Download a blob as a file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Debounce function for search inputs.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Check if we're on a mobile device.
 */
export function isMobile(): boolean {
  return window.innerWidth < 768;
}

/**
 * Check if MediaRecorder API is available.
 */
export function isRecordingSupported(): boolean {
  return typeof navigator.mediaDevices !== 'undefined' && typeof navigator.mediaDevices.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined';
}
