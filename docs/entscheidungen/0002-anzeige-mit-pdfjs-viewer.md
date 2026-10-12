# 0002: Anzeige mit den Viewer-Bausteinen von pdf.js

- Status: angenommen (2026-10-12, Phase 1)

## Entscheidung

Die Seitenansicht nutzt die offiziellen Anzeige-Bausteine aus `pdfjs-dist/web/pdf_viewer.mjs`:
`PDFViewer` (Seiten, Textebene, Link-Ebene, Zoom, Ansichtsmodi), `PDFFindController` (Suche mit Markierung)
und `PDFLinkService` (interne Links, Lesezeichen). Werkzeugleiste, Seitenleisten, Tabs und Dialoge sind
eigene React-Komponenten. Miniaturen rendert ein eigener, virtualisierter Baustein.

## Begründung

- Dieselben Bausteine stecken im PDF-Viewer von Firefox. Sie rendern nur sichtbare Seiten, verwerfen
  ältere Seiten aus einem Cache und zoomen bei hoher Vergrößerung mit einem Detail-Canvas statt riesiger Bilder.
- Textauswahl, Kopieren, Trefferhervorhebung und Links funktionieren ohne eigene Nachbauten.
- Ansichtsmodi: „Einzelne Seite“ = `ScrollMode.PAGE`, „fortlaufend“ = `ScrollMode.VERTICAL`,
  „Zwei Seiten“ = `SpreadMode.ODD` (1|2, 3|4 wie Acrobat).

## Rendern im Worker (geplanter Spike aus CLAUDE.md)

Ergebnis: **nicht umgesetzt, weil nicht nötig.** pdf.js parst, lädt Schriften und dekodiert Bilder im Worker
(`isOffscreenCanvasSupported: true`). Nur das Zeichnen läuft im Hauptthread, und zwar in Häppchen von etwa
15 ms. Ein Rendern komplett im Worker würde bedeuten, Textebene, Link-Ebene und Suchmarkierung selbst
nachzubauen, weil diese Bausteine DOM-Elemente brauchen.

Messung im Oberflächentest mit der großen Testdatei (600 Seiten, 114 MB): Öffnen in rund 0,5 s, beim Springen
und schnellen Scrollen längste Blockade des Hauptthreads 0 bis 140 ms. Der Test schlägt fehl, wenn eine
Blockade 500 ms überschreitet.

## Große Dateien

Dateien über 8 MB lädt pdf.js über einen eigenen Range-Transport in 1-MB-Blöcken aus dem Hauptprozess
(höchstens 6 Anfragen gleichzeitig). Bekannte Eigenheit: pdf.js liest beim Öffnen die Beschreibungen aller
Seiten vorab. Liegen diese über die Datei verteilt (wie bei vielen Scannern und in der Testdatei), wird dabei
fast die ganze Datei gelesen. Das geschieht parallel und dauert bei 114 MB etwa eine halbe Sekunde.
