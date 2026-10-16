# Offen: Jedes Dokument in einem eigenen Fenster, Tabs herausziehen

Stand: 2026-10-16 · Wunsch des Auftraggebers (wörtlich zusammengefasst): Ein weiteres Dokument soll sich nicht als
Tab, sondern immer in einem neuen Fenster öffnen. Gibt es doch zwei Tabs in einem Fenster, soll man einen Tab aus dem
Fenster herausziehen können, und er wird zu einem eigenen Fenster, damit zwei Dokumente nebeneinander liegen. Außerdem
erklären, wie man danach Tabs anlegt. Muss auch unter Windows gehen.

## Geplante Entscheidung (noch als ADR 0026 festhalten)

- **Eigene Lösung statt der Tabs von macOS** (`tabbingIdentifier`): Die Werkzeugleiste ist zugleich Titelleiste
  (`hiddenInset`); die Tableiste von macOS liegt dann über unserer Leiste (VS Code erlaubt native Tabs deshalb nur mit
  normaler Titelleiste). Außerdem gäbe es sie unter Windows nicht. Die eigene Lösung verhält sich auf beiden Systemen
  gleich und lässt sich unsichtbar testen.
- **Öffnen → neues Fenster:** Hauptprozess mit mehreren Fenstern (`src/main/index.ts` hat heute ein `mainWindow`):
  Kontext je Fenster (`win`, `ready`, `menuState`, `allowClose`, wartende Dateien). Ein leeres Fenster (Startseite)
  wird wiederverwendet, sonst entsteht ein neues, leicht versetzt zum vorderen. Gilt für alle Wege, die
  `openPathFor` nutzen (Öffnen-Dialog, Ablegen, Zuletzt geöffnet, Finder, Unbenannt/⌘N, neue Dokumente nach
  Extrahieren/Umwandeln). Für den Renderer ein neuer `OpenResult`-Fehler `'elsewhere'`, den `handleOpenResult`
  stillschweigend übergeht. Ist die Datei schon in einem anderen Fenster offen: dieses nach vorn holen
  (`FileRegistry` braucht dafür eine Abfrage „Besitzer eines Dokuments mit diesem Pfad“, nur für PDFs, nicht für
  Quelldateien beim Einfügen).
- Menü folgt dem vorderen Fenster (`focus`-Ereignis merken), `isTrustedSender` prüft alle eigenen Fenster,
  Rückfrage beim Schließen je Fenster, Beenden fragt alle Fenster nacheinander, `recentChanged` an alle Fenster,
  Update-Installation (`IPC.updateInstall`) ruft `app.quit()` statt `win.close()`. Letztes Fenster zu → App beendet.
- **Tab herausziehen:** in `src/renderer/app/TabBar.tsx` per Zeigerereignissen mit `setPointerCapture`
  (liefert Bewegungen auch außerhalb des Fensters); Loslassen außerhalb der Tableiste → IPC an den Hauptprozess mit
  Bildschirmpunkt. Liegt der Punkt über der Tableiste eines anderen Blattwerk-Fensters → Tab dorthin, sonst neues
  Fenster an dieser Stelle. So entstehen auch wieder Tabs (Tab auf ein anderes Fenster ziehen); dazu Menüpunkt
  „Fenster → Alle Fenster zusammenführen“.
- **Übergabe eines Tabs:** ohne Änderungen: Zielfenster öffnet den Pfad neu, Quelle schließt den Tab ohne Rückfrage.
  Mit ungespeicherten Änderungen: Quelle erzeugt die Bytes wie beim Speichern (`saveTab` in `session.ts`:
  `processDocument` mit Kommentar- und Formularänderungen, ohne zu schreiben) und übergibt sie mit Pfad, Kennwort,
  `untitled`, Seite; das Ziel öffnet den Pfad und legt die Bytes als neuen Stand in den Verlauf (wie
  `runDocumentOperations`, damit „ungespeichert“ stimmt und Speichern in die Originaldatei schreibt). Der
  Rückgängig-Verlauf geht dabei verloren (im ADR und in der Hilfe sagen).
- E2E-Tests mit mehreren Tabs anpassen (`viewer.spec.ts` „mehrere Dokumente in Tabs“, `regressions.spec.ts`
  „mehrere Dateien öffnen …“ und „Suchfeld leeren … Tabwechsel“); zweites Fenster in Tests über
  `app.waitForEvent('window')`. Alles bleibt unsichtbar (`runHidden` gilt für jedes neue Fenster).
