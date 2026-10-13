# 0008: Schwärzen

- Status: angenommen (2026-10-13, Phase 5)

## Anforderung

Schwärzen muss Inhalte **wirklich entfernen**, nicht nur überdecken: Text, Bilder und Metadaten. Ein Test muss genau das prüfen.

## Bedienung (wie Acrobat)

1. **Markieren:** Leiste „Schwärzen“ (Knopf in der Werkzeugleiste oder Menü „Dokument → Schwärzen“).
   - Bereiche aufziehen.
   - Markierten Text schwärzen.
   - „Text suchen und schwärzen“ markiert alle Treffer einer Suche, zum Beispiel einen Namen oder eine Kontonummer.

   Markierungen sind rot umrandet. Man kann sie verschieben, in der Größe ändern, löschen und rückgängig machen. Sie gehören zum Kommentarmodell (`RedactAnnotation`). Speichern ohne Anwenden legt sie als `/Redact`-Anmerkungen ab, wie Acrobat. Man kann sie also später anwenden, auch Markierungen aus Acrobat.
2. **Anwenden:** Eine Rückfrage erklärt, was passiert, und warnt bei digitalen Signaturen. „Auch Metadaten entfernen“ ist voreingestellt.

   Das Ergebnis ist ein neuer Stand im Arbeitsspeicher. Bis zum Speichern lässt es sich rückgängig machen.

## Technik

Die Suche nutzt PDFium (`FPDFText_FindStart` …), weil pdf.js nur ganze Textstücke ohne Lage einzelner Zeichen kennt.

Das Schwärzen läuft im Worker in drei Schritten (`src/workers/pdfium/redaction.ts`).

### 1. Geteilte Bilder trennen (pdf-lib, `sanitize.ts`)

PDFium überschreibt die Bildpunkte im Bildobjekt selbst. Steht dasselbe Bild auch auf einer anderen Seite, wäre es dort ebenfalls geschwärzt; der Versuch hat das gezeigt.

Deshalb bekommt jede betroffene Seite eigene Kopien:
- von Bildern, die mehr als einmal verwendet werden,
- von geteilten Formular-XObjects, rekursiv,
- von ihren Ressourcen-Wörterbüchern.

### 2. Entfernen (PDFium, `redact.ts`)

- **Text:** `EPDFText_RedactInRect` und `EPDFText_RedactInQuads` löschen die Zeichen im Bereich aus dem Inhaltsstrom, auch in Formular-XObjects.
- **Bilder:** Bildpunkte im Bereich werden überschrieben, ebenso die Transparenzmaske. Sonst bliebe zum Beispiel die Form einer Unterschrift im Alphakanal erhalten; der Versuch hat das geprüft. JPEGs werden dabei neu kodiert.
- **Vektorgrafik, Verläufe und Bilder, die ganz im Bereich liegen,** werden entfernt. PDFium lässt Pfade sonst vollständig in der Datei, nur überdeckt. Bei Text, der als Umrisse vorliegt, wäre das ein Leck.
- **Anmerkungen**, die den Bereich berühren, werden gelöscht: Links samt Adresse, Kommentare samt Popup, Formularfelder.
- **Schwarze Rechtecke** zeichnet die App selbst, auch über leeren Stellen.
- **Markierungen aus der Datei** (zum Beispiel aus Acrobat) liest PDFium mit genauer Lage aus `/QuadPoints`. pdf.js kennt nur ihr umgebendes Rechteck; das würde bei mehrzeiligen Markierungen zu viel schwärzen. Die App schickt für unveränderte Markierungen aus der Datei deshalb nur die Seite. Geänderte werden vorher gelöscht und mit neuer Lage geschickt.

PDFium speichert danach **vollständig** (`FPDF_NO_INCREMENTAL`).

### 3. Reste entfernen (pdf-lib, `sanitize.ts`)

- Formularfelder ohne Widget werden aus dem Formularverzeichnis entfernt. Sonst stünde ihr Wert weiter in der Datei.
- Auf Wunsch werden die Dokumentinformationen und die XMP-Metadaten gelöscht.
- **Alle nicht mehr erreichbaren Objekte werden verworfen.** Dazu gehören ältere Stände der Datei aus inkrementellen Speicherungen: Ein früher gelöschter Kommentar stünde sonst noch im alten Teil der Datei.
- Die Datei wird mit pdf-lib vollständig neu geschrieben. Sie hat danach genau einen Stand und keinen Verweis `/Prev`.

## Prüfung

`test/integration/redaction.test.ts` erzeugt ein Test-PDF mit Geheimnissen an allen bekannten Verstecken:
- Seitentext,
- zweiter Inhaltsstrom,
- Formular-XObject,
- Link-Adresse,
- Formularfeldwert samt Darstellung,
- Kommentar,
- Titel, XMP,
- ein Bild, das auch auf Seite 2 steht,
- eine kleine Vektorform,
- ein älterer Stand mit einem gelöschten Kommentar.

Geprüft wird:
- Kein Geheimnis steht mehr in der Datei, weder roh noch in entpackten Strömen. Gesucht wird als Klartext, als Hex (ASCII) und als UTF-16.
- pdf.js findet weder Text noch Anmerkungen mit Geheimnis.
- Öffentlicher Text und die Notiz außerhalb bleiben.
- Das Bild auf Seite 1 ist links überschrieben und rechts erhalten; auf Seite 2 ist es unverändert.
- An den Stellen liegt Schwarz, gemessen gerendert mit PDFium.
- Die Datei hat nur einen Stand.
- Markierungen aus der Datei wirken genau auf ihren Zeilen.

Die Oberflächentests (`test/e2e/edit.spec.ts`) prüfen den ganzen Weg von der Markierung bis zur gespeicherten Datei.

## Einschränkungen

- **Verschlüsselte Dokumente:** Markieren geht, Anwenden erst nach dem Entfernen des Kennwortschutzes (Phase 6). pdf-lib würde neue Zeichenketten unverschlüsselt schreiben.
- **Vektorgrafik, die den Bereich nur teilweise berührt**, bleibt vollständig erhalten und ist an der Stelle schwarz überdeckt. Das gilt auch für Pfade in Formular-XObjects. Umrisse einzelner Buchstaben liegen fast immer ganz im Bereich und werden entfernt.
- **Lesezeichen, Dateianhänge und Dokument-JavaScript** werden nicht automatisch durchsucht. Acrobat bietet dafür „Dokument bereinigen“; das ist ein möglicher späterer Schritt.
