// Textdokumente, die sich in PDF umwandeln lassen (ADR 0019). Gemeinsam für Hauptprozess und Oberfläche.
export const DOCUMENT_EXTENSIONS = ['docx', 'docm', 'dotx', 'odt', 'ott', 'rtf', 'txt', 'text', 'md', 'markdown', 'pages', 'doc'];

export const isDocumentFileName = (name: string): boolean => DOCUMENT_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '');
