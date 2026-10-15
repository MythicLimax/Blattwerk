# 0019 Textdokumente in PDF umwandeln

Stand: 2026-10-15 · nach Phase 7 (Wunsch des Auftraggebers)

## Entscheidung

- **Formate:** Word (.docx, .docm, .dotx), OpenDocument-Text (.odt, .ott; LibreOffice, OpenOffice), RTF (TextEdit,
  WordPad), Text (.txt) und Markdown (.md). Pages-Dateien nur, wenn sie eine fertige PDF-Vorschau enthalten
  (`QuickLook/Preview.pdf`); sonst Hinweis auf „Exportieren“ in Pages. Alte Word-Dateien (.doc, Word 97–2003) werden
  erkannt und mit Hinweis abgelehnt (Binärformat, eigener Leser wäre sehr aufwendig).
- **Weg:** Eigene Leser übersetzen jedes Format in ein einfaches Dokumentmodell (`src/main/convert/model.ts`):
  Absätze mit Zeichen- und Absatzformat, Überschriften, Listen mit berechneten Nummern, Tabellen (verbundene Zellen),
  Bilder, Links, Seitenumbrüche, Seitenformat, Fußnoten (am Ende). Daraus entsteht HTML, das Chromium im Hauptprozess
  per `printToPDF` setzt: echter Zeilenumbruch, Silbentrennung, Unicode, eingebettete Schriften; dazu Tags
  (`generateTaggedPDF`) und Lesezeichen aus den Überschriften (`generateDocumentOutline`).
- **Sicherheit:** Das unsichtbare Fenster hat eine eigene Sitzung ohne Netz (nur die eine temporäre HTML-Datei und
  `data:`-Bilder), JavaScript ist aus, CSP `default-src 'none'`. Alle Texte werden maskiert, Links nur http/https/mailto.
  Eigener XML-Leser ohne DTD-Auswertung (kein XXE), ZIP mit Größengrenzen (Einträge, entpackte Größe).
- **Ablauf:** „Ablage → PDF aus Textdokument erstellen …“ oder Datei ins Fenster ziehen → Sichern-Dialog (Ordner der
  Quelle) → das PDF öffnet sich im Tab.

## Grenzen (vereinfachtes Layout)

- Kopf- und Fußzeilen, Textfelder, Formen, SmartArt, Diagramme, Kommentare und Änderungsverfolgung entfallen
  (gelöschter Text wird ausgelassen, eingefügter übernommen). Mehrere Abschnitte mit verschiedenen Seitenformaten:
  es gilt das letzte. Spalten werden einspaltig.
- Schriften, die auf dem Mac fehlen (z. B. Calibri ohne Office), ersetzt eine ähnliche (Helvetica Neue, Times);
  Zeilen- und Seitenumbrüche können deshalb abweichen.
- Bilder: PNG, JPEG, GIF, BMP, WebP; EMF/WMF (alte Office-Grafiken) entfallen.

## Verworfen

- **LibreOffice im Hintergrund:** beste Treue, aber 600 MB, MPL/LGPL, nicht mitlieferbar.
- **mammoth.js:** gute DOCX-Semantik, aber verwirft Schriftgrößen, Farben und Ausrichtung; nur DOCX.
- **Eigenes Setzen mit pdf-lib:** Zeilenumbruch, Tabellen und Schriften selbst zu bauen wäre viel Arbeit und
  schlechter als Chromium, das ohnehin in der App steckt.
