import { AppError } from "./errors";

export type SesionMedico = {
  userId: string;
  role: string;
};

export function esRolPrivilegiado(role?: string | null): boolean {
  return role === "admin" || role === "system";
}

export function denegarSiAjeno(ownerId: string | null | undefined, sesion: SesionMedico): void {
  if (esRolPrivilegiado(sesion.role)) return;
  if (!ownerId) return;
  if (String(ownerId) !== sesion.userId) {
    throw new AppError(404, "Recurso no encontrado.", "ACCESO_DENEGADO");
  }
}

export function filtroMedicoSql(sesion: SesionMedico): { soloPropios: boolean; medicoId: string } {
  return {
    soloPropios: !esRolPrivilegiado(sesion.role),
    medicoId: sesion.userId,
  };
}
