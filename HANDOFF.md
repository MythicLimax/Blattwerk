# Übergabe: Blattwerk

Stand: 2026-10-13 · Phase 4 abgeschlossen (Version 0.4.0). Aktueller Stand und Regeln: CLAUDE.md; Ergebnisse je Phase: docs/phasen/. Die übrigen Abschnitte unten beschreiben einen älteren Stand und sind überholt.

Dieses Dokument reicht, um ohne den bisherigen Chat weiterzuarbeiten. Verbindliche Regeln stehen in [CLAUDE.md](CLAUDE.md), die vollständige Vorgabe des Auftraggebers in [docs/spezifikation.md](docs/spezifikation.md). Beides zuerst lesen.

## 1. Ziel des Projekts

Ein Desktop-PDF-Editor für macOS (Vorrang: MacBook mit Apple Silicon) und Windows nach dem Bedienkonzept von Adobe Acrobat Pro. Er soll möglichst viele Funktionen von Acrobat übernehmen, aber keinen Adobe-Namen, kein Adobe-Logo und keine kopierten Grafiken verwenden.

- **Name:** Blattwerk, App-ID `de.blattwerk.app`.
- **Technik:** Electron, TypeScript, React und Vite.
  - Die Anzeige läuft mit pdf.js.
  - Ändern und Speichern laufen mit PDFium als WebAssembly (`@embedpdf/pdfium`).
- **Sprache:** Oberfläche, Doku und Kommentare auf Deutsch. Alle Oberflächentexte stehen in `src/locales/de/translation.json`.
- **Auftraggeber:** programmiert nicht selbst und hat alle technischen Entscheidungen delegiert.
  - Berichte schreiben wir in einfacher Sprache.
  - Nachgefragt wird nur bei echten Weichenstellungen.
- **Ablauf:** Die Phasen 2 bis 7 werden ohne Pause durchgearbeitet. Nach jeder Phase entstehen ein Bericht in `docs/phasen/phase-N.md`, ein Commit „Phase N abgeschlossen“ und eine neue `.dmg`. Auf ein OK wird nicht gewartet.

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Grundlagen, Bibliotheksauswahl | erledigt |
| 1 | Viewer | erledigt |
| 2 | Kommentieren | erledigt |
| 3 | Seiten organisieren | **begonnen** (nur zwei Logikdateien, nicht committet) |
| 4 | Formulare und Unterschrift | offen |
| 5 | Bearbeiten inkl. echtem Schwärzen | offen |
| 6 | Werkzeuge: OCR, Komprimieren, Passwort, Export, Vergleich | offen |
| 7 | Profi: PAdES-Signaturen, PDF/A, Tags | offen |

## 2. Arbeitsumgebung

- **Projektordner:** `~/Entwicklung/Blattwerk`.
  - Nicht in iCloud: Dort entstanden Konfliktkopien und Fehler beim Signieren.
  - Der alte Ordner `~/Documents/Claude Projekte/Adobe Acrobat Klon Lokal` ist leer und wird nicht mehr benutzt.
- **Node.js 24.21.0** liegt projektlokal in `.tools/node`. `.tools/` ist nicht eingecheckt.
- **Vor jedem Befehl:** `source scripts/dev-env.sh`. Das Skript setzt `PATH` und legt die Caches nach `.tools/cache`. Shell-Zustand bleibt zwischen einzelnen Befehlen nicht erhalten, also in jeder Kommandozeile erneut sourcen.
- **Falls `.tools/node` fehlt:**
  1. `node-v24.21.0-darwin-arm64.tar.xz` von nodejs.org laden.
  2. Die Prüfsumme gegen `SHASUMS256.txt` prüfen.
  3. Das Archiv nach `.tools/node` entpacken.
  4. Dann `source scripts/dev-env.sh && npm ci && node node_modules/electron/install.js` ausführen. Der Electron-Download läuft nicht automatisch, weil npm keine Install-Skripte ausführt.
- **Große Testdatei:** `npm run fixtures -- --large` erzeugt `test/fixtures/generated/gross-600-seiten.pdf` (600 Seiten, 119 MB). Sie ist nicht eingecheckt und wird für einen Oberflächentest gebraucht.
- **Git:** Das Repository existiert mit vollständigem Verlauf, es ist **kein Remote** eingerichtet. Die Identität ist lokal gesetzt (`Linus <334567454+MythicLimax@users.noreply.github.com>`).
  - Format der Commit-Nachrichten: `typ(bereich): Beschreibung auf Deutsch`.
  - Letzte Zeile jeder Commit-Nachricht: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Befehle

| Befehl | Zweck |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run licenses` | Typprüfung, ESLint (inklusive Regel gegen Oberflächentexte im Code), Lizenzprüfung |
| `npm test` | 91 Unit- und Integrationstests (1 übersprungen: qpdf fehlt lokal) |
| `npm run build` und `npx playwright test` | 44 Oberflächentests mit der echten App (`npm run test:e2e` macht beides) |
| `npm run dist:mac:local` | baut `release/Blattwerk-<version>-arm64.dmg` (Build im temporären Systemordner) |
| `node scripts/smoke-packaged.mjs <Pfad zur .app>` | startet die fertige App, prüft Anzeige und Speichern eines Kommentars |

Electron, die Oberflächentests, `osascript`, `sips` und das Packaging laufen nur **außerhalb** der Claude-Sandbox (siehe Abschnitt 5).

## 3. Was fertig ist

### Phase 1: Viewer (Bericht: [docs/phasen/phase-1.md](docs/phasen/phase-1.md))

- **Öffnen:** Dialog, Kommandozeile, Finder-Doppelklick, Drag & Drop, „Zuletzt geöffnet“, mehrere Tabs.
  - Hauptprozess: `src/main/index.ts`, `src/main/ipc.ts`, `src/main/files/`.
  - Renderer: `src/renderer/engine/session.ts`.
- **Anzeige:** Scrollen, Zoomen (inklusive Trackpad-Pinch), Ansichtsarten und Ansicht drehen mit den Viewer-Bausteinen von pdf.js.
  - `src/renderer/engine/runtime.ts`, `src/renderer/features/viewer/`.
- **Seitenleiste:** Miniaturen (`src/renderer/features/thumbnails/`) und Lesezeichen (`src/renderer/features/outline/`).
- **Suche:** Volltextsuche (`src/renderer/features/search/`), Text kopieren.
- **Geschützte Dateien:** Kennwortdialog (`src/renderer/features/password/`).
- **Drucken:** gerastert mit 150 dpi (`src/renderer/features/print/`, `src/main/print.ts`).
- **Dokumenteigenschaften:** `src/renderer/features/properties/`.
- **Große Dateien:** werden blockweise per IPC gelesen (`src/renderer/engine/range-transport.ts`).
- **Sicherheit:**
  - Fensteroptionen: `src/main/security.ts`, `src/main/window.ts`.
  - Eigenes `app://`-Protokoll mit strenger CSP: `src/main/protocol.ts`.
  - Kein Netzwerk, kein JavaScript aus PDFs.
  - IPC-Validierung: `src/shared/validate.ts`.
- **Natives deutsches Menü:** `src/main/menu.ts`. Die Kürzel kommen nur aus `src/shared/shortcuts.ts`.
- **Als Standardprogramm festlegen:** `src/main/default-app.ts`.

### Phase 2: Kommentieren (Bericht: [docs/phasen/phase-2.md](docs/phasen/phase-2.md), Entscheidung: [docs/entscheidungen/0005-kommentare.md](docs/entscheidungen/0005-kommentare.md))

- **Modell:** `src/shared/annotations.ts`. Koordinaten im PDF-Benutzerraum.
- **Werkzeuge:** Hervorheben, Unterstreichen, Durchstreichen, Notiz, Textfeld, Freihand, Rechteck, Ellipse, Linie, Pfeil und Stempel.
  - Werkzeugleiste: `src/renderer/features/annotations/CommentToolbar.tsx`.
  - Zeichnen, Auswählen, Verschieben, Größe ändern: `PageOverlay.tsx` und `AnnotationLayer.tsx`, eine SVG-Ebene je sichtbarer Seite.
  - Neue Kommentare anlegen: `create.ts`.
  - Geometrie: `geometry.ts`.
  - Markierungen aus der Textauswahl: `text-selection.ts`.
  - Koordinaten-Umrechnung: `src/renderer/engine/coords.ts`.
- **Kommentarliste:** in der linken Seitenleiste, mit Antworten und Prüfstatus (`CommentsPanel.tsx`).
- **Einlesen vorhandener Kommentare aus pdf.js:** `from-pdfjs.ts`, angestoßen von `controller.ts`.
- **Rückgängig/Wiederholen** über Befehle je Tab: `src/renderer/state/annotations-store.ts`.
- **Ermitteln, was zu speichern ist:** `changes.ts`.
- **Speichern:** inkrementell mit PDFium im Web Worker.
  - Worker und Engine: `src/workers/pdfium/engine.ts`, `memory.ts`, `protocol.ts`, `worker.ts`.
  - Anbindung im Renderer: `src/renderer/engine/pdfium-client.ts`. Der Worker beendet sich 2 s nach dem letzten Auftrag, damit der Speicher frei wird.
  - Atomares Schreiben und Prüfung auf Änderungen von außen: `src/main/ipc.ts` und `src/main/files/file-registry.ts`.
- **Rückfragen** bei ungespeicherten Änderungen und bei von außen geänderten Dateien: `src/renderer/features/prompt/PromptDialog.tsx`. Das Schließen läuft über `handleCloseRequest` in `session.ts` und den Close-Ablauf in `src/main/index.ts`.
- **Einstellung „Name für Kommentare“:** `src/renderer/features/settings/SettingsDialog.tsx`.
- **Drucken** schließt ungespeicherte Kommentare ein: `printTab` in `session.ts` und `openTemporary` in `document-loader.ts`.
- **Tests:**
  - Unit: `test/unit/annotations.test.ts`.
  - Integration: `test/integration/pdfium-annotations.test.ts`.
  - Oberfläche: `test/e2e/comments.spec.ts`, Prüfung mit Apple PDFKit über `test/e2e/pdfkit.ts`.
  - Test-PDF mit fremden Kommentaren: `test/fixtures/pdfs/kommentare.pdf`.
- **Paket:** `release/Blattwerk-0.2.0-arm64.dmg`. Der Rauchtest der fertigen App ist bestanden (Anzeige und Speichern).

## 4. Was offen ist

### Phase 3: Seiten organisieren (in Arbeit)

**Vorgabe:**
- Seiten per Drag & Drop umsortieren, drehen und löschen.
- Leere Seiten oder Seiten aus anderen PDFs einfügen.
- Seiten extrahieren, PDFs zusammenführen und aufteilen.
- Bilder (JPG, PNG) in PDF umwandeln.

**Bisher geschrieben, aber nicht committet und nicht getestet:**
- `src/shared/pages.ts`:
  - Typen `PageOperation`, `ComposePart`, `ImageSource`, `PdfSource`.
  - `parsePageRanges` liest Eingaben wie „1-3, 5, 8-“; dazu gibt es `formatPageRanges`.
  - `orderAfterMove`, `moveTarget` (Zielindex für `FPDF_MovePages`), `chunkPages`, `splitAtPages`.
- `src/shared/image-info.ts`:
  - JPEG/PNG erkennen, Maße und EXIF-Ausrichtung lesen, ohne zu dekodieren.
  - `imagePageLayout`: Seite so groß wie das Bild (1 px = 1 pt), höchstens A4. Die Drehmatrix ist für 0/90/180/270° nachgerechnet.

**Geprüft per Experiment** (Skript in `.tools/exp/img.mjs`): `EPDFImageObj_SetPng(0, 0, imageObj, dataPtr, size)` bettet ein PNG korrekt ein. Apple PDFKit zeigt es richtig an. `EPDFImageObj_SetJpeg` hat dieselbe Signatur, ist aber noch nicht getestet. Die weiteren PDFium-Funktionen sind vorhanden: `FPDF_ImportPagesByIndex`, `FPDF_MovePages`, `FPDFPage_Delete`, `FPDFPage_New`, `FPDFPage_SetRotation`, `FPDF_CreateNewDocument`.

**Entworfen, noch nicht gebaut** (Begründung in Abschnitt 6):

- **Seitenänderung:** Jede Seitenänderung erzeugt PDFium sofort als neuen Stand im Speicher.
  1. Aktuelle Bytes holen (`runtime.pdf.getData()`).
  2. Ungespeicherte Kommentaränderungen (`computeChanges`) einarbeiten.
  3. Seitenoperationen ausführen.
  4. Inkrementell speichern.
  5. Den Tab aus den neuen Bytes neu laden. Die Datei auf der Platte bleibt bis „Speichern“ unverändert.
- **Verlauf je Tab:** eine Liste von Ständen `{ bytes | null (= Datei auf der Platte), Kommentarzustand }` mit Cursor und gespeicherter Position. Gehört in einen neuen Store, z. B. `src/renderer/state/history-store.ts`.
  - Rückgängig nimmt zuerst Kommentarbefehle zurück, danach einen Seiten-Stand.
  - Beim Verlassen eines Stands wird dessen Kommentarzustand samt Stapeln gesichert.
  - Neue Kommentaraktionen verwerfen „Wiederholen“ für Seiten-Stände. Der Haken dafür gehört in `controller.ts`.
  - Speichergrenze für alle Stände: etwa 768 MB. Die ältesten Stände fallen weg.
  - „Ungespeichert“ heißt: Kommentare ungespeichert **oder** Cursor ≠ gespeicherte Position.
  - Diese Bedingung muss überall ersetzt werden, wo heute `isDirty(...)` benutzt wird: `hooks.ts`, `TabBar.tsx`, `Toolbar.tsx`, `session.ts`. Außerdem muss `saveTab` auch ohne Kommentaränderungen schreiben, wenn der Stand im Speicher liegt.
- **Laden aus dem Speicher:** `loadIntoTab` in `session.ts` muss neben der Datei auch Bytes laden können (`pdfjs.getDocument({ data })`). Mit wiederhergestelltem Kommentarzustand wird `loadAnnotations` übersprungen.
- **Worker:** neue Aufträge in `src/workers/pdfium/`, gut in einer eigenen Datei `pages.ts`:
  - `transform(bytes, password, changes, operations)`.
  - `compose(parts)` für ein neues Dokument, vollständig gespeichert.
  - `inspect(bytes, password)` liefert Seitenzahl oder „Kennwort nötig“.
  - Beim Löschen nie alle Seiten entfernen.
- **Hauptprozess, neue IPC-Kanäle mit Validierung:**
  - `pickFiles(kind: 'pdf' | 'image' | 'pdf-or-image')`: Dialog öffnen, Dateisignatur prüfen, Dateien im Registry anmelden, `FileInfo` zurückgeben. Gelesen wird über das vorhandene `readRange`/`readChunked`.
  - `saveNewFile(bytes, vorgeschlagenerName, öffnenDanach)`: Sichern-Dialog, atomar schreiben, optional als Tab öffnen.
  - `saveFilesToFolder(dateien)`: Ordnerdialog, eindeutige Dateinamen, nichts überschreiben.
- **Oberfläche:**
  - Ansicht „Seiten organisieren“ als Raster (virtualisiert, Miniaturen über die vorhandene `ThumbnailCache`).
    - Auswahl per Klick, Cmd-Klick und Umschalt-Klick.
    - Ziehen zum Umsortieren.
    - Drehen, Löschen, Einfügen (leer, aus Datei, Bilder), Extrahieren und Teilen.
  - Neues Menü „Dokument“ mit den Kürzeln wie in Acrobat: Umschalt+Cmd+R drehen, Umschalt+Cmd+D löschen, Umschalt+Cmd+I aus Datei einfügen.
  - Unter „Ablage“: „Dateien zusammenführen …“ und „PDF aus Bildern erstellen …“.
  - Seitenoperationen nur, wenn das PDF es erlaubt: `canAssemble` = keine Rechte gesetzt, `MODIFY_CONTENTS` oder `ASSEMBLE`.
  - Für verschlüsselte Quell-PDFs braucht es eine Kennwortabfrage.

### Danach (Phasen 4 bis 7)

Siehe Spezifikation. Kandidaten aus der Bibliotheksentscheidung (ADR 0001): `tesseract.js` für OCR (Phase 6, vorher neu prüfen) und `@libpdf/core` für PAdES (Phase 7).

### Weitere offene Punkte

- **Phase 2 wurde nicht unabhängig geprüft.** Phase 1 hatte eine Prüfung durch mehrere Prüfer mit Gegenprüfung der Befunde. Die geänderten Dateien von Phase 2 liefert `git diff --name-only b58a150..4bc3829`.
- **qpdf-Prüfung** (`test/integration/pdfium-annotations.test.ts`, „bestehen qpdf --check“) lief noch nie: lokal ist qpdf nicht installiert, und der CI-Workflow `.github/workflows/build.yml` wurde nie ausgeführt, weil kein GitHub-Remote existiert.
- **Windows** ist nie gebaut oder getestet worden.
- **Handprüfungen** stehen in den Phasenberichten: Acrobat Reader und Chrome mit gespeicherten Kommentaren, Trackpad, echter Drucker.

## 5. Bekannte Probleme und Fehlermeldungen

| Problem | Meldung | Umgang |
|---|---|---|
| Rauschen bei jedem Node-Aufruf | `ERROR: failed to copy trust settings of system certificate-25291` (viele Zeilen) | Harmlos, kommt mit `NODE_USE_ENV_PROXY=1` aus der Systemzertifikats-Abfrage. Ausgabe mit `grep -v "trust settings"` filtern. |
| Electron startet nicht in der Claude-Sandbox | Chromium-Fehler mit `sandbox_extension_issue_file` | Oberflächentests, Packaging, Rauchtest, `osascript` und `sips` außerhalb der Sandbox ausführen. |
| `python3` unbrauchbar | Abbruch mit Exit-Code 69: Die Xcode-Lizenz ist nicht bestätigt (Abhilfe wäre `sudo xcodebuild -license`) | Für Skripte und Dateiänderungen Node nehmen. Früher sind Änderungen per Python still fehlgeschlagen. |
| `git init` in der Sandbox | `error: could not lock config file .../.git/config: Operation not permitted` | Nicht nötig, das Repository existiert bereits. |
| Electron-Download beim `npm ci` | Electron fehlt nach der Installation | `node node_modules/electron/install.js` (mit gesetztem Proxy über `NODE_USE_ENV_PROXY=1`). |
| Stempel aus anderen Programmen | pdf.js liefert den `/Name` nicht | Die Liste zeigt „Stempel“; verschoben zeigt die Vorschau bis zum Speichern nur einen Umriss. |
| Füllfarbe fremder Rechtecke und Ellipsen | pdf.js liefert sie nicht | Sie bleibt beim Speichern erhalten, fehlt aber in der Vorschau. |
| Nach dem Speichern | Der Tab lädt neu | Rückgängig über das Speichern hinaus ist nicht möglich; die Ansicht springt an den Anfang der aktuellen Seite. |
| Dateigröße beim inkrementellen Speichern | Eine 119-MB-Datei wächst je Speichern um etwa 200 KB | PDFium schreibt beim inkrementellen Speichern eine vollständige Querverweistabelle. Hinnehmbar, Komprimieren folgt in Phase 6. |
| Hinweisfenster von pdf.js | – | Absichtlich per CSS aus (`src/renderer/styles/global.css`), sonst würden veraltete Kommentartexte erscheinen. |

**Fallen für Entwickler.** Diese stehen auch in CLAUDE.md, Abschnitt „Bekannte Stolpersteine“:
- React lauscht auch an Portal-Containern. Native Listener am Viewer laufen deshalb **nach** den React-Handlern der Kommentarebene.
- pdf.js leert Seiten beim Neuzeichnen. Die Kommentarebene wird per `MutationObserver` wieder eingehängt.
- `mix-blend-mode` (Hervorhebung) wirkt nur, wenn die Kommentarebene keinen `z-index` hat.
- Zeigererfassung (`setPointerCapture`) muss auf dem angeklickten Element liegen, sonst erreicht ein Doppelklick das Textfeld nicht.
- Die Koordinaten in Oberflächentests müssen im sichtbaren Fensterbereich liegen. Die Tests stellen deshalb „Ganze Seite“ ein.
- Test-Helfer, die Ordner löschen, dürfen das erst am Ende tun (`test.afterAll`).

## 6. Entscheidungen und Gründe

| Entscheidung | Grund | Wo |
|---|---|---|
| PDFium-WASM (`@embedpdf/pdfium`, MIT/BSD) zum Ändern und Speichern, pdf.js zur Anzeige | Nur erlaubte Lizenzen (MuPDF wäre AGPL). PDFium kann inkrementell speichern und Darstellungen erzeugen. pdf.js ist die beste Anzeige im Browser. | [0001](docs/entscheidungen/0001-pdf-bibliotheken.md) |
| Viewer-Bausteine von pdf.js statt eigener Seitenliste | Ausgereift (Suche, Links, Textauswahl). Gemessen flüssig mit 600 Seiten. | [0002](docs/entscheidungen/0002-anzeige-mit-pdfjs-viewer.md) |
| Drucken als Bilder mit 150 dpi | Funktioniert zuverlässig über den Systemdialog, ohne PDF an Drucker weiterzureichen | [0003](docs/entscheidungen/0003-drucken.md) |
| Standardprogramm unter macOS per Launch Services (JavaScript for Automation) | Electron hat dafür keine Schnittstelle | [0004](docs/entscheidungen/0004-standardprogramm.md) |
| Kommentare: pdf.js zeichnet unveränderte, eine eigene SVG-Ebene neue und geänderte. Speichern inkrementell mit PDFium. | Der eingebaute Editor von pdf.js kann weder Antworten noch Status, Formen oder Stempel. Inkrementell speichern lässt das Original unverändert am Dateianfang stehen. | [0005](docs/entscheidungen/0005-kommentare.md) |
| Prüfung vor dem Schreiben in derselben PDFium-Instanz (neu geladenes Dokument) statt in einer frischen Instanz | Eine zweite WASM-Instanz verdoppelt den Speicher bei großen Dateien und prüft nichts anderes | 0005 |
| PDFium-Worker beendet sich nach 2 s Leerlauf | WASM-Speicher schrumpft nie. Gemessen: 1,2 GB statt 350 MB nach dem Speichern einer 119-MB-Datei. | 0005, `pdfium-client.ts` |
| Ausgabeprüfung mit Apple PDFKit in den Oberflächentests | So sieht die Datei in „Vorschau“ aus; kein Acrobat auf dem Testrechner | `test/e2e/pdfkit.ts` |
| Electron 44, Vite 8 ohne electron-vite, TypeScript 6 statt 7 | electron-vite unterstützt Vite 8 nicht; typescript-eslint unterstützt TypeScript 7 noch nicht | CLAUDE.md |
| **Phase 3 (noch ohne ADR, als 0006 festhalten):** Seitenänderungen sofort im Speicher anwenden, Rückgängig über Stände | Die Ansicht, die Miniaturen und die Kommentare bleiben immer passend zum tatsächlichen Dokument. Ein „virtuelles Seitenmodell“ müsste Anzeige, Kommentare und Speichern getrennt nachführen und wäre fehleranfälliger. Nachteil: jede Operation lädt den Tab neu (bei 119 MB etwa 1–2 s), Stände kosten Speicher. | Abschnitt 4 |
| **Phase 3:** Zusammenführen, Extrahieren, Teilen und Bilder → PDF fragen zuerst nach dem Speicherort und öffnen das Ergebnis | Kein Tab ohne Datei nötig; das Tab-Modell setzt überall eine `fileId` voraus | Abschnitt 4 |
| **Phase 3:** Bildseiten so groß wie das Bild (1 px = 1 pt), höchstens A4, EXIF-Drehung beachten | Vorhersehbar, druckbar, Handyfotos stehen aufrecht. JPEG wird unverändert eingebettet (keine Qualitätsverluste). | `src/shared/image-info.ts` |

## 7. Nächste konkrete Schritte

1. **Engine für Seiten bauen und testen.**
   - Neue Datei `src/workers/pdfium/pages.ts` mit `transform`, `compose` und `inspect`.
   - Die Aufträge in `protocol.ts` und `worker.ts` aufnehmen.
   - Funktionen in `src/renderer/engine/pdfium-client.ts` ergänzen.
   - Integrationstest `test/integration/pdfium-pages.test.ts`:
     - Drehen, Löschen, Verschieben (Reihenfolge über den Seitentext mit pdf.js prüfen) und leere Seite.
     - Import aus `text.pdf` und `verschluesselt.pdf` (Kennwort `geheim`).
     - PNG und JPEG (auch mit Alphakanal) sowie Zusammensetzen eines neuen Dokuments.
     - Inkrementell bleibt das Original am Anfang.
   - Unit-Tests für `src/shared/pages.ts` und `src/shared/image-info.ts`.
2. **Verlauf und Laden aus dem Speicher.**
   - `history-store.ts`.
   - `loadIntoTab` für Bytes erweitern.
   - `applyPageOperations(tabId, ops)` in `session.ts`.
   - Rückgängig/Wiederholen in `executeCommand` zusammenführen.
   - Die neue „ungespeichert“-Bedingung überall einsetzen.
   - `saveTab` für Stände im Speicher anpassen.
   - `canAssemble` in `TabState` aufnehmen.
3. **Hauptprozess und Oberfläche.**
   - IPC `pickFiles`, `saveNewFile` und `saveFilesToFolder` mit Validierung, Typen in `src/preload/api-types.ts`.
   - Ansicht „Seiten organisieren“ (`src/renderer/features/organize/`).
   - Dialoge: Einfügen mit Position, Extrahieren, Teilen (nach je N Seiten oder an Lesezeichen der obersten Ebene), Zusammenführen und Kennwortabfrage.
   - Menü „Dokument“ und die neuen Einträge unter „Ablage“: `src/shared/commands.ts`, `src/shared/shortcuts.ts`, `src/main/menu.ts`.
   - Alle Texte in `src/locales/de/translation.json`.
4. **Oberflächentests** `test/e2e/pages.spec.ts`.
   - Systemdialoge im Hauptprozess per `app.evaluate` ersetzen, wie bei „Speichern unter“ in `test/e2e/comments.spec.ts`.
   - Abdecken: Auswahl, Drehen, Löschen, Ziehen, Einfügen, Extrahieren, Teilen, Zusammenführen, Bilder → PDF, Rückgängig/Wiederholen, Speichern und neu Öffnen.
   - Außerdem: Kommentare überstehen Seitenänderungen.
   - Dann der komplette Testlauf.
5. **Abschluss Phase 3.**
   - Unabhängige Code-Prüfung von Phase 2 und 3 mit Gegenprüfung jedes Befunds; Befunde beheben.
   - ADR `docs/entscheidungen/0006-seiten-organisieren.md`.
   - Bericht `docs/phasen/phase-3.md`.
   - CLAUDE.md aktualisieren.
   - Version 0.3.0 in `package.json`, dann `npm run dist:mac:local` und den Rauchtest ausführen.
   - Commit „Phase 3 abgeschlossen“. Danach weiter mit Phase 4.
