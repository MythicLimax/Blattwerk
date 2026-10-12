# 0005: Kommentare anzeigen, bearbeiten und speichern

- Status: angenommen (2026-10-12, Phase 2)

## Entscheidung

### Datenmodell

- Eigenes Modell in `src/shared/annotations.ts`, gemeinsam für Oberfläche und PDFium-Worker. Koordinaten im PDF-Benutzerraum (Punkte, Ursprung unten links, ungedrehte Seite).
- Arten: Hervorheben, Unterstreichen, Durchstreichen, Wellenlinie (nur vorhandene), Notiz, Textfeld, Freihand, Rechteck, Ellipse, Linie, Pfeil, Stempel.
- **Antworten** sind Text-Anmerkungen mit `/IRT` auf den Kommentar und `/RT /R`, unsichtbar (Flag „hidden“). **Prüfstatus** ist eine unsichtbare Text-Anmerkung mit `/IRT`, `/State` und `/StateModel /Review`. So legen auch Acrobat und andere Programme Antworten und Status ab (ISO 32000-1, 12.5.6.4 und 12.5.6.10).
- Rückgängig/Wiederholen: Befehle (`add`, `remove`, `update`) je Tab. Der Stand beim Speichern wird als Position im Rückgängig-Stapel gemerkt; daraus folgt die Markierung „ungespeichert“.

### Anzeige

- **pdf.js zeichnet vorhandene, unveränderte Kommentare** wie bisher in das Seitenbild.
- **Neue und geänderte Kommentare zeichnet eine eigene SVG-Ebene je Seite.** Sie hängt in der Seite von pdf.js (über der Text- und Linkebene) und rechnet mit dem Seiten-Viewport von pdf.js (Maßstab 1, mit Drehung). pdf.js leert eine Seite beim Neuaufbau; ein `MutationObserver` hängt die Ebene sofort wieder ein. Nur sichtbare Seiten (plus eine Bildschirmhöhe Vorlauf) bekommen eine Ebene (`IntersectionObserver`).
- **Geänderte oder gelöschte vorhandene Kommentare blendet pdf.js aus**, über seinen Anmerkungsspeicher: Ein Eintrag `{ deleted: true, id }` unter dem Präfix `pdfjs_internal_editor_` lässt pdf.js die Anmerkung beim Zeichnen weg (`AnnotationMode.ENABLE_STORAGE`). Danach wird nur das Seitenbild neu gezeichnet; das alte bleibt bis dahin stehen.
- Die Hinweisfenster von pdf.js (Popups) sind aus. Kommentartexte zeigt und bearbeitet die Kommentarliste; die Popups würden nach dem Bearbeiten veraltete Texte zeigen.
- Der eingebaute Editor von pdf.js wird nicht genutzt: Er kennt weder Antworten noch Prüfstatus noch Rechtecke, Linien und Stempel, und gespeichert wird ohnehin mit PDFium (ADR 0001).

### Speichern

- PDFium-WASM in einem eigenen Worker wendet die Änderungen auf die Originalbytes an und speichert **inkrementell**. Die alte Datei steht damit unverändert am Anfang der neuen.
- Darstellungen (`/AP`) erzeugt PDFium (`EPDFAnnot_GenerateAppearance`). Stempel bekommen eine eigene Darstellung aus Rahmen und Schrift (Helvetica-Bold, Standardschrift, daher keine eingebettete Schriftdatei).
- Hat sich nur Text, Antwort oder Status geändert, bleibt die vorhandene Darstellung unangetastet. Vorhandene Kommentare behalten ihre Merkmale (z. B. „gesperrt“). Formatierten Text (`/RC`, so speichert Acrobat Kommentartexte) ersetzt die App mit, sonst zeigte Acrobat weiter den alten Text.
- Prüfung vor dem Schreiben: Die neuen Bytes werden in PDFium als neues Dokument geöffnet. **Abweichung von CLAUDE.md** („frische PDFium-Instanz“): Es ist dieselbe WASM-Instanz, aber ein unabhängig aus den Bytes geladenes Dokument. Eine zweite Instanz würde bei großen Dateien noch einmal denselben Speicher belegen und prüft nichts anderes.
- Der Worker beendet sich 2 Sekunden nach dem letzten Auftrag. WASM-Speicher schrumpft nie; ohne Beenden blieben nach dem Speichern einer 119-MB-Datei rund 800 MB belegt.
- Schreiben, Prüfung auf Änderungen von außen und Zurückfragen laufen wie in CLAUDE.md beschrieben im Hauptprozess (temporäre Datei, `fsync`, `rename`).
- Nach dem Speichern lädt der Tab die neue Datei; Seite, Zoom und Ansicht bleiben erhalten.

### Drucken

Mit ungespeicherten Kommentaren erzeugt PDFium den aktuellen Stand im Speicher; gedruckt wird dieser. Die Datei bleibt unverändert.

### Verfasser

Name aus den Einstellungen. Ohne Eintrag unter macOS der vollständige Name des Benutzerkontos, sonst der Anmeldename.

## Einschränkungen

- **Stempel aus anderen Programmen:** pdf.js liefert ihren Namen nicht. Die Liste zeigt „Stempel“; verschiebt man einen solchen Stempel, zeigt die Vorschau bis zum Speichern nur seinen Umriss.
- **Füllfarbe vorhandener Rechtecke und Ellipsen** liefert pdf.js nicht. Sie bleibt beim Ändern erhalten, wird aber in der Vorschau nicht gezeigt.
- **Wellenlinie** wird angezeigt und bearbeitet, ist aber kein Werkzeug (Acrobat bietet sie auch nicht an).
- Hinweisfenster von Arten, die die App nicht verwaltet (Polygon, Einfügezeichen, Dateianhang), sind ebenfalls aus.
- Nach dem Speichern baut der Tab die Ansicht neu auf (kurzes Neuladen); die genaue Scrollposition innerhalb der Seite kann sich leicht verschieben.

## Tests

- Unit: Geometrie, Anlegen, Änderungsberechnung, Rückgängig/Wiederholen, Einlesen aus pdf.js, PDF-Datum.
- Integration: alle Arten mit PDFium anlegen und inkrementell speichern, Prüfung mit pdf.js und `@cantoo/pdf-lib` (jede sichtbare Anmerkung hat `/AP`); ändern und löschen über die Objektnummer; `/RC` und Merkmale; verschlüsselte Dateien.
- Oberfläche: alle Werkzeuge mit der Maus, Speichern, neu Öffnen, Prüfung mit Apple PDFKit (Engine von „Vorschau“); Rückgängig/Wiederholen; Verschieben und Größe ändern; Antworten, Status, Löschen vorhandener Kommentare; Rückfragen beim Schließen und bei von außen geänderten Dateien; „Speichern unter“; Drucken mit ungespeicherten Kommentaren; gesperrte Dokumente.
