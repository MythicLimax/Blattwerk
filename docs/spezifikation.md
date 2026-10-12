# Projekt: Desktop-PDF-Editor nach dem Vorbild von Adobe Acrobat Pro

> Originale Projektvorgabe, unverändert übernommen (Stand 2026-10-12). Änderungen an der Vorgabe nur nach Absprache.

Baue eine Desktop-App für macOS und Windows, die den Funktionsumfang von Adobe Acrobat Pro so weit wie möglich nachbildet. Arbeitsname: [NAME]. Kein Adobe-Name, kein Adobe-Logo, keine kopierten Icons oder Grafiken. Das Bedienkonzept darf sich an Acrobat orientieren.

## Arbeitsweise
- Lies diese Datei komplett, bevor du Code schreibst
- Erstelle zuerst eine CLAUDE.md mit Architektur, Ordnerstruktur, Konventionen und Phasenstatus. Halte sie aktuell
- Arbeite strikt Phase für Phase. Eine Phase ist erst fertig, wenn die App startet, alle Features der Phase funktionieren, die Tests grün sind und ein Git-Commit existiert
- Nach jeder Phase: kurze Zusammenfassung, was funktioniert, was nicht und welche Bugs bekannt sind. Dann auf mein OK warten
- Wenn ein Feature technisch nicht sauber machbar ist, sag das und schlag eine Alternative vor, statt es halbgar zu bauen
- Keine Platzhalter: Es gibt keine Buttons ohne Funktion

## Technik
- Electron + TypeScript + React + Vite. Grund: gleiche Chromium-Engine auf Mac und Windows, damit PDFs überall identisch gerendert werden
- Rendering mit pdf.js
- Bearbeiten und Speichern: Vergleiche vor Phase 1 die Optionen (pdf-lib oder ein gepflegter Fork davon, PDFium als WASM, qpdf) und gib mir eine kurze Empfehlung. Nur Bibliotheken mit permissiver Lizenz (MIT, Apache 2.0, BSD). MuPDF ist AGPL, also nur nach Rücksprache
- Prüfe bei jeder Abhängigkeit, ob sie aktiv gepflegt wird, und nimm die aktuelle stabile Version
- Sicherheit: contextIsolation an, nodeIntegration aus, JavaScript in PDFs wird nie ausgeführt
- Rendering in Web Workern, die UI darf nie einfrieren
- Packaging mit electron-builder: .dmg (Apple Silicon und Intel) und Windows-Installer (.exe). Dazu ein GitHub-Actions-Workflow, der beide Versionen baut

## Grundregeln für Dateien
- Die Originaldatei darf nie beschädigt werden: Speichern über eine temporäre Datei und atomares Ersetzen
- Wo möglich inkrementell speichern, damit vorhandene Signaturen gültig bleiben
- Gespeicherte PDFs müssen in Acrobat Reader, Apple Vorschau und Chrome korrekt aussehen. Annotationen als echte PDF-Annotationen speichern, nicht ins Seitenbild einbrennen
- Die App muss auch mit 500+ Seiten und 100+ MB flüssig laufen (virtualisiertes Rendering, Miniaturen erst bei Bedarf laden)
- Lege einen Ordner mit Test-PDFs an (Text, Scan, Formular, verschlüsselt, beschädigt, sehr groß) und teste jede Phase damit

## Oberfläche
- Layout wie bei Acrobat: Menüleiste, Werkzeugleiste oben, linke Seitenleiste (Seitenminiaturen, Lesezeichen, Kommentare), rechtes Werkzeugpanel, Tabs für mehrere Dokumente
- Eigenes, schlichtes Design mit Icons aus einer freien Library, etwa Lucide
- Hell- und Dunkelmodus nach Systemeinstellung
- Natives Menü und Tastenkürzel passend zur Plattform (Cmd auf dem Mac, Strg unter Windows)
- UI auf Deutsch, alle Texte in i18n-Dateien, damit Englisch später leicht dazukommen kann
- Dateien per Drag & Drop öffnen, Liste der zuletzt geöffneten Dateien, App als Standardprogramm für PDFs registrierbar

## Phasen

### Phase 1: Viewer
- öffnen, scrollen, zoomen (auch per Pinch auf dem Trackpad), Ansicht einzeln, doppelt und fortlaufend
- Seitenminiaturen, Lesezeichen und Inhaltsverzeichnis, klickbare Links
- Volltextsuche mit markierten Treffern, Text auswählen und kopieren
- passwortgeschützte PDFs öffnen
- drucken
- Dokumenteigenschaften anzeigen

### Phase 2: Kommentieren
- hervorheben, unterstreichen, durchstreichen
- Notizen, Textfelder, Freihand, Formen (Rechteck, Kreis, Linie, Pfeil), Stempel
- Kommentarliste mit Antworten und Status
- Rückgängig und Wiederholen für alle Aktionen

### Phase 3: Seiten organisieren
- Seiten per Drag & Drop umsortieren, drehen, löschen, leere Seiten oder Seiten aus anderen PDFs einfügen
- Seiten extrahieren, PDFs zusammenführen, PDFs aufteilen
- Bilder (JPG, PNG) in PDF umwandeln

### Phase 4: Formulare und Unterschrift
- AcroForm-Felder ausfüllen und speichern
- Formularfelder anlegen und bearbeiten (Text, Checkbox, Radiobutton, Dropdown)
- Unterschrift zeichnen, tippen oder als Bild einfügen und für später speichern

### Phase 5: Bearbeiten
- neuen Text und Bilder einfügen, verschieben und skalieren
- vorhandenen Text bearbeiten, soweit das technisch sauber geht. Erkläre mir vorher, was realistisch ist
- Schwärzen: Inhalte wirklich entfernen (Text, Bilder, Metadaten), nicht nur überdecken. Mit einem Test, der genau das prüft
- Wasserzeichen, Kopf- und Fußzeilen, Seitenzahlen

### Phase 6: Werkzeuge
- OCR für gescannte PDFs (etwa mit Tesseract) mit durchsuchbarer Textebene, Sprachen Deutsch und Englisch
- PDFs komprimieren
- Passwortschutz und Berechtigungen setzen
- Export als Bilder und Text, Word nur, wenn es sauber machbar ist
- zwei PDFs vergleichen

### Phase 7: Profi-Funktionen
- digitale Signaturen mit Zertifikat (PAdES) erstellen und prüfen
- PDF/A erzeugen und prüfen
- Tags für Barrierefreiheit auslesen und prüfen

Fang mit der Bibliotheksauswahl und der CLAUDE.md an. Noch keinen Feature-Code.
