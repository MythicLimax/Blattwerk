# 0028 Startseite wie in Word: Home-Knopf, Vorlagen, Anheften, Suche

Stand: 2026-10-18 · Wunsch des Auftraggebers: ein Home-Knopf oben links zurück zur Startseite, angelehnt an Word, mit
vorgefertigten Dokumenten. Eigene Ideen vorher abgestimmt: eigene Vorlagen, Vorschaubilder, Anheften, Suchfeld (alle
gewünscht). Vorlagen gewählt: Brief (DIN 5008), Lebenslauf, Rechnung, Protokoll, Notizpapier, Deckblatt, Bewerbung,
To-do-Liste mit Wochenplan.

## Entscheidung

- **Home-Knopf** ganz links in der Werkzeugleiste (`House`, `app.home`, Menü „Anzeige → Startseite“, ⇧⌘H). Mit offenen
  Dokumenten legt er die Startseite als Überlagerung über den Arbeitsbereich (`ui.homeOpen`, `StartScreen overlay`);
  die Dokumente bleiben geladen, die Leisten der Bearbeitungsmodi verschwinden solange. Zurück per Esc, „Zurück zum
  Dokument“, erneutem Klick oder sobald ein Dokument geöffnet oder der Tab gewechselt wird. Ohne Dokument ist die
  Startseite ohnehin zu sehen. Was von der Startseite geöffnet wird, öffnet wie jedes Dokument (ADR 0026): im leeren
  Fenster selbst, sonst in einem neuen.
- **Mitgelieferte Vorlagen** als HTML (`src/main/templates/builtin.ts`), gesetzt mit Chromium wie „PDF aus
  Textdokument“ (`htmlToPdf`). So entstehen echte Texte (überschreibbar im Modus „Text und Bilder bearbeiten“, fehlende
  Zeichen ersetzt die vorhandene Schriftersetzung) und Linien als Vektoren (SVG). Texte in den Übersetzungen
  (`templates.content`), Platzhalter in eckigen Klammern; Name (Einstellungen, unter macOS sonst der volle Name des
  Benutzers) und heutiges Datum sind eingesetzt. Geöffnet wird eine Kopie als unbenanntes Dokument („Brief.pdf“,
  `createUntitledDocument`), also gleich im Bearbeitungsmodus und mit „Sichern unter“ beim ersten Speichern. Gesetzte
  Vorlagen bleiben je Autor und Tag im Speicher.
- **Eigene Vorlagen:** „Ablage → Als Vorlage sichern …“ legt den aktuellen Stand (mit ungespeicherten Änderungen,
  `currentBytes`) als PDF in `Vorlagen` im Profil (`user-templates.ts`, höchstens 100, nie überschreiben, Namen über
  `sanitizeFileName`). Kennungen `builtin:<name>` und `user:<Datei>` prüft `parseTemplateId` (keine Pfade). Entfernen
  auf der Startseite in zwei Schritten. Alle Fenster erfahren Änderungen (`templates:changed`).
- **Vorschaubilder** (`src/main/files/thumbnails.ts`): kleine PNGs der ersten Seite in `Vorschaubilder` im Profil,
  höchstens 200. Für Dateien zeichnet der Renderer das Bild nach dem Laden aus dem schon geladenen Dokument und schickt
  es mit der Datei-ID (der Hauptprozess kennt den Pfad; nicht für unbenannte Dokumente und ungespeicherte Stände). Für
  Vorlagen beim ersten Anzeigen über eine kurzlebige pdf.js-Instanz (`openTemporary`); mitgelieferte je App-Version.
  Abgefragt werden nur Pfade der Zuletzt-Liste und gültige Vorlagen.
- **Anheften** (`RecentFiles.setPinned`): angeheftete Dateien stehen in eigener Gruppe oben, behalten ihren Platz beim
  erneuten Öffnen, zählen nicht gegen die 15 zuletzt geöffneten und überstehen „Liste leeren“ (wie Word).
- **Suche** auf der Startseite filtert Vorlagen und Dateien (Name, bei Dateien auch Ordner) ohne Netz und ohne Index.

## Verworfen

- **Vorlagen als eigene Textobjekte über PDFium** (wie neuer Text): Absätze wären „echter“ Blattwerk-Text, aber jede
  Vorlage bräuchte eigenen Satz- und Tabellencode im Worker. HTML mit Chromium setzt Tabellen, Umbrüche und Linien
  zuverlässig und ist schon im Haus.
- **Vorschaubilder beim Start für alle Dateien neu zeichnen:** müsste jede Datei lesen (auch große, auch auf
  Netzlaufwerken). Stattdessen entsteht das Bild beim Öffnen; ältere Einträge zeigen bis dahin ein Symbol.
- **Word-Vorlagen (.dotx) einlesen:** Blattwerk ist ein PDF-Programm; eigene Vorlagen sind PDFs.

## Grenzen

- Eingebettete Teilschriften aus Chromium enthalten nur die Zeichen der Vorlage; neue Zeichen setzt die Schriftersetzung
  in einer Standardschrift. Optisch fällt das bei Arial/Helvetica kaum auf.
- Dateien aus „Zuletzt geöffnet“, die seit Version 0.13.0 nicht mehr geöffnet wurden, haben noch kein Vorschaubild.
