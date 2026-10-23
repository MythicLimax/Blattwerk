# Nächste Arbeiten

Stand: 2026-10-24. Reihenfolge = Vorrang. Erledigte Punkte hier streichen und im Commit nennen.

## Erledigt in 0.15.0 (Pull Request #4)

- **Tab schließen mit offener Texteingabe:** Der Punkt „ungespeichert“ erschien mitten im Klick und schob ✕ weg; zudem
  schloss der Tab ohne Rückfrage, weil das Übernehmen des Textes noch lief (`trackPending`).
- **Windows-Update:** Das Hilfsskript startet die App nach der Installation selbst neu, wartet auf alle Prozesse und
  schreibt `update.log`. CI spielt das fertige Installationsprogramm als Update ein (`smoke-update-win.mjs`).
- **Ziehen:** Anfassen ohne Aussetzer (ein Zurücklesen statt fünf), Lichtschein ruht beim Ziehen. `drag.spec.ts` prüft
  Text, Kommentare und Formularfelder. Auf dem echten Bildschirm vom Auftraggeber zu bestätigen.
- **Letzter Tab:** Startseite; ⌘W im letzten Fenster beendet die App nicht mehr.
- **Updates bei jedem Start**, **„Hilfe → Über Blattwerk“** unter Windows.
- **Auswahlrahmen neben der Seite** (Inhalt bearbeiten; Kommentare, Formulare und Seitenraster haben keinen Rahmen).
- **Text auf Objekten:** kleine Objekte liegen beim Klicken oben. Im Beispiel des Auftraggebers
  (`.tools/beispiele/text-auf-objekt.pdf`, nie einchecken) ist der Fließtext auf Seite 1 ein Bild (Scan); ein
  Doppelklick auf ein Bild sagt das jetzt. Echtes Bearbeiten siehe unten.

## Geplante Erweiterungen

Vor Beginn kurz prüfen, ob ein Punkt inzwischen erledigt ist.

- **Text in Bildern bearbeitbar machen** (wie „Scans bearbeiten“ in Acrobat): Texterkennung im Bildbereich, Text als
  echte Textobjekte in ähnlicher Schrift setzen, Bildpunkte darunter mit der Hintergrundfarbe füllen. Anlass: Beispiel
  des Auftraggebers.
- **Barrierefreiheit:** Tags anlegen und bearbeiten, Alternativtexte für Bilder setzen (bisher nur anzeigen und prüfen,
  ADR 0018). Größte Lücke zu Acrobat.
- **PDF/A:** Dokumente mit nicht eingebetteten Schriften wie Calibri umwandeln (Schrift des Rechners einbetten, ADR 0024).
- **Kommentare** (Phase 2): eigene Stempel (Bild, Datum, eigener Text), Deckkraft und Füllfarbe, Kommentare filtern,
  sortieren und als Zusammenfassung exportieren.
- **Seiten** (Phase 3): Seiten ersetzen, Seiten zuschneiden, Seiten zwischen Tabs ziehen.
- **Anzeige** (Phase 1): Zoom-Prozentwert frei eintippen.
- **Wasserzeichen:** Schriften für andere Schriftsysteme (Kyrillisch, Griechisch, Asiatisch).
- **Schwärzen:** „Dokument bereinigen“ (Lesezeichen, Anhänge, Dokument-JavaScript).
- **Windows:** von Hand ausprobieren (Auftraggeber), gefundene Fehler hier eintragen.

Für jede Auslieferung die Version erhöhen.
