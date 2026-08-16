/**
 * Parte un nombre mexicano en nombre(s) + apellido paterno + apellido materno.
 *
 * Convención habitual: [nombres de pila…] [apellido paterno] [apellido materno].
 * Las partículas (de, del, de la, de los…) se quedan unidas al apellido o nombre
 * que las sigue, para no romper "De la Cruz" ni "María de los Ángeles".
 *
 * Ejemplos:
 *   Mario Alberto Delgado Sánchez → Mario Alberto | Delgado | Sánchez
 *   Ana Pérez → Ana | Pérez |
 *   José Luis Pérez De la Cruz → José Luis | Pérez | De la Cruz
 */

const PARTICLES = new Set([
  "de", "del", "la", "las", "los", "y",
  "san", "santa", "da", "do", "das", "dos",
]);

const TITLES = new Set([
  "dr", "dra", "sr", "sra", "srta", "lic", "ing", "prof", "profa",
  "dr.", "dra.", "sr.", "sra.", "srta.", "lic.", "ing.", "prof.",
]);

export type NombrePartes = {
  nombre: string;
  apellido_paterno: string;
  apellido_materno: string;
};

function titleCaseWord(word: string): string {
  if (!word) return word;
  const lower = word.toLocaleLowerCase("es-MX");
  if (PARTICLES.has(lower) || TITLES.has(lower.replace(/\.$/, ""))) {
    return lower === "y" ? "y" : lower;
  }
  return lower.charAt(0).toLocaleUpperCase("es-MX") + lower.slice(1);
}

function formatUnit(unit: string): string {
  return unit
    .split(/\s+/)
    .map(titleCaseWord)
    .join(" ")
    .replace(/^(de|del|la|las|los|san|santa)\b/i, (match) =>
      match.charAt(0).toLocaleUpperCase("es-MX") + match.slice(1).toLocaleLowerCase("es-MX")
    );
}

export function tokenizeNombreUnits(fullName: string): string[] {
  const tokens = fullName
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter((token) => token && !TITLES.has(token.toLocaleLowerCase("es-MX").replace(/\.$/, "")));

  const units: string[] = [];
  let buffer: string[] = [];
  for (const token of tokens) {
    if (PARTICLES.has(token.toLocaleLowerCase("es-MX"))) {
      buffer.push(token);
      continue;
    }
    buffer.push(token);
    units.push(formatUnit(buffer.join(" ")));
    buffer = [];
  }
  if (buffer.length) units.push(formatUnit(buffer.join(" ")));
  return units;
}

export function parseNombreCompleto(fullName: string): NombrePartes {
  const units = tokenizeNombreUnits(fullName);
  if (units.length === 0) {
    return { nombre: "", apellido_paterno: "", apellido_materno: "" };
  }
  if (units.length === 1) {
    return { nombre: units[0], apellido_paterno: "", apellido_materno: "" };
  }
  if (units.length === 2) {
    return { nombre: softenGivenParticles(units[0]), apellido_paterno: units[1], apellido_materno: "" };
  }
  return {
    nombre: softenGivenParticles(units.slice(0, -2).join(" ")),
    apellido_paterno: units[units.length - 2],
    apellido_materno: units[units.length - 1],
  };
}

function softenGivenParticles(nombre: string): string {
  return nombre.replace(/\s(De|Del|La|Las|Los|Y|San|Santa)\s/g, (_match, particle: string) =>
    ` ${particle.toLocaleLowerCase("es-MX")} `
  );
}

export function composeNombreCompleto(parts: NombrePartes): string {
  return [parts.nombre, parts.apellido_paterno, parts.apellido_materno]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}
