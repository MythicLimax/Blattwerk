# 0014: Zwei PDFs vergleichen

- Status: angenommen (2026-10-15, Phase 6)

## Entscheidung

- **Bedienung:** „Werkzeuge → Mit Datei vergleichen …“. Das geöffnete Dokument (mit ungespeicherten Änderungen) ist die alte Fassung, die gewählte Datei die neue. Das Ergebnis ist ein **Vergleichsbericht als neues PDF**, der gespeichert und gleich geöffnet wird. So lässt er sich weitergeben und drucken, und die App braucht keine eigene Vergleichsansicht.
- **Text, Wort für Wort:** PDFium liefert je Seite die Wörter mit ihrer Lage (`DocumentSessions.words`). Verglichen wird mit dem Verfahren von Myers (`diffWords` in `src/shared/compare.ts`), das die kleinste Menge an Änderungen findet. Bei sehr vielen Unterschieden (über 4000 je Seite) gilt die ganze Seite als geändert, damit Rechenzeit und Speicher begrenzt bleiben.
- **Seiten nach Reihenfolge:** Seite 1 mit Seite 1 usw.; überzählige Seiten gelten als neu bzw. entfernt.
- **Bericht** (`src/workers/pdfium/compare.ts`, pdf-lib): Übersicht mit Zahlen und kurzen Ausschnitten je Seite, danach für jede geänderte Seite alt und neu nebeneinander (Querformat). Entfernte Wörter sind links rot, neue rechts grün markiert. Verschlüsselte Dokumente werden nur für den Bericht entschlüsselt; der Bericht selbst ist ungeschützt. Die Texte des Berichts übersetzt die Oberfläche und gibt sie dem Worker mit.

## Grenzen

- Nur Text: Geänderte Bilder, Grafiken oder Formatierung (Schrift, Farbe) erkennt der Vergleich nicht.
- Eingefügte oder gelöschte Seiten verschieben die Zuordnung: Danach erscheinen die folgenden Seiten als geändert. Eine Zuordnung nach Ähnlichkeit wäre ein möglicher nächster Schritt.
- Gescannte Seiten ohne Text lassen sich erst nach der Texterkennung vergleichen.

## Prüfung

- `test/unit/compare.test.ts`: Myers-Vergleich (einfügen, entfernen, ersetzen, leer, Begrenzung).
- `test/integration/compare.test.ts`: Wörter mit Lage, Bericht mit geänderter, gleicher und neuer Seite, ohne Unterschiede.
- `test/e2e/tools.spec.ts`: ganzer Weg in der App bis zum geöffneten Bericht.
