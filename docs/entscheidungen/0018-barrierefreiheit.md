# 0018 Tags für Barrierefreiheit auslesen und prüfen

Stand: 2026-10-15 · Phase 7

## Entscheidung

- **Auslesen:** Die Seitenleiste „Tags“ zeigt die Struktur des ganzen Dokuments (`/StructTreeRoot`): Rolle (nach
  `/RoleMap` auf die Standardrolle zurückgeführt, eigene Rolle im Tooltip), Alternativtext, ActualText, Titel, Sprache.
  Ein Klick springt zur Seite. Gelesen wird mit pdf-lib im Worker (`src/workers/pdfium/accessibility.ts`);
  verschlüsselte Dokumente entschlüsselt PDFium vorher im Speicher. Höchstens 20 000 Elemente, Tiefe 200.
  pdf.js liefert Strukturbäume nur je Seite; Acrobat zeigt den Dokumentbaum, deshalb der eigene Leser.
- **Prüfen** („Werkzeuge → Barrierefreiheit prüfen …“), angelehnt an PDF/UA und die Schnellprüfung von Acrobat:
  Tags vorhanden, Sprache, Titel, Titelanzeige, Tab-Reihenfolge, Alternativtext von Abbildungen, Reihenfolge der
  Überschriften, Kopfzellen in Tabellen, Links/Kommentare in der Struktur, QuickInfo von Formularfeldern, reine
  Bildseiten (Hinweis auf OCR), Lesezeichen ab 21 Seiten. Strukturregeln gelten ohne Tags als „nicht geprüft“.
  Prüfergebnis und Baum entstehen in einem Schritt und gelten je geladenem Stand (`features/accessibility/report.ts`).
- **Beheben** (neuer Dokumentstand, rückgängig machbar, inkrementell): Sprache (`/Lang`), Titel (`/Info /Title`),
  `DisplayDocTitle`, `/Tabs /S` auf Seiten mit Anmerkungen.

## Nicht gebaut

- **Tags anlegen oder bearbeiten** (automatisch taggen, Lesereihenfolge, Alternativtexte setzen): Automatisches
  Taggen braucht eine Layoutanalyse (Spalten, Tabellen, Überschriften), die sich ohne große Bibliothek nicht
  verlässlich machen lässt; halbe Tags schaden Bildschirmlesern mehr als keine. Empfehlung: Tags beim Erstellen der
  PDF erzeugen (Word, LibreOffice, InDesign mit Barrierefreiheit-Option).
- **Vollständige PDF/UA-Prüfung** (Matterhorn-Protokoll, z. B. mit PAC oder veraPDF): zu umfangreich; der Dialog
  weist darauf hin.
