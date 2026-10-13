# 0009: Wasserzeichen, Kopf- und Fußzeilen, Seitenzahlen

- Status: angenommen (2026-10-14, Phase 5)

## Entscheidung

Wasserzeichen sowie Kopf- und Fußzeilen sind **eigene, zusätzliche Inhaltsströme** der Seite. Sie werden mit pdf-lib inkrementell angehängt (`src/workers/pdfium/stamping.ts`). Seitenzahlen sind eine Fußzeile mit einem vorbereiteten Text („Seite {Seite} von {Seiten}“).

### Warum nicht PDFium

PDFium kann Textobjekte anlegen (`FPDFPageObj_NewTextObj`). Danach schreibt `FPDFPage_GenerateContent` aber den **gesamten** Seiteninhalt neu; ein Versuch hat das bestätigt. Das birgt bei komplexen Seiten unnötige Risiken und vergrößert die Datei.

Ein eigener Strom lässt den vorhandenen Inhalt Byte für Byte unverändert.

### Aufbau eines Stroms

- **Kennung:** Im Stromwörterbuch steht `/BlattwerkArtifact /Watermark` bzw. `/HeaderFooter`. „Entfernen“ nimmt genau diese Ströme wieder aus `/Contents`. Gibt es keinen eigenen Strom (mehr), meldet die App das verständlich, statt einen leeren Stand anzulegen.
- **Inhalt:** Er steht in `/Artifact <</Type /Pagination /Subtype /Watermark>> BDC … EMC` (bzw. `/Header`, `/Footer`), wie Acrobat es schreibt. Vorlesehilfen überspringen ihn deshalb.
- **Lage:**
  - Vorn (über dem Inhalt): Der vorhandene Inhalt wird in `q … Q` gefasst, damit dessen Grafikzustand das Wasserzeichen nicht verschiebt. Die Hüllen tragen die Kennung `/Wrap` und verschwinden mit dem letzten eigenen Strom.
  - Hinten: Der Strom steht vor dem Inhalt.
- **Verschachtelung:** pdf-lib würde bei jeder Bearbeitung den Inhalt erneut in `q … Q` fassen (`autoNormalizeCTM`); die Verschachtelung wüchse mit jedem Schritt. Die App schaltet das ab.
- **Gedrehte Seiten und CropBox:** Alles wird auf der *angezeigten* Seite berechnet: aufrecht, bezogen auf den sichtbaren Bereich. Die Matrix `visualToUser` (`src/shared/stamping.ts`) rechnet in den Benutzerraum um.
- **Schrift:** Standardschriften (Helvetica, Times, Courier, je normal und fett), ohne Einbetten. Sie decken den westeuropäischen Zeichensatz ab, also auch Umlaute, ß und €. Zeichen außerhalb davon meldet die App mit Namen. pdf-lib würde sie sonst stillschweigend durch „?“ ersetzen.
- **Platzhalter:** `{Seite}`, `{Seiten}`, `{Datum}` und `{Datei}` füllt die App beim Hinzufügen aus. „Beginnen bei“ zählt ab der ersten Seite des Bereichs; `{Seiten}` ist die letzte vergebene Nummer.

Jede Änderung ist wie bei Seiten und Formularfeldern ein neuer Stand im Arbeitsspeicher. Rückgängig und Wiederholen gelten bis zum Speichern.

## Einschränkungen

- **Verschlüsselte Dokumente** gehen erst nach dem Entfernen des Kennwortschutzes (Phase 6). Grund wie in ADR 0007: pdf-lib schreibt unverschlüsselt.
- **Wasserzeichen anderer Programme** (zum Beispiel aus Acrobat) erkennt „Entfernen“ nicht. Sicher zuordnen lassen sich nur die eigenen.
- **Schriften für andere Schriftsysteme** (Kyrillisch, Griechisch, Asiatisch …) fehlen. Dafür müsste eine Schrift mit erlaubter Lizenz eingebettet werden; das wäre ein späterer Schritt.
