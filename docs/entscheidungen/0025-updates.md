# 0025 Updates aus der App heraus

Stand: 2026-10-16 · Wunsch des Auftraggebers: neue Versionen nicht mehr von Hand installieren, auch unter Windows

## Entscheidung

- **Ohne Internet:** Die App bleibt netzlos (Spezifikation, `session.webRequest`). Neue Versionen liegen in einem
  **Update-Ordner**: immer `Updates` im Profil der App, zusätzlich optional ein selbst gewählter Ordner (Menü
  „Update-Ordner wählen …“, Einstellung `updateFolder`), z. B. in iCloud Drive oder OneDrive für mehrere Rechner.
- **macOS:** Update ist die fertige `Blattwerk.app` im Ordner. Angeboten wird sie nur bei gleicher App-ID, höherer
  Version (`compareVersions`) und gültiger Signatur (`codesign --verify --deep --strict`, auch ad hoc; schützt vor halb
  kopierten Ordnern). Nicht angeboten, wenn die App vom Disk-Image läuft (`/Volumes/`) oder ihr Ordner nicht beschreibbar ist.
- **Windows:** Update ist das Installationsprogramm `Blattwerk-Setup-<Version>.exe` aus dem CI-Build (NSIS). Geprüft
  werden Name, Version, Größe (mindestens 1 MB) und Kopf `MZ`.
- **Ablauf:** Die App prüft beim Start und wenn ihr Fenster nach vorn kommt und zeigt dann unten eine Leiste
  „Jetzt aktualisieren“ (`features/update/`). Der Klick schließt die App auf dem normalen Weg (Rückfrage bei
  ungespeicherten Änderungen). Erst bei `will-quit` startet ein losgelöstes Hilfsskript
  (`src/main/update/install-script.ts`):
  - macOS (`sh`): wartet auf das Ende der App, kopiert das Update mit `ditto` neben die App, entfernt die Quarantäne,
    tauscht die Ordner per `mv` (bei Fehlern zurück), räumt auf und öffnet die App neu.
  - Windows (PowerShell, verborgen): wartet auf das Ende, startet den Installer still (`/S --force-run`).
  Updates im eigenen Profilordner werden danach gelöscht, solche im geteilten Ordner nicht (andere Rechner brauchen sie).
- **Bereitstellen:** `npm run dist:mac:local` legt die neue App automatisch in den Update-Ordner dieses Macs
  (`--no-update` schaltet das ab).

## Verworfen

- **electron-updater / Squirrel:** braucht einen Server im Netz und unter macOS eine kostenpflichtige Apple-Signatur.
- **Update aus dem Netz laden:** widerspricht der Netzsperre der Spezifikation.

## Grenzen

- Die erste Version mit Updater (0.10.0) muss einmal von Hand installiert werden.
- Windows ist im Code umgesetzt, kann auf dem Mac aber nicht ausprobiert werden.
- Geprüft wird mit `scripts/smoke-update.mjs` (fertige App, Testordner, unsichtbar): Version 99.0.0 wird angeboten,
  eingespielt, signiert und das Update aufgeräumt.
