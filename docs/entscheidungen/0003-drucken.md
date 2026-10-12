# 0003: Drucken über Seitenbilder

- Status: angenommen (2026-10-12, Phase 1)

## Entscheidung

Zum Drucken rendert die App jede Seite mit pdf.js als Bild (150 dpi, inklusive druckbarer Anmerkungen und
Formularinhalte) in einen versteckten Druckbereich und öffnet dann den Druckdialog des Systems
(`webContents.print`). Das Seitenformat folgt der ersten Seite; abweichende Seiten werden eingepasst.

## Begründung und Alternativen

- Electron kann ein PDF nicht direkt an den Drucker geben. Der eingebaute PDF-Viewer von Chromium lässt sich
  aus Electron heraus nicht zuverlässig drucken (leere Seiten).
- So drucken auch Firefox und der pdf.js-Viewer.
- Nachteil: Text ist im Ausdruck gerastert. 150 dpi sind für Text gut lesbar, aber etwas weicher als bei
  Acrobat, das Vektoren an den Drucker schickt. Eine Option für 300 dpi kann später dazukommen
  (kostet bei großen Dokumenten viel Arbeitsspeicher).
- Dokumente, die das Drucken verbieten, lassen sich nicht drucken (Schaltfläche und Menüpunkt sind gesperrt).

## Test

Im Testmodus (`BLATTWERK_E2E_PRINT_DIR`) erzeugt die App statt des Dialogs eine PDF-Datei. Der Oberflächentest
prüft, dass diese alle Seiten enthält.
