# 0026 Jedes Dokument in einem eigenen Fenster, Tabs herausziehen und zusammenführen

Stand: 2026-10-17 · Wunsch des Auftraggebers: Ein weiteres Dokument öffnet sich nicht als Tab, sondern in einem neuen
Fenster, damit zwei Dokumente nebeneinander liegen können. Gibt es doch mehrere Tabs in einem Fenster, lässt sich ein
Tab herausziehen und wird zu einem eigenen Fenster. Muss auch unter Windows gehen.

## Entscheidung

- **Eigene Lösung statt der Tabs von macOS** (`tabbingIdentifier`): Die Werkzeugleiste ist zugleich Titelleiste
  (`hiddenInset`); die Tableiste von macOS läge dann über unserer Leiste (VS Code erlaubt native Tabs deshalb nur mit
  normaler Titelleiste). Unter Windows gäbe es sie gar nicht. Die eigene Tableiste verhält sich auf beiden Systemen
  gleich und lässt sich unsichtbar testen.
- **Hauptprozess mit mehreren Fenstern** (`src/main/index.ts`): je Fenster ein `WindowContext` (Fenster, bereit,
  Menüzustand, Schließen erlaubt, wartende Dateien und Tabs). Das Menü folgt dem vorderen Fenster (Reihenfolge über das
  Ereignis `focus`), Befehle gehen an das Fenster mit dem Fokus, sonst an das vordere. `isTrustedSender` prüft alle
  eigenen Fenster. „Zuletzt geöffnet“ geht an alle Fenster.
- **Öffnen** (`openDocument`): Ist das anfragende Fenster leer (Startseite), öffnet das Dokument darin. Ist die Datei
  schon in einem anderen Fenster offen, kommt dieses nach vorn (`FileRegistry.documentOwner`; zählt nur Dokumente in
  Tabs, keine Quelldateien zum Einfügen, Zusammenführen oder Vergleichen). Sonst entsteht ein neues Fenster, leicht
  versetzt zum vorderen (`window-layout.ts`). Gilt für alle Wege: Öffnen-Dialog, Ablegen, Zuletzt geöffnet, Finder und
  Kommandozeile, Unbenannt (⌘N), neue Dokumente nach Extrahieren, Vergleichen, PDF/A, Umwandeln. Vor dem neuen Fenster
  wird die Datei probehalber geöffnet, damit Fehler im anfragenden Fenster erscheinen statt in einem leeren neuen.
  Der Renderer erhält dann `{ ok: false, error: 'elsewhere' }` und tut nichts.
- **Tab herausziehen** (`TabBar.tsx`): Zeigerereignisse mit `setPointerCapture` (Bewegungen auch außerhalb des
  Fensters). Loslassen mehr als 24 px ober- oder unterhalb der Tableiste oder außerhalb des Fensters schickt den
  Bildschirmpunkt an den Hauptprozess (`window:tab-transfer`). Liegt der Punkt über einem anderen Blattwerk-Fenster, kommt der
  Tab dorthin (bei überlappenden Fenstern das vorderste); liegt er im eigenen Fenster oder auf freier Fläche, entsteht
  dort ein neues Fenster. Der einzige Tab eines Fensters wird nicht zu einem neuen Fenster (wäre dasselbe noch einmal).
- **Wieder Tabs bekommen:** einen Tab auf ein anderes Fenster ziehen, oder „Fenster → Alle Fenster zusammenführen“
  (alle Tabs ins vordere Fenster). Dazu „Fenster → Tab in neues Fenster bewegen“ als Weg ohne Maus.
- **Übergabe eines Tabs:** Die Datei bleibt offen und wechselt nur den Eigentümer (`FileRegistry.transfer`, unterwegs
  gehört sie keinem Fenster). Dadurch bleibt der Stand beim Öffnen, und Änderungen von außen werden beim Speichern
  weiter erkannt. Hat der Tab ungespeicherte Änderungen, erzeugt die Quelle die Bytes wie beim Speichern
  (`currentBytes`: Kommentare und Formularwerte eingearbeitet) und schickt sie mit Kennwort, Kennwort der Datei und
  Seite mit (`TabTransfer`). Das Ziel legt sie als neuen Stand über die Datei (`receiveTab`), der Tab gilt also als
  ungespeichert und Speichern schreibt in die Originaldatei. Die Quelle schließt den Tab ohne Rückfrage; ist sie danach
  leer, schließt sich ihr Fenster.
- **Schließen und Beenden:** Rückfrage bei ungespeicherten Änderungen je Fenster. Beenden fragt die Fenster
  nacheinander (Electron hält das Beenden beim ersten an, nach der Antwort geht es weiter). Letztes Fenster zu → App
  beendet. „Jetzt aktualisieren“ beendet die App (`app.quit()`) statt ein Fenster zu schließen.
  Nachtrag 2026-10-24: Den letzten Tab zu schließen zeigt die Startseite. ⌘W ohne Tabs schließt unter macOS nur ein
  weiteres Fenster; im letzten Fenster ist „Schließen“ dann ausgegraut. Wer Tabs nacheinander mit ⌘W schloss, beendete
  sonst mit einem Druck zu viel die App. Beenden bleibt beim roten Knopf und ⌘Q.

## Verworfen

- **Native Tabs von macOS:** siehe oben (Titelleiste, Windows).
- **Tab beim Herausziehen neu laden** (Pfad im Zielfenster neu öffnen): Der Stand beim Öffnen ginge verloren, damit die
  Warnung „Datei wurde von außen geändert“. Deshalb Eigentümerwechsel.
- **Ziehen per HTML-Drag-and-Drop:** liefert außerhalb des Fensters keine verlässliche Position und zeigt unter macOS
  das Symbol „Datei kopieren“.

## Grenzen

- Der Rückgängig-Verlauf bleibt beim Herausziehen im alten Fenster zurück (nur der aktuelle Stand wandert mit).

## Ergänzungen (2026-10-17)

- **Tabs umsortieren:** Ein Tab, der innerhalb der Leiste gezogen wird, folgt dem Zeiger (begrenzt auf die Leiste),
  die übersprungenen Tabs weichen mit einer kurzen Bewegung aus. Die Zielstelle ergibt sich aus den Mitten der anderen
  Tabs vor dem Ziehen (`tab-drag.ts`, nicht aus den bewegten Lagen, sonst schaukelt es). Umsortiert wird erst beim
  Loslassen (`moveTab`): Würde React das Element während des Ziehens umhängen, endete das Festhalten des Zeigers.
  Danach gleitet der Tab von der losgelassenen Stelle an seinen Platz (Web Animations), die anderen stehen für einen
  Augenblick ohne Übergang schon richtig (`.settling`).
- **Tab hängt am Zeiger** (2026-10-18, Wunsch des Auftraggebers): Verlässt der Tab die Leiste in irgendeine Richtung,
  schließen die anderen die Lücke, und der Hauptprozess zeigt eine Vorschau am Zeiger (`src/main/tab-ghost.ts`): ein
  durchsichtiges Fenster ohne Rahmen, ohne Fokus und ohne Mausereignisse, mit dem Tab als Kapsel und einem verkleinerten
  Bild des Fensters (`capturePage`). Die Seite dazu ist `ghost.html` (zweiter Einstieg im Renderer-Build, ohne Preload,
  Daten im Fragment der Adresse). Der Renderer meldet Beginn, Bildschirmpunkte und Ende (`window:tab-drag`). Der gezogene
  Tab wird dabei aktiv, damit die Vorschau sein Dokument zeigt. Unsichtbare Testläufe zeigen keine Vorschau.
- **Über einem anderen Fenster:** Der Hauptprozess meldet dem Fenster unter dem Zeiger den schwebenden Tab
  (`window:tab-drag-hover`, Fensterkoordinaten). Liegt der Zeiger über dessen Tableiste, zeigt es einen Platzhalter am
  Zeiger und macht an der Einfügestelle Platz; die Vorschau am Zeiger verschwindet dann (der Tab „rastet ein“). Die
  Antwort (`window:tab-drag-hover-state`: über der Leiste, Stelle) bestimmt beim Loslassen, wo der Tab landet
  (`TabReceived.index`). Bis der Tab ankommt, hält die Leiste die Lücke (höchstens 0,6 s).
- **Einziger Tab eines Fensters:** lässt sich nicht umsortieren. Herausgezogen zeigt er ebenfalls die Vorschau; über einem
  anderen Fenster losgelassen wandert er dorthin, sonst wandert das Fenster an die Stelle (wie in Safari).
- **Neues Fenster an der Vorschau:** Der Renderer schickt mit dem Beginn den Griff (Zeiger relativ zum Fenster, so als
  wäre der Tab der erste der Leiste). Das neue Fenster liegt so, dass der Zeiger seinen Tab an derselben Stelle hält.
- **Fensterlage je Dokument** (`src/main/files/window-positions.ts`, `window-positions.json` im Profil, höchstens 100
  Einträge): Ein Fenster mit genau einem Dokument merkt sich beim Verschieben, Ändern der Größe und Schließen seine
  Lage für diesen Pfad (nicht für unbenannte Dokumente). Öffnet das Dokument wieder in einem eigenen Fenster, liegt es
  dort, sofern die Stelle noch auf einem Bildschirm ist. So liegen zwei Dokumente nach dem Neuöffnen wieder
  nebeneinander. Fenster ohne gemerkte Lage erscheinen wie bisher versetzt zum vorderen.
