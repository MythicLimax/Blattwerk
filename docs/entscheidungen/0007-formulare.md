# 0007: Formulare ausfüllen, Formularfelder bearbeiten, Unterschrift

- Status: angenommen (2026-10-13, Phase 4)

## Ausfüllen: pdf.js zeigt, PDFium schreibt

pdf.js stellt die Felder als echte Eingabefelder dar (`AnnotationMode.ENABLE_FORMS`) und legt Eingaben in seinem Anmerkungsspeicher ab. `computeFormChanges` (`src/shared/forms.ts`) vergleicht diesen Speicher mit dem Stand der Datei. Heraus kommt eine Liste geänderter Werte: Text, Häkchen oder gewählter Eintrag, je Widget. Diese Liste zählt wie Kommentare als „ungespeichert“.

Beim Speichern setzt PDFium die Werte so, wie es eine Eingabe tun würde:

- Fokus auf das Feld setzen,
- Text ersetzen,
- Eintrag wählen oder mit der Eingabetaste umschalten.

Danach erzeugt PDFium die Darstellung des Feldes neu. Die Formular-Umgebung läuft dabei ohne JavaScript-Anbindung, wie überall in der App.

**Stolperstein:** Unter `ENABLE_FORMS` schickt pdf.js den Anmerkungsspeicher nicht an den Worker. Ausgeblendete, geänderte Kommentare würden dann wieder erscheinen. `combineFormsWithStorage` (`src/renderer/engine/runtime.ts`) ergänzt deshalb beim Zeichnen die Speicher-Absicht.

## Felder anlegen und bearbeiten: pdf-lib statt PDFium

Untersucht wurden zwei Wege.

### PDFium

PDFium kann Felder anlegen (`EPDFPage_CreateFormField`), aber:

- **Optionsfelder:** Alle Knöpfe einer Gruppe bekommen denselben Zustandsnamen „Yes“. Acrobat schaltet solche Knöpfe gemeinsam. Eindeutige Werte gehen nur über Umwege.
- **Löschen:** PDFium entfernt nur das Widget von der Seite. Das Feld bleibt verwaist im Formularverzeichnis (`/AcroForm /Fields`) stehen und taucht beim Export der Formulardaten weiter auf.

### @cantoo/pdf-lib (MIT)

Diese Bibliothek wird schon zum Erzeugen der Test-PDFs genutzt.

- **Optionsfelder:** Sie legt Gruppen normgerecht an: Zustände „0“, „1“, … und die Werte in `/Opt`. Damit sind auch Werte mit Umlauten möglich.
- **Löschen:** Felder werden vollständig entfernt, also von der Seite, aus der Feldgruppe und aus dem Formular.
- **Inkrementell:** Geänderte Objekte merkt sich die Bibliothek selbst. `commit()` hängt nur sie an das Original an, das Byte für Byte erhalten bleibt.

**Entscheidung:** Feldoperationen laufen mit pdf-lib im selben Worker wie PDFium. Der Code steht in `src/workers/pdfium/fields.ts`.

- pdf-lib wird erst beim ersten Feldauftrag geladen, als eigener Teil des Bundles (etwa 0,6 MB).
- Die Ergebnis-Bytes prüft PDFium wie jedes andere Ergebnis (`canOpen`), bevor sie weitergegeben werden.
- Ausfüllen, Kommentare und Seiten bleiben bei PDFium.

Ergänzungen zu pdf-lib:

- **Rechteck:** pdf-lib vergrößert das Feld um die Rahmenbreite. Das Feld wird deshalb danach auf das gewünschte Rechteck gesetzt.
- **QuickInfo (`/TU`):** Sie steht am Feld und an jedem Widget, weil pdf.js sie nur am Widget liest.
- **Schriftgröße:** Sie wird über `/DA` mit `/Helv` gesetzt. `/Helv` wird im Formularverzeichnis (`/DR`) angelegt, falls es fehlt.
- **Einzelnen Optionsknopf löschen:** Sein `/Opt`-Eintrag wird entfernt, und die folgenden Knöpfe werden umnummeriert. War er ausgewählt, ist die Gruppe danach ohne Auswahl.
- **Darstellung:** Sie wird nur bei Größen- oder Eigenschaftsänderungen neu erzeugt. Beim reinen Verschieben bleibt sie gleich. Kann die Standardschrift ein Zeichen nicht darstellen, setzt die App `NeedAppearances`; dann erzeugt das Anzeigeprogramm die Darstellung selbst.
- **Verschlüsselte Dokumente:** pdf-lib würde neue Zeichenketten unverschlüsselt schreiben. Die App bietet „Formular bearbeiten“ dort deshalb nicht an. Kennwortschutz entfernen folgt in Phase 6.

### Bedienung

Jede Feldänderung ist ein neuer Dokumentstand im Arbeitsspeicher, wie bei den Seitenoperationen ([0006](0006-seiten-organisieren.md)).

- Rückgängig und Wiederholen funktionieren damit ohne eigenen Mechanismus.
- Die Datei auf der Platte ändert sich erst beim Speichern.
- Die Scrollposition bleibt beim Neuladen erhalten (`rememberScroll`).

Abgelehnt habe ich, Feldänderungen nur in der Oberfläche zu sammeln und erst beim Speichern zu schreiben. Die Anzeige von pdf.js zeigt nur Felder, die wirklich im Dokument stehen. Man hätte also alle Felder doppelt zeichnen müssen.

## Unterschrift

Eine Unterschrift ist ein Stempel (`/Stamp`) mit eingebettetem PNG. Das ist dieselbe Form, die Acrobat für „Ausfüllen und unterschreiben“ nutzt. Zertifikatsbasierte Signaturen (PAdES) folgen in Phase 7.

- Gezeichnete, getippte und als Bild übernommene Unterschriften werden zu einem eng zugeschnittenen PNG mit durchsichtigem Hintergrund.
- Gespeicherte Unterschriften liegen im Profil des Nutzers (`signatures.json`, höchstens 20, je höchstens 2 MB). Der Hauptprozess prüft sie, bevor er sie annimmt.

## Seiten aus anderen PDFs: Verweise reparieren

PDFium kopiert beim Zusammenführen, Einfügen und Extrahieren Seiten samt Anmerkungen. Den Schlüssel `/Parent` passt es dabei absichtlich nicht an (`fpdf_ppo.cpp`). Er zeigt danach auf ein beliebiges Objekt des Zieldokuments. Das hat zwei Folgen:

- **Formularfelder:** Sie wären nicht mehr ausfüllbar. Das Feld selbst fehlt, und das Widget zeigt teils auf sich selbst.
- **Notiz-Popups:** Sie verlieren die Verbindung zu ihrem Kommentar.

`src/workers/pdfium/imported.ts` repariert das mit pdf-lib nach jedem Zusammensetzen und jeder Einfügung aus einer Datei.

1. Anmerkungen der Ziel- und der Quellseite werden über ihre Position einander zugeordnet. PDFium übernimmt `/Annots` in derselben Reihenfolge. Stimmt die Anzahl nicht, bleibt die Seite unverändert.
2. Bei Popups zeigt `/Parent` wieder auf den Kommentar derselben Seite.
3. Bei Widgets wird die Feldkette aus der Quelle kopiert und `/Parent` neu gesetzt. Die Kinder stehen in der Reihenfolge der Quelle.
4. Fehlen Knöpfe einer Optionsgruppe, weil nur ein Teil der Seiten übernommen wurde, werden `/Opt` und die Zustandsnamen angepasst.
5. Die übernommenen Felder kommen ins Formularverzeichnis. Gibt es einen Namen schon, bekommt die Kopie einen freien Namen, zum Beispiel „name 2“. So bleiben die Werte getrennt.

**Warum Umbenennen:** Acrobat legt gleichnamige Felder zusammen, dann teilen sie ihren Wert. Wer zwei ausgefüllte Exemplare desselben Formulars zusammenführt, verlöre damit die Werte des zweiten.

**Wann nichts passiert:**
- Quelldateien ohne Formular und ohne Popups bleiben unberührt. Die Prüfung kostet bei 600 Seiten mit 119 MB etwa 0,1 s.
- In verschlüsselte Zieldokumente kann pdf-lib nicht schreiben. Dort bleiben die Verweise, wie PDFium sie hinterlässt (bekannte Einschränkung).
