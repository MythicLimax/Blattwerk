# Phase 1: Viewer – Abschlussbericht

Stand: 2026-10-12

## Was funktioniert

| Anforderung | Umsetzung | Geprüft durch |
|---|---|---|
| Öffnen | Dialog („Öffnen …“, Cmd+O), Kommandozeile, Doppelklick im Finder (Dateizuordnung), Drag & Drop ins Fenster, „Zuletzt geöffnet“ (Startbildschirm und Menü), mehrere Dokumente in Tabs | Oberflächentests |
| Scrollen | Fortlaufende Ansicht mit nur sichtbaren Seiten gerendert; Pfeiltasten, Pos1/Ende, Bild auf/ab; in den Seitenansichten blättern Trackpad, Mausrad, Pfeil runter und Leertaste am Seitenrand um | Oberflächentests |
| Zoomen | Auswahlfeld (Automatisch, Fensterbreite, Ganze Seite, Originalgröße, 50–400 %), Plus/Minus, Menü mit Acrobat-Kürzeln (Cmd+0/1/2), Trackpad-Pinch und Strg/Cmd + Mausrad, an der Mausposition verankert | Oberflächentests (Pinch simuliert) |
| Ansichten | Einzelne Seite, Einzelne Seite fortlaufend, Zwei Seiten, Zwei Seiten fortlaufend; Ansicht drehen | Oberflächentests |
| Seitenminiaturen | Virtualisierte Liste, Miniaturen erst bei Sichtbarkeit, LRU-Cache, aktuelle Seite markiert, Klick springt | Oberflächentests |
| Lesezeichen/Inhaltsverzeichnis | Lesezeichenbaum mit Auf-/Zuklappen; klickbare Inhaltsverzeichnisse im Dokument über Links | Oberflächentests |
| Links | Interne Links springen; externe Links nur nach Rückfrage, nur http/https/mailto | Oberflächentests |
| Volltextsuche | Suchbereich rechts, Optionen (Groß/klein, ganze Wörter, Akzente), alle Treffer markiert, Weitersuchen (Cmd+G, Enter), Ergebnisliste mit Textausschnitt; Klick wählt genau diesen Treffer | Oberflächentests |
| Text auswählen und kopieren | Textebene von pdf.js, Kopieren über Menü/Cmd+C; Kopierverbot im PDF wird beachtet | Oberflächentests |
| Kennwortgeschützte PDFs | Kennwortabfrage, Hinweis bei falschem Kennwort, Abbrechen schließt den Tab | Oberflächen- und Integrationstests |
| Drucken | Systemdruckdialog, Seiten als Bilder mit 150 dpi (siehe ADR 0003), Fortschritt mit Abbrechen; gesperrt, wenn das PDF Drucken verbietet | Oberflächentest (Druck in PDF-Datei umgeleitet) |
| Dokumenteigenschaften | Datei, Ort, Größe, Titel, Autor, Thema, Stichwörter, Datumsangaben, Anwendung, PDF-Version, Seitenzahl, Seitenformat, Schnelle Webanzeige, Tags, Formularfelder, Sicherheit | Oberflächentests |
| Oberfläche | Menüleiste, Werkzeugleiste, linke Seitenleiste, rechter Bereich (Suche), Tabs, Hell/Dunkel nach System, deutsches natives Menü, alle Texte in `src/locales/de/` | Oberflächen- und Konsistenztests |
| Große Dateien | 600 Seiten, 114 MB: öffnet in etwa 0,5 s, längste Blockade der Oberfläche unter 150 ms | Oberflächentest mit Messung |
| Beschädigte Dateien | Kaputte Querverweistabelle wird repariert; abgeschnittene Datei stürzt nicht ab; Nicht-PDFs werden gemeldet | Oberflächen- und Integrationstests |
| Sicherheit | contextIsolation, sandbox, kein nodeIntegration, strikte CSP, kein JavaScript aus PDFs, keine Netzwerkzugriffe, Fuses in der fertigen App | Oberflächentests, Prüfung der fertigen App |
| Paket | `release/Blattwerk-0.1.0-arm64.dmg`, ad-hoc signiert, eigenes Symbol, PDF-Dateizuordnung | Rauchtest der fertigen App |

## Tests

- 65 Unit- und Integrationstests (`npm test`)
- 32 Oberflächentests mit der echten App (`npm run test:e2e`), davon 9 für Fehler aus der Code-Prüfung
- Typprüfung, ESLint (inklusive Regel gegen UI-Texte im Code), Lizenzprüfung
- Rauchtest der fertig gebauten App (`scripts/smoke-packaged.mjs`)

## Code-Prüfung

Vier unabhängige Prüfer haben den Code aus vier Blickwinkeln durchgesehen: Fehler, Sicherheit, Vollständigkeit gegenüber der Vorgabe sowie Öffnen und Schließen von Dateien. Jeder Befund wurde gegengeprüft oder von mir nachvollzogen.

- **Behoben:** 5 Punkte zur Sicherheit und 25 Fehler im Code. Die wichtigsten:
  - Ein Tab, der während der Druckvorbereitung geschlossen wurde, konnte das Drucken bis zum Neustart blockieren.
  - Beim Öffnen mehrerer Dateien hielt eine abgebrochene Kennwortabfrage die übrigen Dateien auf.
  - In den Seitenansichten blätterte das Trackpad nicht um, und beim Zoomen per Trackpad verrutschte die Ansicht.
  - Unter bestimmten Bedingungen entstand beim Start ein zweites, totes Fenster.
- **Verworfen:** 8 Befunde, entweder nicht zutreffend oder keine Abweichung von der Vorgabe (siehe unten unter „eingeschränkt“).
- **Korrigiert:** Die Projektbeschreibung (CLAUDE.md) passt wieder zum tatsächlichen Aufbau.

## Was nicht oder nur eingeschränkt geht

- **Drucken** ist gerastert (150 dpi). Text ist im Ausdruck etwas weicher als bei Acrobat.
- **Standardprogramm festlegen:** Unter macOS setzt die installierte App sich selbst als Standard; das ist nicht automatisch getestet, weil es eine Systemeinstellung des Testrechners ändern würde. Unter Windows öffnet sich die Einstellungsseite.
- **Rendern komplett im Worker** wurde nicht umgesetzt (ADR 0002); gemessen bleibt die Oberfläche flüssig.
- **Windows** ist nur über den GitHub-Workflow vorbereitet, aber noch nicht gebaut oder getestet.
- Formularfelder werden angezeigt, aber noch nicht ausgefüllt (Phase 4).
- Kein Rechtsklick-Menü (Kopieren geht über Cmd+C und das Menü „Bearbeiten“).
- Die Zoomstufe wird aus einer Liste gewählt oder per Trackpad/Plus/Minus eingestellt; freies Eintippen eines Prozentwerts gibt es noch nicht.
- Eigene Seitennamen mancher PDFs (z. B. römische Zahlen im Vorwort) werden nicht angezeigt; die Seitenzählung ist immer 1, 2, 3 …
- **Projektordner liegt in iCloud:** `~/Documents` wird auf diesem Mac mit iCloud abgeglichen. Die App funktioniert, aber rund 1,9 GB an Werkzeugen und Bibliotheken werden mit hochgeladen.

## Bitte einmal von Hand ausprobieren

Diese Punkte lassen sich nicht vollständig automatisch prüfen:

1. Eine PDF aus dem Finder ins Fenster ziehen.
2. Mit zwei Fingern auf dem Trackpad zoomen.
3. Etwas auf einem echten Drucker drucken.
4. Im Menü „Ablage → Als Standardprogramm für PDFs festlegen …“ wählen und danach eine PDF im Finder doppelklicken.

## Bekannte Bugs

Keine offenen bekannten Bugs.
