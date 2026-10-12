# 0001: Bibliotheken für Bearbeiten und Speichern

- Status: **Vorschlag, wartet auf Freigabe**
- Datum: 2026-10-12
- Rendering ist gesetzt: **pdf.js** (`pdfjs-dist` 6.4.299, Apache-2.0). Diese Entscheidung betrifft nur das Ändern und Schreiben von PDFs.

## Was die Engine können muss

Aus der Spezifikation ergeben sich diese harten Anforderungen. Sie entscheiden die Wahl, nicht die API-Bequemlichkeit:

1. **Inkrementell speichern**, damit Signaturen gültig bleiben
2. **Echte Annotationen mit Appearance Stream (/AP)**, sonst zeigt Apple Vorschau sie nicht oder falsch an
3. **Echtes Schwärzen**: Text, Bilder und Pfade im Bereich aus dem Inhaltsstrom entfernen
4. **Vorhandenen Text bearbeiten** (Phase 5), mindestens objektweise
5. **Formulare** ausfüllen *und* Felder anlegen
6. **Verschlüsselung** lesen und setzen
7. **Robust** bei beschädigten Dateien, flüssig bei 500+ Seiten und 100+ MB
8. Permissive Lizenz, aktiv gepflegt

## Kandidaten (geprüft am 2026-10-12 über npm-Registry, GitHub und Paketinhalt)

| | pdf-lib (Original) | @cantoo/pdf-lib | PDFium-WASM (`@embedpdf/pdfium`) | qpdf | @libpdf/core (zusätzlich gefunden) |
|---|---|---|---|---|---|
| Version | 1.17.1 | 2.11.1 | 2.15.1 | 12.4.2 | 0.5.2 (Beta) |
| Letztes Release | **11/2021** | 09/2026 | 09/2026 | 09/2026 | 10/2026 |
| Releases in 12 Mon. | 0 | 21 | 41 | regelmäßig | 41 |
| Lizenz | MIT | MIT | MIT (Wrapper) + BSD-3 (PDFium) | Apache-2.0 | MIT |
| Laufzeit | JS | JS | WASM (4,6 MB) im Worker | natives Binary je Plattform; WASM-Builds auf npm seit >12 Mon. ohne Release | JS |
| Robust bei kaputten PDFs | schwach | mittel | hoch (Parser aus Chrome) | sehr hoch (Reparatur) | hoch (Brute-Force-Recovery) |
| Inkrementell speichern | nein | ja | ja (`FPDF_SaveAsCopy` mit Flag `FPDF_INCREMENTAL`) | nein | ja |
| Verschlüsselung lesen/setzen | –/– | ja/ja (AES-256) | ja/ja (`EPDF_SetEncryption`) | ja/ja | ja/ja (AES-256) |
| Annotationen mit /AP erzeugen | nur Low-Level, kein /AP | nur Low-Level, kein /AP | ja (`EPDFAnnot_GenerateAppearance`) | nein | Annotations-API ja, /AP-Erzeugung unklar |
| Formulare füllen/anlegen | ja/ja | ja/ja | ja/ja (`EPDFPage_CreateFormField`) | nein | ja/ja |
| Seiten verschieben, importieren, drehen | ja | ja | ja (`FPDF_MovePages`, `FPDF_ImportPages`) | ja (CLI) | ja |
| Echtes Schwärzen | nein | nein | **ja** (`EPDFText_RedactInRect`, `EPDFPage_ApplyRedactions`) | nein | nein |
| Vorhandenen Text ändern | nein | nein | objektweise (`FPDFText_SetText`, `FPDFPage_GenerateContent`) | nein | nein |
| Bilder ersetzen (Komprimieren) | eingeschränkt | eingeschränkt | ja (`EPDFImageObj_SetJpeg/SetPng`) | nur Streams neu komprimieren | eingeschränkt |
| Signaturen | – | – | lesen (`FPDFSignatureObj_*`), Prüfen braucht Krypto-Lib | – | PAdES B-B bis B-LTA erstellen, **nicht prüfen** |

## Empfehlung

**Bearbeiten und Speichern mit PDFium als WASM (`@embedpdf/pdfium`), in einem eigenen Web Worker pro Dokument.**

Begründung:
- Als einzige Option deckt sie die schweren Anforderungen 1 bis 6 in *einer* Engine ab. Mit pdf-lib oder dem Cantoo-Fork müsste ich Appearance Streams, das Parsen und Umschreiben von Inhaltsströmen fürs Schwärzen und die Textbearbeitung selbst bauen. Das wäre viel eigener Code genau an den Stellen, an denen Fehler teuer sind.
- PDFium ist die Engine von Chrome. Was sie schreibt, sieht in Chrome sicher richtig aus, und der Parser verkraftet reale, schlampige PDFs.
- Die Bibliothek ist sehr aktiv gepflegt (41 Releases in 12 Monaten) und permissiv lizenziert.

**pdf.js** bleibt wie vorgegeben für Rendering, Textebene, Suche, Links und Inhaltsverzeichnis zuständig.

**qpdf nicht in die App einbauen**, sondern in CI und Tests als Prüfwerkzeug nutzen: `qpdf --check` auf jede Datei, die ein Test speichert. Falls Phase 6 (Komprimieren, Reparieren) es braucht, gibt es inzwischen offizielle Binaries für macOS (arm64, x86_64) und Windows. Entscheidung dann.

**@libpdf/core** ist Kandidat für Phase 7 (PAdES mit Zeitstempel und LTV). Die Bibliothek ist jung (Beta seit 01/2026), daher entscheide ich das erst in Phase 7 neu.

**pdf-lib (Original)** scheidet aus, weil es seit 2021 nicht mehr gepflegt wird. **@cantoo/pdf-lib** ist der Plan B, falls PDFium-WASM an einer Stelle scheitert.

## Risiken und wie ich sie abfange

1. **Zwei Engines** (pdf.js zeigt an, PDFium schreibt). Nach inhaltlichen Änderungen muss pdf.js das Dokument neu laden, und in Randfällen können sich die Darstellungen unterscheiden. Gegenmaßnahme: Tests rendern jede gespeicherte Datei mit beiden Engines und vergleichen.
2. **Die `EPDF*`-Funktionen sind EmbedPDF-Erweiterungen**, kein Upstream-PDFium, und damit weniger erprobt. Gegenmaßnahme: Version fest pinnen. Die App greift nur über eine eigene Schicht (`src/workers/pdfium/`) darauf zu, damit ein Austausch möglich bleibt.
3. **C-API mit Zeigern**: Speicher muss manuell freigegeben werden. Gegenmaßnahme: typisierter Wrapper mit `try/finally`-Freigabe und Tests auf Speicherlecks.
4. **Schwärzen und verwaiste Objekte**: Auch eine Vollspeicherung kann unreferenzierte alte Objekte (z. B. ein entferntes Bild) in der Datei lassen. Der Schwärzungstest in Phase 5 prüft deshalb die rohen Bytes der gespeicherten Datei (dekomprimiert) auf den geschwärzten Text und die Bilddaten. Wenn nötig, kommt ein eigener Aufräumschritt dazu.
5. **WASM-Speicher** ist auf 4 GB begrenzt (wasm32). Für 100 bis 300 MB große PDFs reicht das. Dateien lädt PDFium erst, wenn der Nutzer etwas ändert; reines Anzeigen läuft nur über pdf.js.
