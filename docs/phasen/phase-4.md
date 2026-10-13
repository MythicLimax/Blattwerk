# Phase 4: Formulare und Unterschrift – Abschlussbericht

Stand: 2026-10-13 · Version 0.4.0 · Paket: `release/Blattwerk-0.4.0-arm64.dmg`

## Was funktioniert

| Anforderung | Umsetzung | Geprüft durch |
|---|---|---|
| Formulare ausfüllen | Textfelder, Kontrollkästchen, Optionsfelder (Radiobuttons), Dropdown- und Listenfelder direkt im Dokument ausfüllen. Ungespeicherte Eingaben zeigen den Punkt am Tab und lösen beim Schließen die Nachfrage aus. Wer einen Wert zurücksetzt, hat keine Änderung mehr. | Oberflächen- und Integrationstests |
| Ausgefülltes Formular speichern | Werte werden fest ins PDF geschrieben, inkrementell (das Original bleibt am Anfang der Datei erhalten). Nach dem Neuladen stehen sie in den Feldern. | Oberflächentests, Prüfung mit pdf.js, PDFium und Apple PDFKit |
| Formularfelder anlegen | „Dokument → Formular bearbeiten“ oder der Knopf in der Werkzeugleiste. Werkzeuge: Textfeld, Kontrollkästchen, Optionsfeld, Dropdown-Liste, Listenfeld. Feld auf der Seite aufziehen oder klicken (Standardgröße), dann Name und Eigenschaften im Dialog. | Oberflächen- und Integrationstests |
| Formularfelder bearbeiten | Felder verschieben, an den Ecken in der Größe ändern, löschen (Entfernen-Taste oder Papierkorb). Doppelklick öffnet die Eigenschaften: Name, QuickInfo, Pflichtfeld, schreibgeschützt, Schriftgröße, mehrzeilig, Einträge der Liste, eigener Text im Dropdown, Wert eines Optionsknopfes. Auch Felder, die ein anderes Programm angelegt hat. | Oberflächen- und Integrationstests |
| Optionsgruppen | Der nächste Knopf schlägt dieselbe Gruppe und den nächsten Wert vor. Jeder Knopf hat seinen eigenen Wert, auch mit Umlauten. Einzelne Knöpfe lassen sich löschen, die anderen behalten ihren Wert. | Integrationstests |
| Rückgängig/Wiederholen | Für alle Feldänderungen, im selben Verlauf wie Kommentare und Seiten. Die Ansicht bleibt dabei an ihrer Stelle. | Oberflächentests |
| Unterschrift zeichnen | Mit Maus, Trackpad oder Stift, in Schwarz oder Blau | Oberflächentests |
| Unterschrift tippen | Name in einer von drei Schreibschriften des Systems | Oberflächentests |
| Unterschrift als Bild | JPEG oder PNG, ein heller Hintergrund wird auf Wunsch durchsichtig | Unit-Tests der Bildaufbereitung |
| Für später speichern | Bis zu 20 Unterschriften im eigenen Profil; beim nächsten Mal zur Auswahl, einzeln löschbar | Oberflächentests (über einen Neustart hinweg) |
| Unterschrift setzen | Nach der Auswahl auf die Stelle klicken; danach verschieben und in der Größe ändern (Seitenverhältnis bleibt) wie ein Kommentar | Oberflächen- und Integrationstests |

Nebenbei behoben (offener Punkt aus Phase 3): Beim Zusammenführen und Einfügen bleiben Formularfelder ausfüllbar, und Notiz-Popups gehören weiter zu ihrem Kommentar. Gibt es einen Feldnamen schon, heißt die Kopie zum Beispiel „name 2“, damit die Werte getrennt bleiben.

## Tests

- **Unit- und Integrationstests:** 141 (`npm test`), davon 17 neu:
  - Ausfüllen mit PDFium,
  - Erkennen geänderter Werte,
  - Unterschrift als Stempel mit Bild,
  - Felder anlegen, bearbeiten und löschen,
  - Zusammenführen von Formularen und Popups.
- **Oberflächentests:** 61 mit der echten App (`npm run test:e2e`), davon 7 neu für Phase 4.
- **Rauchtest** der fertig gebauten App bestanden.

## Beim Testen gefundene und behobene Fehler

- Formularfelder ließen sich zunächst nicht ausfüllen, solange die Kommentarfunktion bestimmte Kommentare ausblendet. Beides geht jetzt gleichzeitig.
- Wer sehr schnell nach einer Auswahl in einem Optionsfeld oder Dropdown speicherte, verlor diese Auswahl. Werte werden jetzt unmittelbar vor dem Speichern, Drucken und Ändern von Seiten abgeglichen.
- Eine gewählte Unterschrift ließ sich nicht auf die Seite setzen.
- Nach dem Zusammenführen waren Formularfelder nicht mehr ausfüllbar und Notiz-Popups ohne Bezug. Ursache ist ein Verhalten von PDFium, das die App jetzt ausgleicht.
- Die QuickInfo eines Feldes war für die Anzeige unsichtbar.
- Neue Felder waren um 1 Punkt größer als aufgezogen.

## Was nicht oder nur eingeschränkt geht

- **Rechnen und Prüfen in Formularen:** Summenfelder, Datumsformate und Eingabeprüfungen sind in PDFs kleine JavaScript-Programme. Die App führt aus Sicherheitsgründen nie JavaScript aus. Solche Felder rechnen deshalb nicht von selbst.
- **XFA-Formulare** (eine ältere Adobe-Formularart, oft aus Behörden-Formularen) werden nicht unterstützt. Normale PDF-Formulare (AcroForm) funktionieren.
- **Die Unterschrift ist ein Bild**, keine digitale Signatur mit Zertifikat. Die folgt in Phase 7.
- **Feldarten:** Schaltflächen und Signaturfelder lassen sich nicht neu anlegen. Vorhandene kann man verschieben, in der Größe ändern und löschen.
- **Eigenschaften:** Farben, Rahmen, Schriftart, Ausrichtung und Berechnungen von Feldern lassen sich nicht einstellen. Neue Felder haben einen dünnen grauen Rahmen und die Schrift Helvetica.
- **Verschlüsselte Dokumente:** Ausfüllen geht, Felder bearbeiten nicht (der Knopf ist dort ausgegraut). Kennwortschutz entfernen kommt in Phase 6.
- **Jede Feldänderung lädt die Ansicht kurz neu.** Bei normalen Formularen dauert das unter einer halben Sekunde, man sieht ein kurzes Flackern.
- **Gleichnamige Felder beim Zusammenführen** werden umbenannt („name 2“) statt wie in Acrobat zusammengelegt.
- **Windows** ist weiterhin nicht gebaut und nicht getestet.

## Bitte einmal von Hand ausprobieren

1. Ein echtes Formular (zum Beispiel ein Antrag als PDF) ausfüllen, speichern und in Vorschau öffnen.
2. Ein eigenes kleines Formular anlegen: zwei Textfelder, ein Kontrollkästchen, eine Optionsgruppe mit drei Knöpfen, ein Dropdown. Speichern und in Vorschau und, falls vorhanden, Acrobat Reader ausfüllen.
3. Eine Unterschrift mit dem Trackpad zeichnen, setzen, speichern und in Vorschau ansehen.

## Bekannte Bugs

Keine offenen bekannten Bugs.
