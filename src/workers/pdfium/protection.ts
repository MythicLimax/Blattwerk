// Verschlüsseln mit @cantoo/pdf-lib (Phase 6, ADR 0011): AES-256, Kennwort zum Öffnen und Berechtigungen.
// Erwartet ein unverschlüsseltes Dokument (PDFium entfernt vorher einen vorhandenen Schutz) und schreibt es
// vollständig neu.
import { PDFDocument } from '@cantoo/pdf-lib';
import type { SecuritySettings } from '../../shared/security';

export async function encryptDocument(bytes: Uint8Array, settings: SecuritySettings): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const { openPassword, permissionsPassword, permissions } = settings;
  const restricted = permissionsPassword !== null;
  doc.encrypt({
    algorithm: 'AES-256',
    userPassword: openPassword ?? '',
    // Ohne eigenes Berechtigungskennwort gibt es keine Einschränkungen; das Öffnen-Kennwort gewährt alles.
    ownerPassword: permissionsPassword ?? openPassword ?? '',
    permissions: restricted
      ? {
          printing: permissions.printing === 'none' ? false : permissions.printing === 'high' ? 'highResolution' : 'lowResolution',
          modifying: permissions.modifying,
          copying: permissions.copying,
          annotating: permissions.annotating,
          fillingForms: permissions.fillingForms,
          documentAssembly: permissions.assembling,
          contentAccessibility: permissions.accessibility,
        }
      : {
          printing: 'highResolution',
          modifying: true,
          copying: true,
          annotating: true,
          fillingForms: true,
          documentAssembly: true,
          contentAccessibility: true,
        },
  });
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
