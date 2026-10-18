// Vorlagen der Startseite (ADR 0028): mitgelieferte werden bei Bedarf mit Chromium gesetzt (htmlToPdf), eigene liegen als
// PDF im Profil. Geöffnet wird immer eine Kopie als unbenanntes Dokument.
import { htmlToPdf } from '../convert/pdf';
import { t } from '../i18n';
import { BUILTIN_TEMPLATES, parseTemplateId, type SaveTemplateResult, type TemplateInfo } from '../../shared/templates';
import { templateHtml } from './builtin';
import type { UserTemplates } from './user-templates';

export class TemplateService {
  // Gesetzte Vorlagen je Name, Autor und Tag (Datum und Name stehen im Dokument)
  private cache = new Map<string, Promise<Uint8Array>>();

  constructor(
    private readonly user: UserTemplates,
    private readonly author: () => string,
  ) {}

  async list(): Promise<TemplateInfo[]> {
    const builtin = BUILTIN_TEMPLATES.map((name) => ({ id: `builtin:${name}`, name: t(`templates.names.${name}`), builtin: true }));
    return [...builtin, ...(await this.user.list())];
  }

  // Name (ohne .pdf) und Inhalt einer Vorlage
  async document(id: string): Promise<{ name: string; bytes: Uint8Array } | null> {
    const parsed = parseTemplateId(id);
    if (!parsed) return null;
    if (parsed.kind === 'user') {
      const bytes = await this.user.read(parsed.file);
      return bytes ? { name: parsed.file.replace(/\.pdf$/i, ''), bytes } : null;
    }
    const date = new Date();
    const author = this.author();
    const key = `${parsed.name}|${author}|${date.toDateString()}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = htmlToPdf(templateHtml(parsed.name, { t: (k, o) => t(k, o), author, date }));
      this.cache.set(key, pending);
      // Fehlschläge nicht merken
      pending.catch(() => this.cache.delete(key));
    }
    return { name: t(`templates.names.${parsed.name}`), bytes: await pending };
  }

  save(name: string, bytes: Uint8Array): Promise<SaveTemplateResult> {
    return this.user.save(name, bytes, t('templates.defaultName'));
  }

  async remove(id: string): Promise<boolean> {
    const parsed = parseTemplateId(id);
    if (parsed?.kind !== 'user') return false;
    await this.user.remove(parsed.file);
    return true;
  }
}
