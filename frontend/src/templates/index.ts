/**
 * Specialty Template Configurations — Frontend display metadata.
 *
 * Maps template IDs to display properties (icons, descriptions, colors)
 * for use in the UI when selecting and displaying templates.
 */

export interface TemplateDisplayConfig {
  id: string;
  name: string;
  shortName: string;
  description: string;
  color: string;
  bgColor: string;
  icon: string; // Lucide icon name
}

export const TEMPLATE_DISPLAY: Record<string, TemplateDisplayConfig> = {
  general_practice: {
    id: 'general_practice',
    name: 'General Practice',
    shortName: 'GP',
    description: 'Full SOAP note with preventive care prompts and chronic disease tracking',
    color: 'text-teal-700',
    bgColor: 'bg-teal-50',
    icon: 'Stethoscope',
  },
  emergency_medicine: {
    id: 'emergency_medicine',
    name: 'Emergency Medicine',
    shortName: 'EM',
    description: 'Triage priority, time-stamped interventions, disposition planning',
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    icon: 'Siren',
  },
  pediatrics: {
    id: 'pediatrics',
    name: 'Pediatrics',
    shortName: 'Peds',
    description: 'Growth parameters, developmental milestones, immunization status',
    color: 'text-sky-700',
    bgColor: 'bg-sky-50',
    icon: 'Baby',
  },
  surgery: {
    id: 'surgery',
    name: 'Surgery',
    shortName: 'Surg',
    description: 'Pre-operative assessment, operative note, post-operative plan',
    color: 'text-violet-700',
    bgColor: 'bg-violet-50',
    icon: 'Scissors',
  },
  psychiatry: {
    id: 'psychiatry',
    name: 'Psychiatry',
    shortName: 'Psych',
    description: 'Mental status exam, risk assessment, safety plan, therapy progress',
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-50',
    icon: 'Brain',
  },
  cardiology: {
    id: 'cardiology',
    name: 'Cardiology',
    shortName: 'Cardio',
    description: 'Cardiovascular exam, ECG interpretation, risk scores',
    color: 'text-rose-700',
    bgColor: 'bg-rose-50',
    icon: 'Heart',
  },
  oncology: {
    id: 'oncology',
    name: 'Oncology',
    shortName: 'Onc',
    description: 'Staging, treatment protocol, cycle tracking, adverse events',
    color: 'text-orange-700',
    bgColor: 'bg-orange-50',
    icon: 'Pill',
  },
  telemedicine: {
    id: 'telemedicine',
    name: 'Telemedicine',
    shortName: 'Tele',
    description: 'Connectivity documentation, remote exam limitations, virtual consent',
    color: 'text-cyan-700',
    bgColor: 'bg-cyan-50',
    icon: 'Monitor',
  },
};

/**
 * Get template display config, falling back to general practice.
 */
export function getTemplateDisplay(templateId: string): TemplateDisplayConfig {
  return TEMPLATE_DISPLAY[templateId] || TEMPLATE_DISPLAY.general_practice;
}

/**
 * Get all template IDs in display order.
 */
export function getTemplateIds(): string[] {
  return Object.keys(TEMPLATE_DISPLAY);
}
