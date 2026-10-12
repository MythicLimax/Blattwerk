# CLAUDE.md

Desktop-PDF-Editor für macOS und Windows nach dem Bedienkonzept von Acrobat Pro. Die vollständige Vorgabe steht in [docs/spezifikation.md](docs/spezifikation.md). **Vor jeder Arbeit lesen.**

- App-Name: **Blattwerk**, App-ID `de.blattwerk.app`. Der Name steht nur in `src/shared/product.ts` und im i18n-Schlüssel `app.name`, nie hart im Code. Kein Adobe-Name, kein Adobe-Logo, keine kopierten Icons oder Grafiken.
- Sprache: Gespräch, Doku, Kommentare und UI auf Deutsch. Bezeichner im Code auf Englisch.
- **Auftraggeber programmiert nicht selbst** und hat alle technischen Entscheidungen an Claude delegiert (2026-10-12). Ziel: eine App auf dem MacBook (Apple Silicon), die möglichst viel von Acrobat Pro kann. Daher: Entscheidungen selbst treffen und in `docs/entscheidungen/` begründen, Berichte in einfacher Sprache ohne Fachjargon, nur bei echten Weichenstellungen nachfragen. macOS hat Vorrang, Windows bleibt Ziel der Spezifikation.

## Phasenstatus

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Grundlagen: Spezifikation, Bibliotheksauswahl, CLAUDE.md | erledigt |
| 1 | Viewer | in Arbeit |
| 2 | Kommentieren | offen |
| 3 | Seiten organisieren | offen |
| 4 | Formulare und Unterschrift | offen |
| 5 | Bearbeiten (inkl. Schwärzen) | offen |
| 6 | Werkzeuge (OCR, Komprimieren, Passwort, Export, Vergleich) | offen |
| 7 | Profi (PAdES, PDF/A, Tags) | offen |

Entschieden am 2026-10-12: PDFium-WASM + pdf.js ([0001](docs/entscheidungen/0001-pdf-bibliotheken.md)), Name Blattwerk, ISC-Lizenz zulässig, Projekt liegt lokal unter `~/Documents/Claude Projekte/Adobe Acrobat Klon Lokal` (nicht in iCloud).

## Arbeitsweise (verbindlich)

- Strikt Phase für Phase. **Fertig** heißt: App startet, alle Features der Phase funktionieren, `npm test` und E2E-Tests sind grün, Git-Commit existiert.
- Nach jeder Phase: Bericht in `docs/phasen/phase-N.md` (was geht, was nicht, bekannte Bugs) und im Chat. **Dann auf OK warten.**
- Ist ein Feature nicht sauber machbar: sagen und eine Alternative vorschlagen. Nichts halbgar bauen.
- **Keine Platzhalter.** Kein Button, Menüeintrag oder Kürzel ohne Funktion. Was noch nicht gebaut ist, taucht in der UI nicht auf.
- Diese Datei bei jeder Architekturänderung und an jedem Phasenende aktualisieren.
- Entscheidungen mit Begründung als `docs/entscheidungen/NNNN-titel.md` festhalten.

## Architektur

### Prozesse

```
Hauptprozess (Node)               Preload                 Renderer (React, sandboxed)
- Fenster, natives Menü           contextBridge:          - UI, Tabs, Panels
- Datei-I/O, atomares Speichern   window.api (typisiert)  - pdf.js-Worker je Dokument: Parsen, Text, Suche
- Zuletzt geöffnet, Einstellungen                         - PDFium-Worker je Dokument: Ändern, Speichern
- Dateizuordnung, Single Instance                         - Zustand: zustand-Stores
```

- **Renderer hat keinen Node-Zugriff.** Alles Dateisystem läuft über `window.api` → IPC → Hauptprozess.
- **Anzeigen nur mit pdf.js.** Parsen, Fonts und Bilddekodierung laufen im pdf.js-Worker. Das Zeichnen ist zeitgeteilt (pdf.js gibt nach etwa 15 ms an den Event-Loop zurück). Spike in Phase 1: komplettes Rendern im Worker per `OffscreenCanvas`. Falls das mit pdf.js nicht stabil geht, bleibt es beim zeitgeteilten Zeichnen, und ich melde das.
- **Ändern und Speichern nur mit PDFium-WASM** (`@embedpdf/pdfium`), siehe [0001](docs/entscheidungen/0001-pdf-bibliotheken.md). Der PDFium-Worker startet erst, wenn ein Dokument geändert wird. Zugriff nur über die eigene Schicht `src/workers/pdfium/`, nie direkt auf `pdfiumModule`.
- **Große Dateien:** pdf.js lädt über einen eigenen `PDFDataRangeTransport`, der Bytebereiche per IPC aus dem Hauptprozess liest. So landen 100+ MB nicht mehrfach im Speicher.
- **Worker-Kommunikation:** typisiertes RPC (Request-ID, Promise, Abbruch). Große Puffer immer als Transferable übergeben, nie kopieren.

### Dokumentmodell

- Pro Tab eine `DocumentSession`: Datei-ID, Pfad, Stand der Datei beim Öffnen (Größe, mtime), pdf.js-Proxy, PDFium-Proxy (lazy), Ansichtszustand, Änderungsmodell, Undo-Stack, Dirty-Flag.
- **Koordinaten:** Das Modell speichert alles im PDF-Benutzerraum (Punkte, Ursprung unten links, ungedrehte Seite). Umrechnung in Bildschirmkoordinaten nur über `src/renderer/engine/coords.ts`.
- **Undo/Redo:** Command-Pattern (`apply`/`revert`) auf dem App-Modell. Ungespeicherte Annotationen zeichnet eine React-Ebene über dem pdf.js-Canvas. Beim Speichern wendet PDFium die Änderungen auf das Original an. Für Operationen, die den Seiteninhalt ändern (ab Phase 5), gilt Undo per Snapshot der Dokumentbytes.

### Speichern (Grundregeln aus der Spezifikation)

1. PDFium erzeugt die neuen Bytes, standardmäßig **inkrementell** (`FPDF_INCREMENTAL`).
2. **Vollständig neu geschrieben** wird nur, wenn es nötig ist: Schwärzen, Verschlüsselung ändern, Komprimieren, „Speichern unter → optimiert“. Haben Signaturen im Dokument, fragt die App vorher nach.
3. Prüfen: Die neuen Bytes werden in einer frischen PDFium-Instanz geöffnet. Schlägt das fehl, wird nicht gespeichert.
4. Hauptprozess: Prüfen, ob die Datei auf der Platte noch dem Stand beim Öffnen entspricht. Sonst nachfragen.
5. **Atomar schreiben:** temporäre Datei im *selben* Ordner, `fsync`, `rename` über das Original. Unter Windows bei `EPERM`/`EBUSY` mit Backoff erneut versuchen (Virenscanner). Dateirechte übernehmen. Die Originaldatei wird nie direkt beschrieben.

### Sicherheit

- `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`. Strikte CSP (`script-src 'self' 'wasm-unsafe-eval'`). Navigation und `window.open` sind gesperrt.
- **JavaScript in PDFs wird nie ausgeführt:** pdf.js mit `enableScripting: false`, `isEvalSupported: false` und `enableXfa: false`. PDFium ohne JS-Plattform-Callbacks.
- Externe Links aus PDFs: nur `http`, `https` und `mailto`, und nur nach Rückfrage über `shell.openExternal`.
- IPC: feste Kanalliste, Argumente validieren. Der Renderer bekommt Datei-IDs statt beliebiger Pfade. Pfade stammen nur aus Dialog, Drag & Drop (`webUtils.getPathForFile`), „Zuletzt geöffnet“ oder Dateizuordnung.
- Electron-Fuses: `RunAsNode` aus, `NODE_OPTIONS` aus, Inspect-Argumente aus, ASAR-Integrität an, `OnlyLoadAppFromAsar` an.

### Performance-Regeln

- Seitenliste virtualisiert (`@tanstack/react-virtual`). Gerendert werden nur sichtbare Seiten plus Puffer. Verlassene Seiten brechen ihren Render-Task ab.
- Miniaturen erst rendern, wenn sie sichtbar werden, in niedriger Auflösung. LRU-Cache mit Speicherlimit.
- Zoom: sofort per CSS skalieren, scharf nachrendern mit Debounce. Canvas-Größe begrenzen, bei hohem Zoom in Kacheln rendern.
- Textebene nur für sichtbare Seiten. Suche läuft im Worker und liefert Treffer seitenweise.
- Referenz-Datei für Messungen: `test/fixtures/generated/gross-600-seiten.pdf` (mehr als 100 MB).

## Ordnerstruktur

```
docs/
  spezifikation.md          Projektvorgabe (unverändert)
  entscheidungen/           Architekturentscheidungen (ADR)
  phasen/                   Abschlussbericht je Phase
src/
  main/                     Hauptprozess: index, windows, menu, ipc/, files/ (atomic-write, recent), security
  preload/                  contextBridge-API
  shared/                   Typen, IPC-Verträge, product.ts. Keine Node- oder DOM-Imports
  locales/de/*.json         alle UI-Texte (Renderer und natives Menü), später en/
  renderer/
    app/                    Shell: Layout, Tabs, Seitenleisten, Werkzeugleiste
    features/               viewer, thumbnails, outline, search, properties, print, … (je Phase mehr)
    components/             generische UI-Bausteine
    state/                  zustand-Stores
    engine/                 Clients für die Worker, coords.ts
    styles/                 Design-Tokens, hell/dunkel
  workers/
    pdfjs/                  pdf.js-Worker-Setup, Range-Transport
    pdfium/                 Bearbeitungs- und Speicher-Engine (einziger Zugriff auf PDFium)
resources/                  App-Icons, Stempelvorlagen (eigene Grafiken)
build/                      electron-builder: Icons, Entitlements
scripts/                    z. B. generate-fixtures.ts
test/
  fixtures/pdfs/            kleine Test-PDFs (eingecheckt)
  fixtures/generated/       große und erzeugte Dateien (nicht eingecheckt, per Skript)
  unit/  integration/  e2e/
.github/workflows/build.yml
```

## Technik und Versionen

Stand 2026-10-12. Vor dem Installieren erneut prüfen und die aktuelle stabile Version nehmen.

| Zweck | Paket | Version | Lizenz |
|---|---|---|---|
| Laufzeit | electron | 44.7.0 (Chromium 152, Node 24.21) | MIT |
| Tooling | Node.js LTS | 24.21.0 | MIT |
| Build | vite, @vitejs/plugin-react | 8.3.4, 6.1.2 | MIT |
| UI | react, react-dom | 19.3.0 | MIT |
| Sprache | typescript | **6.0.3** | Apache-2.0 |
| Rendering | pdfjs-dist | 6.4.299 | Apache-2.0 |
| Bearbeiten/Speichern | @embedpdf/pdfium | 2.15.1 | MIT + BSD-3 |
| Zustand | zustand | 5.0.15 | MIT |
| Virtualisierung | @tanstack/react-virtual | 3.14.15 | MIT |
| i18n | i18next, react-i18next | 26.4.4, 17.0.16 | MIT |
| Icons | lucide-react | 1.55.0 | ISC |
| Tests | vitest, @playwright/test | 5.0.4, 1.64.0 | MIT, Apache-2.0 |
| Lint | eslint, typescript-eslint | 10.12.0, 8.71.1 | MIT |
| Packaging | electron-builder | 26.15.3 | MIT |

- **TypeScript 6 statt 7:** typescript-eslint 8.71 unterstützt nur TypeScript unter 6.1. Umstieg auf 7, sobald typescript-eslint so weit ist.
- **Kein electron-vite:** Version 5.0.0 unterstützt Vite 8 nicht und hatte seit 12/2025 kein Release. Stattdessen drei schlanke Vite-Konfigurationen (main, preload, renderer) und ein kleines Dev-Skript.
- Später: `tesseract.js` 7.0.0 (Phase 6; nur ein Release in 12 Monaten, vor Phase 6 neu prüfen), `@libpdf/core` als Kandidat für PAdES (Phase 7).
- **Lizenzen:** nur MIT, Apache-2.0, BSD-2/3, ISC und 0BSD. CI prüft das automatisch. AGPL (MuPDF, iText) und GPL nur nach Rücksprache.

## Konventionen

- TypeScript `strict`, kein `any` (Ausnahme: dokumentierter Grund im Kommentar). Benannte Exporte.
- Dateinamen: React-Komponenten `PascalCase.tsx`, alles andere `kebab-case.ts`.
- **Keine UI-Texte im Code:** immer `t('bereich.schluessel')`. Neue Schlüssel zuerst in `src/locales/de/`. ESLint erzwingt das.
- Icons nur aus `lucide-react`. Styling mit CSS Modules und Design-Tokens (CSS-Variablen) für hell und dunkel nach `prefers-color-scheme`.
- Tastenkürzel nur über die zentrale Tabelle in `src/shared/shortcuts.ts` (`CmdOrCtrl`). Menü und Renderer lesen dieselbe Tabelle.
- Fehler aus Engines als typisierte Ergebnisse, nicht als nackte Exceptions über Prozessgrenzen. Meldungen an Nutzer immer übersetzt.
- Commits: `typ(bereich): Beschreibung auf Deutsch`, z. B. `feat(viewer): Miniaturen erst bei Sichtbarkeit rendern`. Am Phasenende ein Commit `Phase N abgeschlossen`.

## Tests

- **Unit/Integration (Vitest):** Engine-Funktionen gegen die Test-PDFs. PDFium-WASM läuft auch in Node.
- **E2E (Playwright mit Electron):** je Phase ein Durchlauf mit allen Test-PDFs.
- **Ausgabeprüfung für jede gespeicherte Datei:** `qpdf --check` (in CI installiert), Öffnen mit pdf.js und mit PDFium, Annotationen haben /AP. Unter macOS zusätzlich mit PDFKit (die Engine von Apple Vorschau) rendern. Acrobat Reader: manuelle Checkliste im Phasenbericht.
- **Test-PDFs** (`test/fixtures/pdfs/`): Text, Scan (nur Bild), Formular (AcroForm), verschlüsselt (Benutzer- und Besitzerpasswort), beschädigt (kaputte xref, abgeschnitten), mit Links und Lesezeichen, signiert. „Sehr groß“ (600 Seiten, mehr als 100 MB) erzeugt `scripts/generate-fixtures.ts` nach `test/fixtures/generated/`.

## Befehle

Node.js liegt projektlokal in `.tools/node` (nicht eingecheckt). Vor jedem Befehl: `source scripts/dev-env.sh` (setzt `PATH` und legt alle Caches nach `.tools/cache`).

Weitere Befehle entstehen in Phase 1 (`npm run dev`, `npm test`, `npm run test:e2e`, `npm run build`, `npm run dist:mac`).

## Packaging

- electron-builder: `.dmg` getrennt für arm64 und x64, Windows-Installer `.exe` (NSIS, x64).
- Dateizuordnung `.pdf` (macOS `CFBundleDocumentTypes`, Windows ProgID). Standardprogramm festlegen: Windows erlaubt das nur über die Systemeinstellungen, die App öffnet die richtige Seite. Unter macOS braucht das Setzen eine native API (`NSWorkspace`). Lösung wird in Phase 1 geklärt.
- GitHub Actions: Matrix `macos-latest` (arm64 und x64) und `windows-latest`. Signieren und Notarisieren optional über Secrets. Ohne Zertifikate sind die Builds unsigniert, dann warnen Gatekeeper bzw. SmartScreen.

## Bekannte Stolpersteine

- Pinch auf dem Trackpad kommt als `wheel`-Event mit `ctrlKey`. Browser-Zoom per `setVisualZoomLevelLimits(1, 1)` abschalten und selbst zoomen.
- `File.path` gibt es in Electron nicht mehr. Für Drag & Drop `webUtils.getPathForFile` im Preload nutzen.
- macOS öffnet Dateien per `open-file`-Event, auch vor `ready`. Windows übergibt sie über `argv` und `second-instance`.
- Pfad des Projekts enthält Leerzeichen. In Skripten Pfade immer quoten.
