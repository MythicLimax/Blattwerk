# 0006: Seiten organisieren, neue Dokumente aus Teilen

- Status: angenommen (2026-10-13, Phase 3)

## Entscheidung

### Seitenänderungen sofort im Arbeitsspeicher

Jede Seitenoperation läuft so ab:

1. Die aktuellen Bytes kommen von pdf.js (`getData`).
2. Ungespeicherte Kommentaränderungen werden eingearbeitet.
3. PDFium führt die Operationen aus und speichert **inkrementell**.
4. Der Tab lädt das Ergebnis aus dem Speicher neu.

Die Datei auf der Platte ändert sich erst beim Speichern. Unterstützt werden:

- Drehen, Löschen und Verschieben (`FPDF_MovePages`),
- leere Seiten einfügen,
- Seiten aus anderen PDFs übernehmen (`FPDF_ImportPagesByIndex`, auch aus kennwortgeschützten Dateien),
- JPEG und PNG als Seiten einbetten (`EPDFImageObj_SetJpeg`/`SetPng`; JPEG ohne Neukomprimierung).

Abgelehnt habe ich ein „virtuelles“ Seitenmodell, das Änderungen nur vermerkt und erst beim Speichern anwendet. Anzeige, Miniaturen, Suche, Kommentare und Drucken müssten es alle getrennt nachbilden; das wäre fehleranfällig. Mit dem gewählten Weg passt alles automatisch zum tatsächlichen Dokument.

**Preis:** Jede Operation lädt den Tab neu. Gemessen mit 600 Seiten und 119 MB:

| Schritt | Dauer |
|---|---|
| Drehen | 0,35 s |
| Rückgängig | 0,4 s |
| Speichern | 0,2 s |

Arbeitsspeicher danach: rund 630 MB.

### Verlauf über Dokumentstände

`src/renderer/state/history-store.ts` hält je Tab eine Liste von Ständen. Ein Stand besteht aus den Bytes (oder `null` für die Datei auf der Platte), dem Kommentarzustand samt eigenem Rückgängig-Stapel, der Seite und der Auswahl im Raster.

- **Rückgängig** nimmt zuerst Kommentarbefehle des aktuellen Stands zurück, danach wechselt es zum vorherigen Stand. **Wiederholen** arbeitet umgekehrt.
- Eine neue Kommentaraktion verwirft spätere Stände, wie bei jedem linearen Verlauf.
- Alle Stände eines Tabs belegen höchstens 768 MB. Darüber fallen die ältesten weg.
- **„Ungespeichert“** heißt: ungespeicherte Kommentare oder ein Stand, der nicht der Datei entspricht (`src/renderer/state/dirty.ts`).
- Seitenoperationen, Rückgängig und Wiederholen laufen je Tab **nacheinander in einer Warteschlange**. Solange sie nicht leer ist, ist die Oberfläche gesperrt („Seiten werden bearbeitet …“). Zweimal schnell Cmd+Z geht nicht verloren. Speichern wartet, bis die Warteschlange leer ist.

### Neue Dokumente: erst speichern, dann öffnen

Zusammenführen, Extrahieren, Teilen und „PDF aus Bildern“ setzen mit PDFium ein neues Dokument zusammen (vollständig gespeichert). Danach fragt der Systemdialog nach dem Speicherort; das Ergebnis öffnet sich in einem neuen Tab.

- Teilen und „jede Seite als eigene Datei“ schreiben in einen gewählten Ordner. Vorhandene Dateien werden nie überschrieben, gleiche Namen bekommen eine Nummer.
- Grund für „erst speichern“: Tabs ohne Datei („Unbenannt“) gibt es nicht; das ganze Tab-Modell setzt eine Datei voraus.

### Sicherheit der neuen Dateifunktionen

- Pfade bestimmt nur der Systemdialog bzw. Drag & Drop. Vom Renderer kommen nur Namensvorschläge.
- `sanitizeFileName` entfernt Pfadtrenner, Steuerzeichen und in Windows verbotene Zeichen, vermeidet reservierte Gerätenamen und begrenzt die Länge.
- Quelldateien werden am Inhalt erkannt (PDF-Signatur, PNG-/JPEG-Kopf), nicht an der Endung.
- Bilder über 100 Megapixel werden abgelehnt.
- Eine gerade geöffnete Datei kann nicht als Ziel eines neuen Dokuments gewählt werden.

### Bilder

Seite so groß wie das Bild (1 Pixel = 1 Punkt), höchstens A4 in passender Ausrichtung. Die EXIF-Drehung von Handyfotos wird beachtet (90°, 180°, 270°).

### Berechtigungen

| Funktion | Erlaubt, wenn das PDF … |
|---|---|
| Drehen, Löschen, Einfügen, Verschieben | Ändern oder Zusammenstellen erlaubt |
| Extrahieren, Teilen | Kopieren erlaubt |

### Bedienung

- Raster „Seiten organisieren“ (Werkzeugleiste, Menü „Dokument“) mit:
  - Auswahl per Klick, Umschalt-Klick, Cmd-Klick und Pfeiltasten,
  - Ziehen zum Umsortieren,
  - Ablegen von Dateien aus dem Finder an einer Stelle,
  - Drehen und Löschen per Leiste oder an der einzelnen Seite.
- Menü „Dokument“ mit den Kürzeln wie in Acrobat: Umschalt+Cmd+R (drehen), Umschalt+Cmd+D (löschen), Umschalt+Cmd+I (aus Datei einfügen).
- Unter „Ablage“: „Dateien zusammenführen …“ und „PDF aus Bildern erstellen …“.
- Im Raster sind Zoom, Blättern, Suche, Kommentarwerkzeuge und die linke Seitenleiste aus; das Raster zeigt ohnehin alle Seiten.

## Einschränkungen

- Lesezeichen und Links, die auf gelöschte Seiten zeigen, bleiben als tote Verweise im Dokument (PDFium räumt sie nicht auf).
- Formularfelder aus eingefügten PDFs werden als Seiteninhalt übernommen; ob sie im Ziel ausfüllbar bleiben, klärt Phase 4.
- Neue Dokumente aus kennwortgeschützten Quellen sind selbst nicht geschützt. Kennwörter setzen kommt in Phase 6.
- Jeder Stand im Verlauf belegt die volle Dateigröße im Arbeitsspeicher (daher die Grenze von 768 MB).
- Nach jeder Operation werden die Miniaturen neu gezeichnet (nur die sichtbaren).

## Nachtrag 2026-10-24: Ersetzen, Zuschneiden, Ziehen zwischen Dokumenten

- **Seiten ersetzen:** gleich viele Seiten einer anderen PDF; von hinten je Seite Einfügen dahinter und Löschen, damit
  die Reparaturen beim Einfügen (`imported.ts`) greifen.
- **Seiten zuschneiden:** `crop` setzt die CropBox; Ränder in Millimetern, so wie die Seite angezeigt wird
  (`marginsToUser` rechnet für gedrehte Seiten um). Der Inhalt bleibt in der Datei, er wird nur ausgeblendet.
- **Seiten zwischen Dokumenten ziehen:** aus dem Seitenraster in das eines anderen Tabs oder Fensters; eingefügt wird
  eine Kopie samt ungespeicherter Änderungen (über den Hauptprozess abgeholt, siehe CLAUDE.md „Fenster“).
