# Phase 3: Seiten organisieren – Abschlussbericht

Stand: 2026-10-13 · Version 0.3.0 · Paket: `release/Blattwerk-0.3.0-arm64.dmg`

## Was funktioniert

| Anforderung | Umsetzung | Geprüft durch |
|---|---|---|
| Seitenraster | „Seiten organisieren“ (Knopf in der Werkzeugleiste, Menü „Dokument“) zeigt alle Seiten als Miniaturen. Auswahl per Klick, Umschalt-Klick, Cmd-Klick, Pfeiltasten und „Alle auswählen“. Doppelklick öffnet die Seite. | Oberflächentests |
| Umsortieren per Drag & Drop | Seiten (auch mehrere) an eine andere Stelle ziehen; eine Marke zeigt die Einfügestelle | Oberflächentests |
| Drehen | Im Raster, an der einzelnen Seite oder per Menü und Umschalt+Cmd+R (wie Acrobat) | Oberflächen- und Integrationstests |
| Löschen | Im Raster, mit der Entfernen-Taste oder per Dialog mit Seitenangabe (z. B. „1-3, 5“) über Umschalt+Cmd+D. Alle Seiten zu löschen ist nicht möglich. | Oberflächen- und Integrationstests |
| Leere Seiten einfügen | Anzahl und Stelle (vor/nach erster, letzter oder bestimmter Seite) wählbar; Größe wie die Nachbarseite | Oberflächen- und Integrationstests |
| Seiten aus anderen PDFs einfügen | Über Dialog (Umschalt+Cmd+I) oder durch Ziehen von Dateien aus dem Finder ins Raster. Kennwortgeschützte PDFs fragen nach dem Kennwort. | Oberflächen- und Integrationstests |
| Bilder einfügen | JPEG und PNG (auch mit Transparenz) als neue Seiten. Handyfotos stehen richtig herum (EXIF-Drehung). | Oberflächen-, Integrations- und Unit-Tests |
| Seiten extrahieren | Als neues Dokument (wird gespeichert und geöffnet) oder jede Seite als eigene Datei; auf Wunsch danach löschen | Oberflächentests |
| Dokument teilen | Nach Seitenanzahl oder an den obersten Lesezeichen (z. B. je Kapitel eine Datei), in einen gewählten Ordner | Oberflächentests |
| Dateien zusammenführen | „Ablage → Dateien zusammenführen …“: PDFs und Bilder in beliebiger Reihenfolge zu einem neuen Dokument | Oberflächentests |
| Bilder in PDF umwandeln | „Ablage → PDF aus Bildern erstellen …“: eine Seite je Bild | Oberflächentests, Prüfung mit Apple PDFKit |
| Rückgängig/Wiederholen | Für alle Seitenänderungen, gemeinsam mit den Kommentaren in einem Verlauf; mehrfach schnell hintereinander ohne Verlust | Oberflächen- und Unit-Tests |
| Speichern | Erst beim Speichern ändert sich die Datei, inkrementell (das Original steht unverändert am Anfang). Ungespeicherte Kommentare bleiben bei Seitenänderungen erhalten und wandern mit ihrer Seite. | Oberflächentests |
| Geschützte PDFs | Verbietet ein PDF das Zusammenstellen, sind Drehen, Löschen und Einfügen gesperrt (mit Hinweis). Extrahieren und Teilen hängen am Recht zum Kopieren. | Oberflächentest |
| Große Dateien | 600 Seiten, 119 MB: Drehen 0,35 s, Rückgängig 0,4 s, Speichern 0,2 s; rund 630 MB Arbeitsspeicher | Messung |

## Tests

- **Unit- und Integrationstests:** 124 (`npm test`), davon 33 neu:
  - Seitenangaben, Verschieben, Teilen, Bildmaße und EXIF, Dateinamen,
  - Verlauf der Dokumentstände,
  - PDFium-Seitenoperationen mit allen Test-PDFs und Testbildern.
- **Oberflächentests:** 54 mit der echten App (`npm run test:e2e`), davon 10 neu für Phase 3.
- **Neue Testbilder** in `test/fixtures/images/`: JPEG, PNG und PNG mit Transparenz, erzeugt von `scripts/generate-fixtures.ts`.
- **Rauchtest** der fertig gebauten App bestanden.

## Beim Testen gefundene und behobene Fehler

- Die Werkzeugleiste, die beim Überfahren einer Seite erscheint, lag mitten auf querformatigen Miniaturen. Ein Klick zum Auswählen hätte die Seite gedreht. Sie sitzt jetzt am oberen Rand.
- Wer ein Kommentarfeld bearbeitete und dann ins Seitenraster wechselte oder speicherte, verlor den gerade getippten Text. Offene Eingaben werden jetzt vorher übernommen.
- Zweimal schnell Rückgängig: Der zweite Befehl ging verloren. Jetzt laufen die Befehle nacheinander.
- Beim sehr schnellen Ziehen und Loslassen konnte das Verschieben ausbleiben.

## Was nicht oder nur eingeschränkt geht

- **Lesezeichen und Links** auf gelöschte Seiten bleiben als tote Verweise im Dokument.
- **Formularfelder** aus eingefügten PDFs: ob sie im neuen Dokument ausfüllbar bleiben, wird in Phase 4 (Formulare) geprüft.
- **Neue Dokumente aus kennwortgeschützten Quellen** sind selbst nicht geschützt; Kennwörter setzen kommt in Phase 6.
- **Seiten ersetzen** (Acrobat: „Seiten ersetzen“) und **Seiten zuschneiden** gibt es noch nicht.
- **Ziehen zwischen Tabs** (Seiten von einem Dokument in ein anderes ziehen) gibt es noch nicht; Einfügen aus Datei geht.
- **Im Seitenraster** sind Zoom, Suche, Kommentarwerkzeuge und die linke Seitenleiste ausgeblendet; zurück geht es mit dem Pfeil oben links oder einem Doppelklick auf eine Seite.
- **Windows** ist weiterhin nicht gebaut und nicht getestet.

## Bitte einmal von Hand ausprobieren

1. Mehrere Fotos vom iPhone über „Ablage → PDF aus Bildern erstellen …“ umwandeln und prüfen, ob alle aufrecht stehen.
2. Ein PDF aus dem Finder ins Seitenraster ziehen.
3. Das Ergebnis in Vorschau und, falls vorhanden, Acrobat Reader öffnen.

## Bekannte Bugs

Keine offenen bekannten Bugs.
