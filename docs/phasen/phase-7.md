# Phase 7: Profi-Funktionen – Abschlussbericht

Stand: 2026-10-15 · Version 0.7.0 · Paket: `release/Blattwerk-0.7.0-arm64.dmg`

## Was funktioniert

| Anforderung | Umsetzung | Geprüft durch |
|---|---|---|
| Digitale Signaturen mit Zertifikat erstellen | „Werkzeuge → Mit Zertifikat unterschreiben“: digitale ID (.p12) wählen oder eine eigene erstellen, Feld auf der Seite aufziehen oder unsichtbar unterschreiben. Standard PAdES (B-B). Danach wird gleich gespeichert. ([ADR 0016](../entscheidungen/0016-digitale-signaturen.md)) | Integrations- und Oberflächentests, Apple PDFKit |
| Signaturen prüfen | Leiste über signierten Dokumenten (gültig / danach geändert / ungültig), Details mit Unterzeichner, Zeit, Grund, Aussteller | Integrations- und Oberflächentests |
| PDF/A erzeugen und prüfen | „Werkzeuge → PDF/A (Archivformat)“: prüft das Dokument und speichert auf Wunsch eine neue Datei im Format PDF/A-2b. Fehlende Standardschriften werden eingebettet, Farbprofil, Metadaten, Bereinigung von Skripten und Anhängen. ([ADR 0017](../entscheidungen/0017-pdfa.md)) | Integrationstests (auch mit CMYK), Oberflächentest, Apple PDFKit |
| Tags für Barrierefreiheit auslesen und prüfen | Seitenleiste „Tags“ zeigt die Struktur; „Werkzeuge → Barrierefreiheit prüfen“ prüft 12 Regeln und behebt Sprache, Titel und Tab-Reihenfolge per Klick. ([ADR 0018](../entscheidungen/0018-barrierefreiheit.md)) | Integrations- und Oberflächentests |

Außerdem: Die App enthält keine GPL-Dateien mehr. pdf.js bringt die Liberation-Schriften mit, die die App nie benutzt
hat; sie werden nicht mehr eingepackt.

## Tests

- **Unit- und Integrationstests:** 224 (`npm test`).
- **Oberflächentests:** 92 mit der echten App (`npm run test:e2e`), unsichtbar.
- **Rauchtest** der fertigen App, unsichtbar.

## Was nicht oder nur eingeschränkt geht

- **Signaturen:** ohne Zeitstempel und Langzeitprüfung (B-T, LTV), weil die App kein Internet nutzt. Eigene IDs sind
  selbst ausgestellt; Prüfprogramme zeigen „Identität nicht bestätigt“, bis man dem Zertifikat vertraut.
- **PDF/A:** nur Stufe 2b. Dokumente mit nicht eingebetteten Schriften außer den Standardschriften (z. B. Calibri)
  lassen sich nicht umwandeln; die App nennt die Schriften. Die Prüfung ersetzt keinen amtlichen Prüfer (veraPDF).
- **Barrierefreiheit:** Tags werden angezeigt und geprüft, aber nicht angelegt oder bearbeitet (Begründung in
  ADR 0018). Alternativtexte lassen sich deshalb noch nicht setzen.
- **Windows** ist weiterhin nicht gebaut und nicht getestet.

## Bitte einmal von Hand ausprobieren

1. Eine PDF mit „PDF/A (Archivformat)“ als PDF/A speichern und die neue Datei in Vorschau öffnen.
2. Eine barrierefreie PDF (z. B. aus Word mit „Barrierefreiheit“ exportiert) öffnen und die Seitenleiste „Tags“ ansehen.
3. Mit einer eigenen digitalen ID unterschreiben und die Datei in Acrobat Reader öffnen (Signaturfeld anklicken).
