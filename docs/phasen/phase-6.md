# Phase 6: Werkzeuge – Abschlussbericht

Stand: 2026-10-15 · Version 0.6.0 · Paket: `release/Blattwerk-0.6.0-arm64.dmg`

## Was funktioniert

| Anforderung | Umsetzung | Geprüft durch |
|---|---|---|
| Texterkennung (OCR), Deutsch und Englisch | „Werkzeuge → Text erkennen (OCR)“: gescannte Seiten bekommen eine unsichtbare Textebene, genau über den Wörtern im Bild. Danach lässt sich der Text suchen, markieren und kopieren. Läuft auf dem Mac, ohne Internet. Seiten mit Text werden übersprungen. ([ADR 0015](../entscheidungen/0015-texterkennung.md)) | Echte Erkennung im Integrationstest, Oberflächentest |
| PDFs komprimieren | „Werkzeuge → Komprimieren“: drei Stufen; große Bilder werden verkleinert und neu gespeichert, Inhalte gepackt, Überflüssiges entfernt. Im Test schrumpfte ein Foto-PDF auf unter ein Drittel. ([ADR 0013](../entscheidungen/0013-komprimieren.md)) | Integrations- und Oberflächentests |
| Passwortschutz und Berechtigungen | „Werkzeuge → Kennwortschutz“: Kennwort zum Öffnen, Berechtigungskennwort mit Drucken, Kopieren, Kommentieren, Formularen, Seiten, Inhalt, Vorlesehilfen. AES-256. Schutz ändern und entfernen (mit Berechtigungskennwort). ([ADR 0011](../entscheidungen/0011-kennwortschutz.md)) | Integrationstests, Oberflächentest, Prüfung mit Apple PDFKit |
| Export als Bilder und Text | „Ablage → Exportieren“: PNG oder JPEG, 72–600 dpi, Seitenbereich; Text als UTF-8. ([ADR 0012](../entscheidungen/0012-export.md)) | Integrations- und Oberflächentests |
| Word-Export | Nicht gebaut: nicht sauber machbar (Begründung und Alternativen in ADR 0012). | – |
| Zwei PDFs vergleichen | „Werkzeuge → Mit Datei vergleichen“: Bericht als neues PDF mit Übersicht und alter/neuer Seite nebeneinander, entfernte Wörter rot, neue grün. ([ADR 0014](../entscheidungen/0014-vergleichen.md)) | Unit-, Integrations- und Oberflächentests |

Außerdem in dieser Phase auf Wunsch des Auftraggebers:
- Textfelder in der Breite ziehen (mit Live-Vorschau), Größe, Schrift und Farbe für ausgewählten Text, Schriftgröße eintippen oder wählen.
- Mehrfachauswahl (Umschalt-Klick, Auswahlrechteck), gemeinsam verschieben und löschen.
- Neuer Text beginnt genau an der Klickstelle; ein Klick daneben übernimmt ihn.
- Beschriftungen unter den Symbolen; Schließen des Fensters beendet die App.
- Alle Tests laufen unsichtbar, auch der Rauchtest der fertigen App.

## Tests

- **Unit- und Integrationstests:** 206 (`npm test`), davon neu unter anderem Kennwortschutz, Zeichnen und Text, Komprimieren, Vergleich, Texterkennung.
- **Oberflächentests:** 88 mit der echten App (`npm run test:e2e`), unsichtbar.
- **Rauchtest** der fertigen App bestanden, unsichtbar (macOS bestätigt: kein Fenster auf dem Bildschirm).

## Was nicht oder nur eingeschränkt geht

- **Kennwörter** nur ohne Umlaute und ß: Apple Vorschau kann sonst AES-256-Dateien nicht öffnen.
- **Komprimieren** behandelt keine CMYK-Bilder, keine 1-Bit-Scans, kein JBIG2 und JPEG 2000. Die Zielauflösung bezieht sich auf die größte Seite.
- **Vergleich** nur für Text, Seiten in ihrer Reihenfolge.
- **Texterkennung:** Qualität abhängig vom Scan (300 dpi empfohlen), keine Geraderichtung schiefer Scans, nur Deutsch und Englisch.
- **Verschlüsselte Dokumente:** Wasserzeichen, Formularfelder anlegen, Schwärzen und Komprimieren erst nach dem Entfernen des Schutzes (jetzt in der App möglich).
- **Windows** ist weiterhin nicht gebaut und nicht getestet.

## Bitte einmal von Hand ausprobieren

1. Einen echten Scan (z. B. einen Brief) öffnen, „Text erkennen“, danach mit Cmd+F ein Wort suchen und markieren.
2. Ein großes PDF mit Fotos komprimieren und die Größe vorher/nachher vergleichen.
3. Ein PDF mit Kennwort schützen, speichern und in Vorschau öffnen.

## Bekannte Bugs

Keine offenen bekannten Bugs.
