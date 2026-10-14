# 0011: Kennwortschutz und Berechtigungen

- Status: angenommen (2026-10-14, Phase 6)

## Anforderung

Passwortschutz und Berechtigungen setzen (Phase 6). Dazu gehört auch: Schutz ändern und entfernen.

## Entscheidung

- **Verschlüsseln mit @cantoo/pdf-lib** (`src/workers/pdfium/protection.ts`). PDFium kann lesen und entschlüsseln, aber nicht verschlüsseln. pdf-lib verschlüsselt nach ISO 32000-2 mit **AES-256** (`/V 5`, `/R 6`), dem einzigen Verfahren, das die Norm noch empfiehlt. Ältere Verfahren (RC4) bietet die App nicht an.
- **Entschlüsseln mit PDFium**: `FPDF_SaveAsCopy` mit `FPDF_REMOVE_SECURITY`. Kommentare und Formularwerte werden vorher übernommen. Danach verschlüsselt pdf-lib neu (oder nicht, beim Entfernen). Die Datei wird dabei vollständig neu geschrieben; Signaturen werden ungültig, der Dialog warnt davor.
- **Ablauf wie andere Änderungen:** Das Ergebnis ist ein neuer Dokumentstand im Arbeitsspeicher (Rückgängig möglich), die Datei ändert sich erst beim Speichern. Jeder Stand merkt sich sein Kennwort (`DocState.password`).
- **In der Sitzung volle Rechte:** Nach dem Setzen lädt die App den neuen Stand mit dem Berechtigungskennwort (falls gesetzt). Wer den Schutz einrichtet, wird also nicht sofort selbst eingeschränkt.
- **Berechtigungskennwort nötig zum Ändern:** Wurde das Dokument nur mit dem Kennwort zum Öffnen geöffnet und hat es Einschränkungen, fragt der Dialog zuerst das Berechtigungskennwort ab. PDFium meldet, ob das Dokument mit dem Berechtigungskennwort geöffnet wurde (`FPDF_GetDocPermissions` liefert dann alle Rechte). Das nutzt die App auch beim Öffnen: Mit dem Berechtigungskennwort geöffnete Dokumente sind nicht eingeschränkt (pdf.js unterscheidet das nicht).
- **Nur ASCII-Kennwörter:** Die Norm verlangt UTF-8; pdf-lib, pdf.js und PDFium halten sich daran. Apple Vorschau (PDFKit) nimmt Kennwörter mit Umlauten bei AES-256 aber nicht an (geprüft 2026-10-14). Solche Dateien ließen sich auf dem Mac nicht öffnen. Der Dialog lässt deshalb nur Zeichen von Leerzeichen bis `~` zu und sagt das.
- **Bedienung:** Menü „Werkzeuge → Kennwortschutz …“. Kennwort zum Öffnen, Berechtigungskennwort mit Drucken (erlaubt, nur niedrige Auflösung, nicht erlaubt), Kopieren, Kommentieren, Formulare ausfüllen, Seiten zusammenstellen, Inhalt ändern, Vorlesehilfen. Beide Kennwörter müssen sich unterscheiden.

## Prüfung

- `test/integration/protection.test.ts`: Schutz lesen, setzen (pdf.js, PDFium), nur Berechtigungen, entfernen, Kommentare in einem neu geschützten Dokument (verschlüsselt gespeichert, kein Klartext), Eingabeprüfung. `qpdf --check`, wenn vorhanden.
- `test/e2e/tools.spec.ts`: ganzer Weg in der App, Prüfung mit PDFKit (Kennwort, Drucken verboten), Rückgängig über den Schutz hinweg.

## Einschränkungen

- Berechtigungen sind ein Hinweis an Anzeigeprogramme. Wer das Dokument öffnen kann, kann sie mit geeigneten Programmen umgehen. Der Dialog sagt das.
- Wasserzeichen, Kopf- und Fußzeilen, Formularfelder anlegen und Schwärzen gehen in verschlüsselten Dokumenten weiterhin erst nach dem Entfernen des Schutzes (pdf-lib schreibt neue Objekte unverschlüsselt). Die Meldung verweist auf „Werkzeuge → Kennwortschutz“.
- Zertifikatsbasierte Verschlüsselung (Public Key) gibt es nicht.
