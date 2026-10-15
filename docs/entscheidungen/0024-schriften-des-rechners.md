# 0024 Schriften des Rechners für neuen Text

Stand: 2026-10-15 · Wunsch des Auftraggebers: beliebte Schriften wie Arial, Aptos, Times New Roman

## Entscheidung

- **Auswahl:** Eine feste Liste beliebter Familien (Aptos, Arial, Calibri, Times New Roman, Georgia, Garamond, Cambria,
  Constantia, Book Antiqua, Verdana, Tahoma, Trebuchet MS, Century Gothic, Gill Sans MT, Franklin Gothic, Candara,
  Corbel, Comic Sans MS, Courier New, Consolas) mit den Schnitten normal, fett, kursiv, fett kursiv, soweit vorhanden.
  Gesucht in den Schriftordnern von macOS, in den Schriften, die Microsoft Office mitbringt (Word, PowerPoint, Excel),
  und unter Windows im Systemordner (`src/main/files/system-fonts.ts`). Nur TrueType-Einzeldateien (.ttf).
- **Lizenz:** Angeboten wird nur, was die Schrift selbst einbetten lässt (OS/2 `fsType` nicht „eingeschränkt“,
  `embeddingAllowed` in `src/shared/fonts.ts`). Die App liefert keine Schriften aus, sie bettet die des Rechners in
  das Dokument ein, wie Word beim PDF-Export.
- **Einbetten:** PDFium lädt die Schrift als CID-Schrift (`FPDFText_LoadFont`, TrueType, Unicode). Damit gehen auch
  Zeichen außerhalb Westeuropas (z. B. Ł, ő). Die Schriftdaten holt die Oberfläche über IPC (`fonts:read`, nur
  bekannte Kennungen `sys:<familie>:<schnitt>`) und hängt sie an die Inhaltsoperation (`fontData`).
- **Vorschau:** Die Eingabe zeigt die Schrift über ein `FontFace` aus denselben Daten, auch für Office-Schriften, die
  macOS nicht angemeldet hat.
- Wasserzeichen und Kopf-/Fußzeilen bleiben bei den Standardschriften.
