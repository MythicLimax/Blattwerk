# Phase 2: Kommentieren – Abschlussbericht

Stand: 2026-10-12 · Version 0.2.0 · Paket: `release/Blattwerk-0.2.0-arm64.dmg`

## Was funktioniert

| Anforderung | Umsetzung | Geprüft durch |
|---|---|---|
| Hervorheben, Unterstreichen, Durchstreichen | Werkzeug wählen und Text markieren, oder erst Text markieren und dann das Werkzeug anklicken (wie in Acrobat). Auch über mehrere Zeilen und Seiten | Oberflächentests |
| Notizen | Klick auf die Seite setzt ein Notizsymbol, der Text wird gleich in der Kommentarliste eingegeben | Oberflächentests |
| Textfelder | Rahmen aufziehen oder klicken, direkt auf der Seite tippen; Doppelklick bearbeitet weiter; leere Textfelder verschwinden wieder; Schriftgröße und Farbe wählbar | Oberflächentests |
| Freihand | Zeichnen mit Maus oder Trackpad; kurz nacheinander gezogene Striche bilden eine Zeichnung (wie Handschrift) | Oberflächentests |
| Formen | Rechteck, Ellipse, Linie, Pfeil; Farbe und Linienstärke wählbar | Oberflächentests |
| Stempel | GENEHMIGT, ABGELEHNT, GEPRÜFT, ENTWURF, ENDGÜLTIG, VERTRAULICH, ZUR KOMMENTIERUNG (eigene Gestaltung) | Oberflächentests |
| Auswählen, Verschieben, Größe ändern | Anklicken, Ziehen, Griffe an den Ecken (bei Linien an den Enden), Pfeiltasten verschieben um 1 pt (mit Umschalt 10 pt), Entfernen/Rückschritt löscht, Esc hebt die Auswahl auf | Oberflächentests |
| Kommentarliste | Neuer Reiter „Kommentare“ in der linken Seitenleiste: nach Seiten geordnet, Verfasser, Datum, Text bearbeiten, Klick springt zur Stelle | Oberflächentests |
| Antworten und Status | Antworten schreiben, bearbeiten, löschen; Status „Angenommen“, „Abgelehnt“, „Abgebrochen“, „Erledigt“. Vorhandene Antworten und Status aus anderen Programmen werden gelesen | Oberflächen- und Unit-Tests |
| Rückgängig/Wiederholen | Für jede Aktion (Anlegen, Ändern, Verschieben, Löschen, Antworten, Status), über Menü, Cmd+Z / Umschalt+Cmd+Z und die Leiste | Oberflächen- und Unit-Tests |
| Vorhandene Kommentare | Kommentare aus anderen Programmen erscheinen in der Liste und lassen sich ändern, verschieben und löschen | Oberflächentests (Pixelprüfung des Seitenbilds) |
| Speichern | Cmd+S speichert inkrementell (Originaldatei steht unverändert am Anfang), sicher über temporäre Datei; „Speichern unter …“; Punkt im Tab bei ungespeicherten Änderungen | Oberflächentests |
| Rückfragen | Beim Schließen eines Tabs, Fensters oder der App mit ungespeicherten Änderungen: Speichern / Nicht speichern / Abbrechen. Wurde die Datei inzwischen von einem anderen Programm geändert: Überschreiben / Speichern unter / Abbrechen | Oberflächentests |
| Echte PDF-Kommentare | Jeder Kommentar ist eine Standard-Anmerkung mit eigener Darstellung (/AP). Apple PDFKit (Engine von „Vorschau“) erkennt und zeigt alle Arten | Integrations- und Oberflächentests, Bildvergleich |
| Drucken | Ungespeicherte Kommentare werden mitgedruckt; die Datei bleibt dabei unverändert | Oberflächentest, Sichtprüfung des Ausdrucks |
| Geschützte PDFs | Verbietet ein PDF das Kommentieren, sind die Werkzeuge gesperrt und ein Hinweis erscheint. Kennwortgeschützte PDFs bleiben nach dem Speichern verschlüsselt | Oberflächen- und Integrationstests |
| Einstellungen | Name für Kommentare (Blattwerk → Einstellungen …); voreingestellt ist der Name des Mac-Benutzers | Oberflächentest |
| Große Dateien | Kommentar in der 600-Seiten-Datei (119 MB) speichern: unter 1 Sekunde; Arbeitsspeicher danach wieder bei rund 350 MB | Messung |

## Tests

- 91 Unit- und Integrationstests (`npm test`), davon 26 neu für Kommentare
- 44 Oberflächentests mit der echten App (`npm run test:e2e`), davon 12 neu für Kommentare
- Typprüfung, ESLint, Lizenzprüfung
- Rauchtest der fertig gebauten App, jetzt mit Kommentieren und Speichern (`scripts/smoke-packaged.mjs`)
- Neues Test-PDF `kommentare.pdf` mit Kommentaren, wie andere Programme sie anlegen (Hervorhebung, Notiz mit Antwort und Status, Rechteck, Freihand)

## Was nicht oder nur eingeschränkt geht

- **Stempel aus anderen Programmen:** Ihre Beschriftung kann die App nicht lesen. In der Liste heißen sie nur „Stempel“. Verschiebt man so einen Stempel, zeigt die Vorschau bis zum Speichern nur seinen Umriss; danach ist er wieder vollständig zu sehen.
- **Füllfarben** vorhandener Rechtecke und Ellipsen bleiben erhalten, erscheinen aber in der Vorschau nach dem Verschieben erst nach dem Speichern wieder.
- **Eigene Stempel** (mit Bild oder Datum) und Stempel mit eigenem Text gibt es noch nicht.
- **Deckkraft** und **Füllfarbe** lassen sich noch nicht einstellen.
- **Kommentare filtern, sortieren, exportieren** (z. B. als Zusammenfassung) gibt es noch nicht.
- Die Hinweisfenster beim Überfahren eines Kommentars mit der Maus sind aus; Texte stehen in der Kommentarliste.
- Nach dem Speichern wird das Dokument kurz neu geladen; die Ansicht springt dabei an den Anfang der aktuellen Seite.
- **Windows** ist weiterhin nicht gebaut und nicht getestet.

## Bitte einmal von Hand ausprobieren

1. Eine gespeicherte Datei mit Kommentaren in **Vorschau** öffnen (automatisch geprüft, aber das eigene Auge ist besser).
2. Dieselbe Datei in **Acrobat Reader** öffnen (falls vorhanden): Sind alle Kommentare da, stimmen Text, Antworten und Status in der Kommentarliste?
3. Dieselbe Datei in **Chrome** öffnen.
4. Mit dem Trackpad etwas freihand schreiben.

## Bekannte Bugs

Keine offenen bekannten Bugs.
