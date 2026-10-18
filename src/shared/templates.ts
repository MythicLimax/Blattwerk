// Vorlagen der Startseite (ADR 0028): mitgelieferte (HTML → PDF im Hauptprozess) und eigene (PDF im Profil)

export const BUILTIN_TEMPLATES = ['letter', 'application', 'cv', 'invoice', 'minutes', 'cover', 'todo', 'notepaper'] as const;
export type BuiltinTemplate = (typeof BUILTIN_TEMPLATES)[number];

export interface TemplateInfo {
  // builtin:<name> bzw. user:<Dateiname>
  id: string;
  name: string;
  builtin: boolean;
}

export const isBuiltinTemplate = (value: string): value is BuiltinTemplate => (BUILTIN_TEMPLATES as readonly string[]).includes(value);

// Kennung einer Vorlage: mitgelieferte nur aus der Liste, eigene nur als schlichter Dateiname (keine Pfade)
export function parseTemplateId(id: unknown): { kind: 'builtin'; name: BuiltinTemplate } | { kind: 'user'; file: string } | null {
  if (typeof id !== 'string' || id.length > 300) return null;
  if (id.startsWith('builtin:')) {
    const name = id.slice('builtin:'.length);
    return isBuiltinTemplate(name) ? { kind: 'builtin', name } : null;
  }
  if (id.startsWith('user:')) {
    const file = id.slice('user:'.length);
    // eslint-disable-next-line no-control-regex -- Steuerzeichen sind in Dateinamen nicht erlaubt
    const plain = /^[^/\\:*?"<>|\u0000-\u001f]+\.pdf$/i.test(file) && !file.startsWith('.');
    return plain ? { kind: 'user', file } : null;
  }
  return null;
}

export type SaveTemplateResult = { ok: true; template: TemplateInfo } | { ok: false; error: 'invalid-data' | 'too-many' | 'write-failed' };
