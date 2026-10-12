# CLAUDE.md

Desktop-PDF-Editor für macOS und Windows nach dem Bedienkonzept von Acrobat Pro. Die vollständige Vorgabe steht in [docs/spezifikation.md](docs/spezifikation.md). **Vor jeder Arbeit lesen.**

- App-Name: **Blattwerk**, App-ID `de.blattwerk.app`. Im Code steht der Name nur in `src/shared/product.ts`; Texte nutzen die Variable `{{appName}}`. `package.json` und `electron-builder.yml` tragen dieselben Werte (ein Test prüft das). Kein Adobe-Name, kein Adobe-Logo, keine kopierten Icons oder Grafiken.
- Sprache: Gespräch, Doku, Kommentare und UI auf Deutsch. Bezeichner im Code auf Englisch.
- **Auftraggeber programmiert nicht selbst** und hat alle technischen Entscheidungen an Claude delegiert (2026-10-12). Ziel: eine App auf dem MacBook (Apple Silicon), die möglichst viel von Acrobat Pro kann. Daher: Entscheidungen selbst treffen und in `docs/entscheidungen/` begründen, Berichte in einfacher Sprache ohne Fachjargon, nur bei echten Weichenstellungen nachfragen. macOS hat Vorrang, Windows bleibt Ziel der Spezifikation.

## Phasenstatus

| Phase | Inhalt | Status |
|---|---|---|
| 0 | Grundlagen: Spezifikation, Bibliotheksauswahl, CLAUDE.md | erledigt |
| 1 | Viewer | erledigt ([Bericht](docs/phasen/phase-1.md)), wartet auf OK |
| 2 | Kommentieren | offen |
| 3 | Seiten organisieren | offen |
| 4 | Formulare und Unterschrift | offen |
| 5 | Bearbeiten (inkl. Schwärzen) | offen |
| 6 | Werkzeuge (OCR, Komprimieren, Passwort, Export, Vergleich) | offen |
| 7 | Profi (PAdES, PDF/A, Tags) | offen |

Entschieden am 2026-10-12: PDFium-WASM + pdf.js ([0001](docs/entscheidungen/0001-pdf-bibliotheken.md)), Name Blattwerk, ISC-Lizenz zulässig. Projekt liegt unter `~/Documents/Claude Projekte/Adobe Acrobat Klon Lokal`. **Achtung:** `~/Documents` wird auf diesem Mac mit iCloud abgeglichen (offene Frage an den Auftraggeber, ob das Projekt umziehen soll).

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
Hauptprozess (Node)                 Preload                       Renderer (React, sandboxed)
- Fenster, natives Menü             contextBridge:                - Oberfläche, Tabs, Seitenleisten
- Dateien öffnen und lesen (IDs)    window.blattwerk (typisiert)  - pdf.js-Worker je Dokument (Parsen, Text)
- Zuletzt geöffnet, Einstellungen                                 - ab Phase 2: PDFium-Worker (Ändern, Speichern)
- app://-Protokoll, Sicherheit                                    - Zustand: zustand-Stores
- Dateizuordnung, Einzelinstanz
```

- **Renderer hat keinen Node-Zugriff.** Alles Dateisystem läuft über `window.blattwerk` (Typ in `src/preload/api-types.ts`) → IPC → Hauptprozess. Der Renderer kennt nur Datei-IDs.
- **Anzeigen mit den Viewer-Bausteinen von pdf.js** (`PDFViewer`, `PDFFindController`, `PDFLinkService`), siehe [ADR 0002](docs/entscheidungen/0002-anzeige-mit-pdfjs-viewer.md). Parsen, Schriften und Bilddekodierung laufen im Worker, gezeichnet wird zeitgeteilt im Hauptthread. Vollständiges Rendern im Worker wurde geprüft und ist nicht nötig (gemessen in den Oberflächentests).
- **Ändern und Speichern ab Phase 2 mit PDFium-WASM** (`@embedpdf/pdfium`), siehe [0001](docs/entscheidungen/0001-pdf-bibliotheken.md). Zugriff nur über eine eigene Schicht `src/workers/pdfium/` (entsteht in Phase 2), nie direkt auf `pdfiumModule`.
- **Große Dateien** (über 8 MB): eigener `PDFDataRangeTransport` (`src/renderer/engine/range-transport.ts`) liest 1-MB-Blöcke per IPC, höchstens 6 gleichzeitig. Kleinere Dateien werden in einem Stück gelesen.
- **Laden ist abbrechbar:** `LoadedDocumentHandle.promise` lehnt beim Schließen ab; der pdf.js-Worker wird erst nach `task.destroy()` beendet.

### Dokumentmodell (Stand Phase 1)

- Pro Tab: `TabState` in `src/renderer/state/documents-store.ts` (alles, was die Oberfläche anzeigt) und `DocumentRuntime` in `src/renderer/engine/runtime.ts` (pdf.js-Objekte, Viewer, Miniaturen-Cache, Seitentexte). Ablauf und Befehle in `src/renderer/engine/session.ts`.
- Der Hauptprozess merkt sich je Datei Größe und Änderungszeit beim Öffnen und meldet `file-changed`, wenn die Datei danach von außen geändert wird.
- **Ab Phase 2 geplant:** Koordinaten im PDF-Benutzerraum (Punkte, Ursprung unten links, ungedrehte Seite), Umrechnung nur über `src/renderer/engine/coords.ts`. Undo/Redo als Command-Pattern auf dem App-Modell; ungespeicherte Annotationen zeichnet eine React-Ebene über dem pdf.js-Canvas; beim Speichern wendet PDFium die Änderungen an. Für Inhaltsänderungen (Phase 5) Undo per Snapshot.

### Speichern (Grundregeln aus der Spezifikation, ab Phase 2)

1. PDFium erzeugt die neuen Bytes, standardmäßig **inkrementell** (`FPDF_INCREMENTAL`).
2. **Vollständig neu geschrieben** wird nur, wenn es nötig ist: Schwärzen, Verschlüsselung ändern, Komprimieren, „Speichern unter → optimiert“. Haben Signaturen im Dokument, fragt die App vorher nach.
3. Prüfen: Die neuen Bytes werden in einer frischen PDFium-Instanz geöffnet. Schlägt das fehl, wird nicht gespeichert.
4. Hauptprozess: Prüfen, ob die Datei auf der Platte noch dem Stand beim Öffnen entspricht. Sonst nachfragen.
5. **Atomar schreiben** mit `src/main/files/atomic-write.ts`: temporäre Datei im *selben* Ordner, `fsync`, `rename` über das Original, unter Windows mit Wiederholungen bei `EPERM`/`EBUSY`. Die Originaldatei wird nie direkt beschrieben.

### Sicherheit

- `BrowserWindow`: `contextIsolation`, `sandbox`, `webSecurity` an, `nodeIntegration` aus. Navigation und `window.open` gesperrt (`src/main/security.ts`).
- Alle App-Dateien kommen über `app://bundle/` (`src/main/protocol.ts`). Die CSP (`script-src 'self' 'wasm-unsafe-eval'`, `default-src 'none'`) steht in **jeder** Antwort, damit sie auch für Worker gilt. **Netzwerk ist komplett gesperrt** (`session.webRequest`), nur `app:`, `blob:`, `data:` sind erlaubt.
- **JavaScript in PDFs wird nie ausgeführt:** pdf.js bekommt keinen Scripting-Manager (ohne ihn läuft kein PDF-JavaScript), `enableXfa: false`. Die frühere Option `isEvalSupported` gibt es in pdf.js 6 nicht mehr; pdf.js nutzt kein `eval`.
- Externe Links: nur `http`, `https`, `mailto`, keine Zugangsdaten im Host-Teil, nur nach Rückfrage mit angezeigtem Zielserver (Punycode).
- IPC: feste Kanalliste (`src/shared/ipc.ts`), Absender wird geprüft, Argumente validiert (`src/shared/validate.ts`). Drop-Pfade nur absolut und lokal (keine UNC-Pfade).
- Testschalter (`BLATTWERK_E2E`, `BLATTWERK_E2E_PRINT_DIR`) wirken nur in der unpaketierten App. `BLATTWERK_USER_DATA` (Profilordner) wirkt immer, wird vom Rauchtest der fertigen App genutzt.
- Electron-Fuses in `electron-builder.yml`: `RunAsNode` aus, `NODE_OPTIONS` aus, Inspect-Argumente aus, ASAR-Integrität an, `OnlyLoadAppFromAsar` an.

### Performance-Regeln

- Hauptansicht: `PDFViewer` von pdf.js rendert nur sichtbare Seiten und hält einen begrenzten Seiten-Cache; bei hohem Zoom zeichnet es einen Detailausschnitt statt riesiger Canvas.
- Miniaturen: virtualisierte Liste (`@tanstack/react-virtual`), Rendern erst bei Sichtbarkeit und im Leerlauf, Abbruch beim Herausscrollen, LRU-Cache mit höchstens 400 Einträgen (je etwa 240 px breit). Bereits gerenderte Seiten der Hauptansicht liefern Miniaturen ohne erneutes Rendern.
- Zoom: pdf.js skaliert sofort per CSS und rendert verzögert scharf nach.
- Suche: pdf.js extrahiert den Text seitenweise im Hintergrund; die Ergebnisliste lädt Textausschnitte nur für angezeigte Zeilen (höchstens 500).
- Referenz für Messungen: `test/fixtures/generated/gross-600-seiten.pdf` (114 MB). Ziel: Öffnen unter 15 s, keine Blockade über 500 ms (gemessen: etwa 0,5 s und unter 150 ms).

## Ordnerstruktur

```
docs/
  spezifikation.md          Projektvorgabe (unverändert)
  entscheidungen/           Architekturentscheidungen (ADR 0001–0004)
  phasen/                   Abschlussbericht je Phase
src/
  main/                     Hauptprozess: index, window, menu, ipc, security, protocol(+paths), print,
                            default-app, i18n, files/ (file-registry, recent-files, json-store, atomic-write)
  preload/                  contextBridge-API (index.ts) und ihr Typ (api-types.ts)
  shared/                   Typen, IPC-Vertrag, Befehle, Tastenkürzel, Validierung, product.ts. Keine Node- oder DOM-Imports
  locales/de/               translation.json (alle UI-Texte, Renderer und Menü), pdfjs-viewer.ftl (Texte der pdf.js-Bausteine)
  renderer/
    app/                    Shell: Layout, Werkzeugleiste, Tabs, Seitenleisten, Startbildschirm, globale Tasten, Drag & Drop
    features/               viewer, thumbnails, outline, search, properties, print, password, goto
    components/             generische UI-Bausteine (IconButton, Dialog)
    state/                  zustand-Stores (documents-store, ui-store)
    engine/                 pdf.js-Einrichtung, Laden, Range-Transport, Laufzeit je Dokument, Befehle (session.ts)
    styles/                 Design-Tokens, hell/dunkel
    public/                 beim Build kopierte pdf.js-Ressourcen (nicht eingecheckt)
  workers/pdfium/           ab Phase 2: Bearbeitungs- und Speicher-Engine
resources/icon.svg          eigenes App-Symbol (Quelle)
build/                      icon.png (aus resources/icon.svg erzeugt), after-pack.cjs
scripts/                    build, dev, generate-fixtures, check-licenses, dist-mac-local, smoke-packaged, make-icon, dev-env.sh
test/
  fixtures/pdfs/            kleine Test-PDFs (eingecheckt), expectations.ts mit den erwarteten Eigenschaften
  fixtures/generated/       große Datei (nicht eingecheckt, `npm run fixtures -- --large`)
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

- **Unit/Integration (Vitest):** reine Logik und die Test-PDFs mit der Node-Variante von pdf.js. Ab Phase 2 auch PDFium-WASM in Node.
- **E2E (Playwright mit Electron):** `test/e2e/viewer.spec.ts` (Funktionen) und `test/e2e/regressions.spec.ts` (behobene Fehler). Systemdialoge werden im Hauptprozess per `app.evaluate` ersetzt; Drucken landet im Testmodus als PDF in einem Ordner.
- **Fertige App:** `node scripts/smoke-packaged.mjs <Pfad zur .app>` startet das Paket und prüft die Anzeige.
- **Ausgabeprüfung für jede gespeicherte Datei:** `qpdf --check` (in CI installiert), Öffnen mit pdf.js und mit PDFium, Annotationen haben /AP. Unter macOS zusätzlich mit PDFKit (die Engine von Apple Vorschau) rendern. Acrobat Reader: manuelle Checkliste im Phasenbericht.
- **Test-PDFs** (`test/fixtures/pdfs/`): Text, Scan (nur Bild), Formular (AcroForm), verschlüsselt (Benutzer- und Besitzerpasswort), beschädigt (kaputte xref, abgeschnitten), mit Links und Lesezeichen, signiert. „Sehr groß“ (600 Seiten, mehr als 100 MB) erzeugt `scripts/generate-fixtures.ts` nach `test/fixtures/generated/`.

## Befehle

Node.js liegt projektlokal in `.tools/node` (nicht eingecheckt). Vor jedem Befehl: `source scripts/dev-env.sh` (setzt `PATH`, legt alle Caches nach `.tools/cache`, beachtet einen gesetzten Proxy).

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsstart mit Vite-Server und eigenem Profil (`.tools/dev-profile`) |
| `npm run build` | Haupt-, Preload- und Renderer-Bundle nach `out/` |
| `npm run typecheck`, `npm run lint` | Typprüfung, ESLint |
| `npm test` | Unit- und Integrationstests |
| `npm run test:e2e` | Build und Oberflächentests mit der echten App |
| `npm run fixtures -- --large` | Test-PDFs neu erzeugen (unter macOS inklusive Scan) |
| `npm run licenses` | Lizenzprüfung der eingebündelten Pakete |
| `npm run dist:mac:local` | Mac-App (Apple Silicon) bauen, `.dmg` nach `release/` |
| `npm run dist:mac`, `npm run dist:win` | Pakete für CI (beide Mac-Architekturen bzw. Windows) |

**In der Claude-Sandbox:** Electron, Playwright-Oberflächentests, `npm run fixtures` (wegen `sips`) und Packaging laufen nur außerhalb der Sandbox.

## Packaging

- electron-builder: `.dmg` getrennt für arm64 und x64, Windows-Installer `.exe` (NSIS, x64).
- Dateizuordnung `.pdf` (macOS `CFBundleDocumentTypes`, Windows ProgID). Standardprogramm festlegen ([ADR 0004](docs/entscheidungen/0004-standardprogramm.md)): unter macOS über Launch Services per JavaScript for Automation (nur in der installierten App), unter Windows öffnet die App die Einstellungsseite.
- Signatur: lokal ad-hoc (`identity: '-'`, `hardenedRuntime: false`). Für Weitergabe an andere: Apple-Developer-Zertifikat, `identity` setzen, `hardenedRuntime: true`, Notarisierung.
- `npm run dist:mac:local` baut außerhalb des Projektordners, weil iCloud den Dateien Attribute anhängt, an denen `codesign` scheitert. `build/after-pack.cjs` entfernt zusätzlich alle erweiterten Attribute vor dem Signieren.
- GitHub Actions: Matrix `macos-latest` (arm64 und x64) und `windows-latest`. Signieren und Notarisieren optional über Secrets. Ohne Zertifikate sind die Builds unsigniert, dann warnen Gatekeeper bzw. SmartScreen.

## Bekannte Stolpersteine

- Pinch auf dem Trackpad kommt als `wheel`-Event mit `ctrlKey`. Browser-Zoom per `setVisualZoomLevelLimits(1, 1)` abschalten und selbst zoomen.
- `File.path` gibt es in Electron nicht mehr. Für Drag & Drop `webUtils.getPathForFile` im Preload nutzen.
- macOS öffnet Dateien per `open-file`-Event, auch vor `ready`. Windows übergibt sie über `argv` und `second-instance`.
- Pfad des Projekts enthält Leerzeichen. In Skripten Pfade immer quoten.
- `~/Documents` wird mit iCloud abgeglichen. Große Ordner (`node_modules`, `.tools`) werden mit hochgeladen; Signieren klappt nur außerhalb.
- `.tools/package.json` mit `"type": "commonjs"` (legt `dev-env.sh` an): Sonst liest Node die heruntergeladenen Hilfsprogramme von electron-builder als ES-Module.
- pdf.js 6: `getPermissions()` liefert ein `Set`, `getFieldObjects()` eine `Map`. `PDFDocumentProxy.destroy()` gibt es nicht mehr, abgebaut wird über die Lade-Aufgabe.
- pdf.js-Treffer (`pageMatches`) zählen Positionen im aneinandergehängten Text **ohne** Zeichen für Zeilenenden (siehe `src/renderer/features/search/snippet.ts`).
- pdf.js rechnet den Zoom-Anker relativ zum `offsetParent` des Containers (`containerTopLeft`), nicht zum Fenster.
- `pdf_viewer.mjs` erwartet `globalThis.pdfjsLib`; deshalb `src/renderer/engine/pdfjs-global.ts` vor dem Import.
- Playwright erzwingt sonst den hellen Modus; in `test/e2e/app.ts` steht deshalb `colorScheme: null`.
