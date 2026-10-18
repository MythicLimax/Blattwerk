# 0027 Updates aus dem Netz (GitHub)

Stand: 2026-10-18 · Wunsch des Auftraggebers: neue Versionen aus der App heraus holen, ohne jedes Mal auf GitHub zu
gehen. Ergänzt [0025](0025-updates.md), das neue Versionen nur aus einem Ordner einspielt.

## Entscheidung

- **Quelle:** ein öffentliches GitHub-Projekt nur für die fertigen Apps, `MythicLimax/Blattwerk-Downloads`
  (`UPDATE_REPOSITORY` in `src/shared/product.ts`). Der Quelltext bleibt im privaten Projekt. Der Auftraggeber hat diesen
  Weg gewählt (Alternativen unten).
- **Veröffentlichen:** Der CI-Job „Veröffentlichen“ läuft nach jedem Build auf `main`. Gibt es zur Version aus
  `package.json` noch kein Release `v<Version>`, legt er es mit allen Paketen an (macOS `.dmg` und `-mac.zip` je
  Prozessor, Windows `Setup.exe`). Er braucht das Secret `DOWNLOADS_TOKEN` (fein abgestufter Schlüssel, Schreibrecht nur
  für die Inhalte des Download-Projekts); fehlt es, warnt er nur. Eine neue Version entsteht also nur, wenn die
  Versionsnummer steigt.
- **Mac-Archiv:** electron-builder baut zusätzlich `Blattwerk-<Version>-<arm64|x64>-mac.zip` (unter macOS mit dem
  System-`zip`, symbolische Verweise bleiben erhalten). CI entpackt es wie die App mit `ditto` und prüft die Signatur.
- **In der App** (`src/main/update/online.ts`): „Nach Updates suchen …“ prüft erst den Update-Ordner (0025), dann
  `GET https://api.github.com/repos/<Projekt>/releases/latest`. Ist die Version neuer, lädt der Hauptprozess die passende
  Datei (`updateAssetName`) mit Fortschritt in den eigenen Update-Ordner, entpackt unter macOS mit `ditto` und prüft
  App-ID und Version. Danach übernimmt der Updater aus 0025 (Signatur prüfen, Leiste „Jetzt aktualisieren“, Austausch
  beim Beenden). Beim Start sucht die installierte App höchstens alle 12 Stunden still (`lastUpdateCheck` in den
  Einstellungen); Testläufe nie.
- **Netz nur hier:** Nur der Hauptprozess spricht mit dem Netz (Node `fetch`, nicht die Sitzung des Renderers), nur über
  HTTPS, nur mit `api.github.com`, `github.com` und den Speichern für Release-Dateien. Weiterleitungen folgt die App selbst
  und prüft jede Station (`fetchChecked`, `isAllowedUpdateUrl`). Höchstens 800 MB, Größe muss zur Angabe von GitHub
  passen. Der Renderer bleibt ohne Netz (`session.webRequest` unverändert). Abweichung von der Spezifikation auf Wunsch
  des Auftraggebers.
- **Ohne Quarantäne:** Vom Hauptprozess geladene Dateien tragen unter macOS kein Quarantäne-Attribut; die Meldung
  „beschädigt“ wie beim Herunterladen im Browser entfällt.

## Verworfen

- **Privates Projekt direkt:** Releases privater Projekte gibt GitHub nur mit Zugangsdaten heraus.
- **Projekt öffentlich machen:** einfacher, aber dann ist der Quelltext für alle sichtbar.
- **Schlüssel in der App:** müsste auf jedem Rechner eingegeben werden und läuft ab.
- **electron-updater:** braucht unter macOS eine kostenpflichtige Apple-Signatur für Squirrel.

## Grenzen

- Die erste Version mit dieser Suche (0.12.0) muss einmal von Hand installiert werden.
- Ohne Apple-Developer-Zertifikat sind die Apps nur ad hoc signiert. Die Prüfung schützt vor kaputten Dateien, nicht
  vor einer gefälschten App im Download-Projekt; geschützt ist das über den Schlüssel, mit dem nur CI dort schreibt.
