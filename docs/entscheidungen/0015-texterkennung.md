# 0015: Texterkennung (OCR)

- Status: angenommen (2026-10-15, Phase 6)

## Anforderung

OCR für gescannte PDFs mit durchsuchbarer Textebene, Sprachen Deutsch und Englisch.

## Entscheidung

- **Engine: tesseract.js 7.0.0** (Apache-2.0) mit dem LSTM-Kern aus `tesseract.js-core` (WASM) und den Sprachdaten `@tesseract.js-data/deu` und `/eng` (Modell `4.0.0_best_int`, MIT-Paket, Daten Apache-2.0). Alles wird beim Build nach `public/ocr` kopiert (etwa 17 MB) und aus dem App-Paket geladen: kein Netz, kein Zwischenspeicher (`cacheMethod: 'none'`), Worker ohne Blob-URL (CSP). Der Kern liegt in drei Varianten bei (ohne SIMD, SIMD, Relaxed SIMD); tesseract.js wählt die passende.
- **Ablauf** (`features/ocr/actions.ts`): PDFium-Sitzung mit dem aktuellen Stand; je Seite prüfen, ob sie schon Text hat (dann überspringen), sonst mit 300 dpi zeichnen und als Graustufenbild (PGM, ohne Bildkodierung) an tesseract.js geben. Fortschritt je Seite mit „Abbrechen“.
- **Textebene** (`addOcrText` in `workers/pdfium/content.ts`): Jedes erkannte Wort wird ein unsichtbares Textobjekt (Darstellungsart 3) in Helvetica. PDFium rechnet die Bildpunkte in Seitenkoordinaten um (`FPDF_DeviceToPage`, auch bei gedrehten Seiten); das Wort wird in Leserichtung so gedehnt, dass es genau über dem Wort im Bild liegt. So treffen Suchen, Markieren und Kopieren die richtige Stelle. Wörter mit geringer Sicherheit (unter 30) entfallen; Ligaturen werden aufgelöst, Zeichen außerhalb des westeuropäischen Zeichensatzes weggelassen.
- Ergebnis ist ein neuer Dokumentstand (inkrementell gespeichert, Rückgängig möglich). Unsichtbarer Text wird beim Bearbeiten des Inhalts nicht angeboten.

## Grenzen

- Die Qualität hängt vom Scan ab: Bei 200 dpi und weniger werden Umlaute und ß öfter falsch gelesen; 300 dpi sind die übliche Empfehlung.
- Schräg eingescannte Seiten werden nicht gerade gerichtet; die Textebene folgt dann der Zeile nur ungefähr.
- Nur Deutsch und Englisch; weitere Sprachen ließen sich als Sprachdaten nachrüsten.
- Seiten mit wenig Text und einem Scan (Mischseiten) gelten ab 20 Zeichen als „mit Text“ und werden übersprungen.

## Prüfung

- `test/integration/ocr.test.ts`: echte Erkennung der Scan-Testdatei in Node, Textebene mit pdf.js geprüft (Wörter, Lage auf 2 Punkt genau), nicht bearbeitbar.
- `test/e2e/tools.spec.ts`: ganzer Weg in der App, Speichern, Überspringen beim zweiten Mal.

## Nachtrag 2026-10-24: Text im Bild bearbeitbar machen

Beim Bearbeiten von Text und Bildern hat ein ausgewähltes Bild den Knopf „Text im Bild bearbeitbar machen“ (wie
„Scans bearbeiten“ in Acrobat; Anlass: Beispiel des Auftraggebers, Fließtext als Bild). Der Bildbereich wird mit 300 dpi
gezeichnet und erkannt (`linesFromBlocks`); jede Zeile bekommt eine Abdeckfläche in der Hintergrundfarbe (gemessen
knapp außerhalb der Zeile) und darüber echten Text in Helvetica, Größe aus Höhe und Breite, Farbe aus den dunkelsten
Bildpunkten, fett bei deutlich dickeren Strichen als die übrigen Zeilen (`boldLines`). Die Bildpunkte darunter bleiben
im Bild erhalten (vertrauliches: Schwärzen). Nur ungedrehte Seiten; Erkennungsfehler sind möglich, die Meldung sagt das.
Beim Anklicken liegt Text immer über Bildern (`ContentEditOverlay`, Stapelung).
