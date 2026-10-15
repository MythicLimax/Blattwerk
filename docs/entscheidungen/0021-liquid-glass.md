# 0021 Gestaltung nach macOS 26 (Liquid Glass)

Stand: 2026-10-15 · ersetzt die Formensprache aus ADR 0020 (die Farben bleiben)

## Anlass

Der Auftraggeber fand die Gestaltung aus ADR 0020 weiterhin „nach KI aussehend“ und wünscht eine Oberfläche wie eine
native Apple-App unter macOS 26, nah an den Human Interface Guidelines und an Vorschau, Notizen, Dateien und Mail.
Farben (Papierton, Flaschengrün, Töne der Arbeitsbereiche) bleiben unverändert.

## Entscheidung

- **Technik:** Die App ist Electron/React, SwiftUI-APIs (`glassEffect`) stehen nicht zur Verfügung. Liquid Glass wird
  mit CSS nachgebaut: halbtransparente Fläche, `backdrop-filter: blur(20px) saturate(180%)`, feine 0,5-px-Innenkante
  mit geringer Deckkraft, sehr weicher Schatten (Variablen `--glass-*` in `styles/tokens.css`).
- **Fenster:** Unter macOS sind Titelleiste und Werkzeugleiste eins (`titleBarStyle: hiddenInset`, Ampelknöpfe in der
  Leiste). Leere Flächen der Leiste ziehen das Fenster (`data-drag-region`), Bedienelemente nicht.
- **Schrift:** Systemschrift (SF Pro), 13 px Fließtext, Titel 600, große Titel mit leicht negativem Zeichenabstand.
  Keine Großbuchstaben-Beschriftungen mit weitem Abstand.
- **Formen, konzentrisch:** Sheets 22 px, Gruppenflächen 14 px, Knöpfe und Felder 10 px, Leistenknöpfe, Tabs,
  Modusleisten und Umschalter als Kapseln. Gruppierung über Abstand, Flächen und 0,5-px-Linien statt umrahmter Karten.
- **Aufbau:** Knopfgruppen der Werkzeugleiste als Glas-Kapseln; Tabs als Kapseln, der aktive als helle, leicht
  erhabene Kapsel; Leiste des aktiven Arbeitsbereichs als schwebende, in seiner Farbe getönte Kapsel mit
  Namensschild; Seitenleisten als schwebende Glasflächen mit Segment-Umschalter; Startseite mit gruppierten Listen
  und Symbolen in farbigen abgerundeten Quadraten (wie die Systemeinstellungen); Dialoge als Glas-Sheets.
- **Windows:** gleiche Gestaltung, aber mit normaler Titelleiste.

## Grenzen

CSS-Glas zeigt nur Inhalte derselben Seite unscharf, nicht den Schreibtisch hinter dem Fenster (dafür bräuchte es die
Fensterunschärfe von macOS, die mit dem Papierton und den Tests schlecht zusammenpasst).
