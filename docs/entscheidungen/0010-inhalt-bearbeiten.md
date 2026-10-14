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
- **Zeilen statt Stücke** (ergänzt 2026-10-14, Version 0.5.3): Textprogramme speichern eine Zeile oft in vielen Stücken (Wörter, Wortteile). `editUnits` (`src/shared/content.ts`) fasst Stücke zusammen, die auf derselben Höhe liegen, dieselbe Schrift, Größe und Farbe haben und nur durch kleine Lücken getrennt sind. Die Zeile ist dann eine Einheit: auswählen, verschieben, skalieren und löschen wirken auf alle Stücke. Beim Ändern schreibt PDFium den ganzen Text ins erste Stück und entfernt die übrigen (`editText` mit `merge`). Andere Schriften in der Zeile (zum Beispiel ein fettes Wort) und große Lücken (Spalten, Tabellen) bleiben getrennt, damit keine Formatierung stillschweigend verloren geht.
- **Ligaturen:** Textprogramme legen verbundene Zeichen (ft, ff, fl …) oft in einen eigenen Teil derselben Schrift. Stücke gelten deshalb als gleiche Schrift, wenn der Schriftname gleich ist.
- **Absätze** (ergänzt 2026-10-14, Version 0.5.4): Zeilen bilden einen Absatz, wenn sie waagerecht laufen, direkt untereinander mit gleichmäßigem Abstand stehen (Grundlinien aus PDFium), links bündig sind (die erste Zeile darf eingerückt sein), gleich aussehen, keine weiteren Textstücke in derselben Zeile haben (eine Nummer links davor ist erlaubt) und der Block mindestens zwölf Schriftgrößen breit ist. Schmale Blöcke wie Adressen bleiben einzelne Zeilen.
  - Bearbeiten: Der Text erscheint in einem Feld in Absatzbreite. Endete eine Zeile deutlich vor dem rechten Rand, obwohl das nächste Wort gepasst hätte, bleibt der Umbruch als gewollter Umbruch erhalten. Trennstriche der Silbentrennung entfallen. Eingabe beginnt eine neue Zeile, Cmd+Eingabe übernimmt.
  - Neu setzen (`editParagraph`, `setParagraph` im Worker): Wörter werden mit den echten Zeichenbreiten der Schrift (gemessen mit PDFium) in die bisherige Breite umbrochen, linksbündig, mit dem bisherigen Zeilenabstand und linken Rand. Vorhandene Zeilen werden wiederverwendet, zusätzliche in derselben Schrift angelegt (`FPDFPageObj_CreateTextObj`), überzählige entfernt. Fehlen Zeichen in der Schrift, bekommt der ganze Absatz eine ähnliche Standardschrift.
- **Schriftgröße:** Viele PDFs setzen Größe 1 und skalieren über die Textmatrix. Für die Eingabe zählt die sichtbare Größe (`visualSize`).
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

- Absätze werden linksbündig neu gesetzt; Blocksatz, zentrierter und rechtsbündiger Text werden nicht als Absatz erkannt bzw. verlieren den Blocksatz. Wird ein Absatz länger, schiebt er nachfolgenden Inhalt nicht nach unten (wie in Acrobat); er kann ihn überlappen.
- Absätze mit unterschiedlich formatierten Wörtern (zum Beispiel ein fettes Wort) bleiben einzelne Zeilen und Stücke.
- Eine geänderte Zeile verliert Abstände, die das Ursprungsprogramm zwischen Stücken gesetzt hatte (zum Beispiel bei Blocksatz); die Wörter stehen danach mit normalen Abständen.
- Schriftart, Größe und Farbe vorhandener Zeilen lassen sich nicht direkt umstellen. Möglich ist: Zeile löschen und neu schreiben.
- Inhalte in Formular-XObjects (zum Beispiel aus manchen Grafikprogrammen) lassen sich nur als Ganzes verschieben oder löschen.
- Für andere Schriftsysteme fehlen eingebettete Schriften (wie in ADR 0009).
