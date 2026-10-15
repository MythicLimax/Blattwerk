# 0012: Export als Bilder und Text, kein Word-Export

- Status: angenommen (2026-10-15, Phase 6)

## Anforderung

Export als Bilder und Text, Word nur, wenn es sauber machbar ist.

## Entscheidung

- **Zeichnen und Textauslesen mit PDFium im Worker** (`src/workers/pdfium/render.ts`). Eine **Sitzung** hält das Dokument für alle Seiten geöffnet, damit große Dateien nicht je Seite neu geladen werden. Solange eine Sitzung offen ist, beendet sich der Worker nicht (`openSessions` in `pdfium-client.ts`). Ungespeicherte Kommentare und Formularwerte werden vorher übernommen; exportiert wird also, was man sieht.
- **Bilder:** PNG oder JPEG (drei Qualitätsstufen), 72 bis 600 dpi, alle Seiten oder ein Bereich. Kodiert wird im Worker über `OffscreenCanvas`. Seiten über 70 Megapixel werden verkleinert (sonst reicht der Speicher nicht). Gedrehte Seiten erscheinen aufrecht, Kommentare sind enthalten.
- **Schreiben Seite für Seite:** Der Ordner wird einmal im Systemdialog gewählt; der Renderer bekommt dafür nur ein Kennzeichen (`export:choose-folder`). Jede Datei prüft der Hauptprozess am Inhalt (PNG- bzw. JPEG-Kopf), gibt ihr einen sicheren Namen und überschreibt nie eine vorhandene Datei (`Name (2).png`). So liegt nie der ganze Export auf einmal im Speicher.
- **Text:** PDFium liest jede Seite in Lesereihenfolge mit Zeilenumbrüchen; zwischen den Seiten steht eine Leerzeile. Gespeichert als UTF-8 über den Sichern-Dialog (`export:save-text`).
- **Berechtigungen:** Verbietet das Dokument das Kopieren, ist auch der Export gesperrt, wie in anderen Programmen.
- **Fortschritt:** Längere Aufgaben zeigen einen Fortschrittsdialog mit „Abbrechen“ (`features/progress/`); ihn nutzen später auch Texterkennung, Komprimieren und Vergleich.

## Kein Export nach Word

Ein PDF kennt nur einzeln gesetzte Zeichen und Linien, keine Absätze, Tabellen oder Formatvorlagen. Eine Word-Datei, die beim Weiterschreiben sauber umbricht, müsste all das erraten. Freie Bibliotheken dafür gibt es nicht; die guten Umsetzer (Acrobat, ABBYY) sind große kommerzielle Produkte. Ein schneller Nachbau lieferte entweder Textfelder an festen Stellen (in Word kaum bearbeitbar) oder Fließtext ohne Tabellen und Layout. Beides wäre „halbgar“.

Alternative für den Auftraggeber:
- **Als Text exportieren** und in Word einfügen, wenn es um den Inhalt geht.
- **Inhalt direkt in Blattwerk bearbeiten** (Zeilen und Absätze, Phase 5), wenn es um kleine Änderungen am PDF geht.

## Prüfung

- `test/integration/render.test.ts`: Auflösung, Text mit Umlauten, gedrehte Seite, Verkleinern sehr großer Seiten, verschlüsselte Dokumente, beendete Sitzung.
- `test/e2e/tools.spec.ts`: PNG mit Seitenbereich (Bildgröße im PNG-Kopf), JPEG aller Seiten ohne Überschreiben, Text, Sperre bei verbotenem Kopieren.
