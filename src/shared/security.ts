// Kennwortschutz und Berechtigungen (Phase 6, ADR 0011). Gemeinsam für Oberfläche und Worker.

export type PrintPermission = 'none' | 'low' | 'high';

export interface SecurityPermissions {
  printing: PrintPermission;
  // Inhalt ändern (außer Kommentieren, Formulare ausfüllen, Seiten zusammenstellen)
  modifying: boolean;
  copying: boolean;
  annotating: boolean;
  fillingForms: boolean;
  assembling: boolean;
  // Text für Vorlesehilfen auslesen
  accessibility: boolean;
}

export const ALL_PERMISSIONS: SecurityPermissions = {
  printing: 'high',
  modifying: true,
  copying: true,
  annotating: true,
  fillingForms: true,
  assembling: true,
  accessibility: true,
};

// Neuer Schutz. Berechtigungen gelten nur mit Berechtigungskennwort. Beide null = Schutz entfernen.
export interface SecuritySettings {
  openPassword: string | null;
  permissionsPassword: string | null;
  permissions: SecurityPermissions;
}

// Schutz eines geöffneten Dokuments, wie PDFium ihn sieht
export interface DocumentSecurity {
  encrypted: boolean;
  // Mit dem Berechtigungskennwort geöffnet (oder ohne Einschränkungen): Schutz darf geändert werden
  ownerAccess: boolean;
  // Berechtigungen für Leser ohne Berechtigungskennwort
  permissions: SecurityPermissions;
}

// Bits im Eintrag /P (PDF 32000-1, Tabelle 22)
export const PERMISSION_BIT = {
  print: 1 << 2,
  modify: 1 << 3,
  copy: 1 << 4,
  annotate: 1 << 5,
  fillForms: 1 << 8,
  accessibility: 1 << 9,
  assemble: 1 << 10,
  printHigh: 1 << 11,
} as const;

export function permissionsFromBits(bits: number): SecurityPermissions {
  const has = (bit: number) => (bits & bit) !== 0;
  return {
    printing: !has(PERMISSION_BIT.print) ? 'none' : has(PERMISSION_BIT.printHigh) ? 'high' : 'low',
    modifying: has(PERMISSION_BIT.modify),
    copying: has(PERMISSION_BIT.copy),
    annotating: has(PERMISSION_BIT.annotate),
    fillingForms: has(PERMISSION_BIT.fillForms) || has(PERMISSION_BIT.annotate),
    assembling: has(PERMISSION_BIT.assemble) || has(PERMISSION_BIT.modify),
    accessibility: has(PERMISSION_BIT.accessibility) || has(PERMISSION_BIT.copy),
  };
}

export type SecurityProblem = 'open-mismatch' | 'permissions-mismatch' | 'same-passwords' | 'missing-password' | 'too-long' | 'characters';

// Höchstlänge: AES-256 nutzt die ersten 127 Bytes eines Kennworts
const MAX_PASSWORD_BYTES = 127;

export function checkSecurityInput(input: {
  open: boolean;
  openPassword: string;
  openRepeat: string;
  restrict: boolean;
  permissionsPassword: string;
  permissionsRepeat: string;
}): SecurityProblem | null {
  const tooLong = (value: string) => value.length > MAX_PASSWORD_BYTES;
  // Nur ASCII: Apple Vorschau (PDFKit) nimmt bei AES-256 keine Kennwörter mit Umlauten an, obwohl die Norm UTF-8
  // vorsieht (geprüft 2026-10-14). Solche Dateien ließen sich auf dem Mac nicht öffnen.
  const unsupported = (value: string) => !/^[\x20-\x7e]*$/.test(value);
  if (input.open && input.openPassword === '') return 'missing-password';
  if (input.restrict && input.permissionsPassword === '') return 'missing-password';
  if (input.open && input.openPassword !== input.openRepeat) return 'open-mismatch';
  if (input.restrict && input.permissionsPassword !== input.permissionsRepeat) return 'permissions-mismatch';
  if (input.open && input.restrict && input.openPassword === input.permissionsPassword) return 'same-passwords';
  if ((input.open && unsupported(input.openPassword)) || (input.restrict && unsupported(input.permissionsPassword))) return 'characters';
  if ((input.open && tooLong(input.openPassword)) || (input.restrict && tooLong(input.permissionsPassword))) return 'too-long';
  return null;
}
