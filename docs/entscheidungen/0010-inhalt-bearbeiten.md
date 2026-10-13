# 0010: Seiteninhalt bearbeiten (Text und Bilder)

- Status: angenommen (2026-10-14, Phase 5)

## Was realistisch ist

Die Spezifikation verlangt, vorher zu erklären, was beim Bearbeiten vorhandenen Texts realistisch ist.

- **Gut machbar:**
  - neuen Text und neue Bilder einfügen,
  - vorhandene Textzeilen, Bilder und Grafikgruppen verschieben, gleichmäßig vergrößern oder verkleinern und löschen.
- **Machbar mit Grenzen:** eine vorhandene Textzeile umschreiben.
  - PDFs betten oft nur die Buchstaben ein, die im Dokument vorkommen (Teilschriften).
  - Fehlt ein neues Zeichen in der Schrift der Zeile, bekommt die Zeile eine ähnliche Standardschrift: Helvetica, Times oder Courier, je normal oder fett. Lage, Größe, Farbe und Darstellungsart bleiben gleich.
  - Die App zeigt das schon beim Tippen an.
  - Zeichen, die auch die Standardschriften nicht kennen (außerhalb des westeuropäischen Zeichensatzes), werden mit Namen gemeldet und nicht übernommen.
- **Nicht machbar:** Absätze, die sich nach einer Änderung neu umbrechen.
  - Ein PDF kennt keine Absätze, nur einzeln gesetzte Zeilen (oft sogar Zeilenstücke).
  - Längerer Text wird deshalb nicht in die nächste Zeile umbrochen.
  - Gescannte Seiten sind Bilder; ihr Text wird erst durch die Texterkennung (Phase 6) bearbeitbar.

## Entscheidung

- **Werkzeug:** PDFium (`src/workers/pdfium/content.ts`), denn nur PDFium kann vorhandene Seitenobjekte lesen und ändern.
- **Objekte:** Eine Zeile oder ein Zeilenstück ist ein Textobjekt. Bilder und Formular-XObjects sind je ein Objekt. Vektorgrafik wird nicht einzeln angeboten; Seiten bestehen oft aus Tausenden Pfaden.
- **Speichern:** Nach jeder Änderung schreibt PDFium den Inhalt der Seite neu (`FPDFPage_GenerateContent`). Das ist für echte Inhaltsänderungen unvermeidlich, so arbeitet auch Acrobat. Gespeichert wird inkrementell.
- **Fehlende Zeichen erkennen:** PDFium liefert für ein fehlendes Zeichen die Form des Ersatzzeichens (.notdef). Die App vergleicht deshalb mit einem Zeichen, das keine Schrift enthält (U+F8FF). Geprüft werden der westeuropäische Zeichensatz und alle Zeichen, die auf der Seite in dieser Schrift vorkommen. So bleibt eine vorhandene Schrift erhalten, wann immer es geht.
- **Gedrehte Seiten:** Neuer Text und neue Bilder stehen aufrecht zur Anzeige.
- **Bedienung:** wie bei Formularfeldern ([0007](0007-formulare.md)).
  - Modus „Inhalt bearbeiten“, eigene Ebene über der Seite.
  - Klicken wählt, Ziehen verschiebt, Ecken skalieren, Doppelklick ändert eine Zeile, Entfernen löscht.
  - Das Text-Werkzeug schreibt an der Klickstelle; Cmd+Eingabe übernimmt.
  - Jede Änderung ist ein neuer Dokumentstand mit Rückgängig.
- **Bereitstellen der Objekte:** Die Objektliste holt die App je sichtbarer Seite aus dem Worker. Anfragen werden kurz gesammelt, damit PDFium das Dokument nur einmal öffnet.

## Einschränkungen

- Kein Neuumbruch von Absätzen (siehe oben).
- Schriftart, Größe und Farbe vorhandener Zeilen lassen sich nicht direkt umstellen. Möglich ist: Zeile löschen und neu schreiben.
- Inhalte in Formular-XObjects (zum Beispiel aus manchen Grafikprogrammen) lassen sich nur als Ganzes verschieben oder löschen.
- Für andere Schriftsysteme fehlen eingebettete Schriften (wie in ADR 0009).
