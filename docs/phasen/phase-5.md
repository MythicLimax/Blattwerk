# Phase 5: Bearbeiten – Abschlussbericht

Stand: 2026-10-14 · Version 0.5.0 · Paket: `release/Blattwerk-0.5.0-arm64.dmg`

## Was funktioniert

| Anforderung | Umsetzung | Geprüft durch |
|---|---|---|
| Schwärzen | Leiste „Schwärzen“: Bereiche aufziehen, markierten Text schwärzen, „Text suchen und schwärzen“ (zum Beispiel alle Vorkommen eines Namens). Markierungen sind rot umrandet, lassen sich verschieben, löschen und rückgängig machen und auch ohne Anwenden speichern (wie in Acrobat). „Anwenden“ entfernt die Inhalte endgültig. | Integrations- und Oberflächentests |
| Inhalte wirklich entfernen | Text, Bildpunkte (auch die Transparenz), Grafik, die ganz im Bereich liegt, berührte Links, Kommentare und Formularfelder samt Wert. Dazu auf Wunsch Titel, Autor und weitere Metadaten, außerdem Vorschaubilder der Seiten und Bildbeschreibungen für Vorlesehilfen. Die Datei wird vollständig neu geschrieben; auch ältere Fassungen, die in der Datei steckten, verschwinden. | Eigener Test mit Geheimnissen an allen bekannten Verstecken (siehe unten) |
| Wasserzeichen | Text oder Bild, Schrift, Größe (auch „passend zur Seite“), Farbe, Deckkraft, Drehung, Position, über oder hinter dem Inhalt, Seitenbereich. Lässt sich wieder entfernen oder ersetzen. | Integrations- und Oberflächentests, Prüfung mit Apple PDFKit |
| Kopf- und Fußzeilen | Sechs Felder (links, Mitte, rechts, jeweils oben und unten) mit Platzhaltern für Seitenzahl, Seitenanzahl, Datum und Dateiname; Schrift, Größe, Farbe, Ränder, Startnummer, Seitenbereich. | Integrations- und Oberflächentests |
| Seitenzahlen | Eigener Dialog: Position, Format („1“, „Seite 1“, „Seite 1 von 12“, „1 / 12“), Größe, Startnummer, Seitenbereich (zum Beispiel ohne Deckblatt). | Oberflächentests |
| Neuen Text und Bilder einfügen | Modus „Inhalt bearbeiten“: Text an beliebiger Stelle schreiben (Schrift, Größe, Farbe wählbar, auch mehrzeilig); Bild einfügen. Das Ergebnis ist echter Seiteninhalt, kein Kommentar. | Integrations- und Oberflächentests |
| Verschieben und skalieren | Textzeilen, Bilder und Grafikgruppen anklicken, ziehen, an den Ecken vergrößern oder verkleinern, löschen. | Integrations- und Oberflächentests |
| Vorhandenen Text bearbeiten | Doppelklick auf eine Zeile, Text ändern, Eingabetaste. Fehlen Buchstaben in der Schrift der Zeile, nimmt die App eine ähnliche Standardschrift und sagt das schon beim Tippen. | Integrations- und Oberflächentests |
| Rückgängig/Wiederholen | Für alles in dieser Phase, bis zum Speichern. | Oberflächentests |
| Gedrehte Seiten | Wasserzeichen, Kopfzeilen, neuer Text und neue Bilder stehen aufrecht, so wie die Seite angezeigt wird. | Integrationstests |

## Was beim Bearbeiten von Text realistisch ist

Die Vorgabe verlangte eine Erklärung vorab. Das Ergebnis ist umgesetzt wie angekündigt:

- **Gut machbar:** neuer Text, neue Bilder, Zeilen und Bilder verschieben, skalieren und löschen.
- **Mit Grenzen:** eine vorhandene Zeile umschreiben. PDFs enthalten oft nur die Buchstaben, die im Dokument vorkommen. Fehlt einer, bekommt die Zeile eine ähnliche Standardschrift. Lage, Größe und Farbe bleiben gleich.
- **Nicht machbar:** Absätze, die sich nach einer Änderung neu umbrechen. Ein PDF kennt nur einzeln gesetzte Zeilen. Gescannte Seiten sind Bilder; ihr Text wird erst durch die Texterkennung in Phase 6 bearbeitbar.

## Der Schwärzungstest

Die Vorgabe verlangt einen Test, der prüft, dass Schwärzen Inhalte wirklich entfernt. Er erzeugt ein PDF mit Geheimnissen an allen Stellen, an denen sie sich in einer PDF-Datei verstecken können:

- Seitentext und ein zweiter Inhaltsstrom,
- eine eingebettete Grafikgruppe,
- eine Link-Adresse,
- ein Formularfeld mit Wert,
- ein Kommentar,
- Titel und XMP-Metadaten,
- eine Bildbeschreibung für Vorlesehilfen und ein fertiges Vorschaubild,
- ein Bild, das auch auf Seite 2 steht,
- eine kleine Vektorform,
- ein Kommentar, der in einem älteren Stand der Datei gelöscht wurde.

Nach dem Schwärzen darf keines davon mehr in der Datei stehen, weder lesbar noch gepackt, weder als Klartext noch in anderen Kodierungen. Außerdem prüft er:

- Der öffentliche Text bleibt erhalten.
- Das Bild auf Seite 2 bleibt unverändert.
- An den Stellen liegt Schwarz.
- Die Datei hat nur noch einen Stand.

Ein weiterer Test deckt drei Fälle ab: Ersatztext für Vorlesehilfen im Seiteninhalt, Bilder direkt im Seiteninhalt und gedrehte Seiten.

## Tests

- **Unit- und Integrationstests:** 174 (`npm test`), davon 33 neu:
  - Schwärzen,
  - Wasserzeichen und Kopfzeilen,
  - Inhalt bearbeiten,
  - Planung der Schwärzungen.
- **Oberflächentests:** 71 mit der echten App (`npm run test:e2e`), davon 9 neu.
- **Rauchtest** der fertig gebauten App bestanden.

## Beim Testen gefundene und behobene Fehler

- **Geteiltes Bild:** Ein Bild, das auf mehreren Seiten verwendet wird, wurde auf allen Seiten geschwärzt. Jetzt bekommt die geschwärzte Seite vorher eine eigene Kopie.
- **Vektorgrafik:** Sie blieb unter der Schwärzung vollständig in der Datei, nur überdeckt. Grafik, die ganz im Bereich liegt, wird jetzt entfernt.
- **Links und Formularfelder** im geschwärzten Bereich blieben samt Adresse bzw. Wert erhalten. Jetzt werden sie entfernt.
- **Bildbeschreibungen für Vorlesehilfen und Vorschaubilder der Seiten** konnten geschwärzte Inhalte verraten. Jetzt werden sie entfernt.
- **Unbekannte Zeichen:** Die Standardschrift hätte sie in Wasserzeichen stillschweigend durch „?“ ersetzt. Jetzt nennt die App die betroffenen Zeichen.
- **Teilschriften:** Fehlende Buchstaben in eingebetteten Teilschriften wurden zunächst nicht erkannt. Jetzt prüft die App jedes Zeichen einzeln.
- **Erfolgsmeldungen** erschienen im Stil einer Fehlermeldung.

## Was nicht oder nur eingeschränkt geht

- **Verschlüsselte Dokumente:** Schwärzen, Wasserzeichen sowie Kopf- und Fußzeilen gehen erst nach dem Entfernen des Kennwortschutzes. Das kommt in Phase 6. „Inhalt bearbeiten“ geht auch in verschlüsselten Dokumenten, sofern sie Änderungen erlauben.
- **Schwärzen:**
  - Grafik, die den Bereich nur teilweise berührt, bleibt erhalten und ist dort schwarz überdeckt.
  - Lesezeichen, Dateianhänge und Dokument-JavaScript werden nicht automatisch durchsucht.
- **Wasserzeichen anderer Programme** (zum Beispiel aus Acrobat) erkennt „Entfernen“ nicht. Nur die eigenen sind sicher zuzuordnen.
- **Schriften:** nur Helvetica, Times und Courier mit westeuropäischen Zeichen. Kyrillisch, Griechisch, Asiatisch und Ähnliches fehlen noch.
- **Absätze** brechen nach einer Änderung nicht neu um (siehe oben).
- **Vorhandene Zeilen:** Schriftart, Größe und Farbe lassen sich nicht direkt umstellen. Möglich ist: Zeile löschen und neu schreiben.
- **Neuladen:** Jede Änderung lädt die Ansicht kurz neu. Bei normalen Dokumenten dauert das unter einer halben Sekunde.
- **Windows** ist weiterhin nicht gebaut und nicht getestet.

## Bitte einmal von Hand ausprobieren

1. In einem echten Dokument einen Namen mit „Text suchen und schwärzen“ markieren, anwenden, unter neuem Namen speichern. Dann in Vorschau prüfen, ob sich der Name noch suchen oder kopieren lässt.
2. Ein Wasserzeichen „ENTWURF“ hinzufügen und in Vorschau ansehen, danach wieder entfernen.
3. In einem Brief eine Zeile ändern und ein Logo als Bild einfügen.

## Bekannte Bugs

Keine offenen bekannten Bugs.
