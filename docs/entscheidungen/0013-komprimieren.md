# 0013: PDFs komprimieren

- Status: angenommen (2026-10-15, Phase 6)

## Entscheidung

- **Ablauf im Worker:** PDFium übernimmt Kommentare und Formularwerte und schreibt vollständig. Danach verkleinert pdf-lib (`src/workers/pdfium/compress.ts`):
  - Nicht mehr erreichbare Objekte entfallen (ältere Stände, verwaiste Objekte).
  - **Bilder** mit 8 Bit je Kanal in Grau, RGB oder ICC-RGB, als JPEG oder Flate (auch mit PNG-Prädiktoren) gespeichert, werden gelesen, bei Bedarf durch Mitteln verkleinert und als JPEG neu kodiert. Ersetzt wird nur, was mindestens 10 % kleiner wird. Transparenzmasken (`/SMask`) bleiben unverändert; ihre Auflösung darf laut Norm vom Bild abweichen. Geteilte Bilder werden einmal behandelt, weil die App über die Objekte geht, nicht über die Seiten.
  - Ungepackte Datenströme werden mit Flate gepackt; gespeichert wird mit Objektströmen.
- **Zielauflösung ohne Lageberechnung:** Wie groß ein Bild auf der Seite erscheint, steht im Seiteninhalt und kann je Verwendung verschieden sein. Die App nimmt deshalb als Obergrenze die lange Seite des größten Blatts bei der Auflösung der Stufe (Mittel: 150 dpi, also etwa 1750 Bildpunkte bei A4). Für ganzseitige Scans, den häufigsten Fall, ist das genau richtig. Kleine, stark verkleinert gezeigte Bilder werden dadurch weniger reduziert als möglich, aber nie zu stark.
- **Stufen:** Leicht (300 dpi, Qualität 85), Mittel (150 dpi, 75), Stark (100 dpi, 60).
- **JPEG-Kodierung** im Worker über den Browser (`createImageBitmap`, `OffscreenCanvas`), in den Tests über `jpeg-js` (nur Entwicklung, BSD-3). Nicht behandelt: CMYK, Lab, indizierte Farben, 1-Bit-Scans (sind meist schon kompakt), JBIG2, JPEG 2000.
- Ergebnis ist ein neuer Dokumentstand; wird die Datei nicht mindestens 2 % kleiner, bleibt sie unverändert mit Hinweis. Verschlüsselte Dokumente erst nach dem Entfernen des Kennwortschutzes. Signaturen werden ungültig (Warnung im Dialog).

## Prüfung

- `test/integration/compress.test.ts`: Größe, Bildmaße, Aussehen (mittlere Farben gerendert mit PDFium), Maske, Text, Stufen, unverschlüsselt, Hilfsfunktionen.
- `test/e2e/tools.spec.ts`: ganzer Weg mit Speichern in der App, Hinweis bei verschlüsselten Dokumenten.
