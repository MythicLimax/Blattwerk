# Nächste Arbeiten

Stand: 2026-10-19, nach Version 0.14.0. Reihenfolge = Vorrang. Erledigte Punkte hier streichen und im Commit nennen.

## 1. Fehler: Tab schließen, während ein Textfeld bearbeitet wird

**Gemeldet vom Auftraggeber (macOS und Windows):** Leeres Dokument (⌘N), Textfeld anlegen, etwas tippen. Ist die
Eingabe noch offen und man drückt auf das ✕ des Tabs, flackert es kurz und sonst passiert nichts. Erst ein zweiter
Klick fragt „Speichern?“ und schließt.

**Vermutung (noch nicht geprüft):** Der erste Klick nimmt dem Eingabefeld den Fokus. Dadurch wird der Text übernommen
(`commitPendingEdits`, im Inhalt-Bearbeiten-Modus ein neuer Dokumentstand mit Neuladen, `TabState.working`). Während
dieses Neuladens ist der Schließen-Befehl wirkungslos oder die Tableiste wird neu gezeichnet, und der Klick geht
verloren.

**Ziel:** Ein Klick reicht. Erst Eingabe übernehmen, auf das Ende der Warteschlange warten (`enqueue`), dann wie gewohnt
fragen und schließen. Dasselbe für ⌘W, „Fenster schließen“ und Beenden prüfen.

**Test:** neuer Fall in `test/e2e/regressions.spec.ts` (Textfeld offen → ein Klick auf ✕ → Rückfrage erscheint).

## 2. Fehler: Update unter Windows tut nichts

**Gemeldet vom Auftraggeber:** „Nach Updates suchen …“ findet 0.14.0 und lädt es herunter. Nach „Jetzt aktualisieren“
schließt sich die App, aber weder die neue noch die alte Version öffnet sich.

**Wo die Datei liegt:** `%APPDATA%\Blattwerk\Updates\Blattwerk-Setup-0.14.0.exe` (im Explorer oben eintippen). Gelöscht
wird sie nur nach erfolgreicher Installation; liegt sie noch da, ist die Installation nicht gelaufen oder fehlgeschlagen.
Bis zur Behebung: die Datei von Hand doppelklicken.

**Ablauf heute:** `runPendingInstall` (`src/main/update/updater.ts`) startet beim Beenden eine verborgene PowerShell
(`windowsInstallCommand` in `install-script.ts`), die auf das Ende der App wartet und dann das Installationsprogramm mit
`/S --force-run` startet.

**Mögliche Ursachen (prüfen, nicht raten):**
- Die PowerShell wird mit der App zusammen beendet (Prozessgruppe/Job von Electron), bevor sie das Installationsprogramm
  startet.
- Windows blockiert das heruntergeladene Programm still (Markierung „aus dem Internet“, SmartScreen), weil kein
  Fenster da ist, in dem es fragen könnte.
- Das Installationsprogramm (NSIS, `oneClick: false`) läuft mit `/S` an, startet die App danach aber nicht neu.

**Vorgehen:** Jeden Schritt des Hilfsskripts in eine Protokolldatei im Update-Ordner schreiben lassen. Den Rauchtest
`scripts/smoke-update.mjs` für Windows erweitern und im CI-Job „Paket (Windows)“ laufen lassen, damit das Update dort
wirklich eingespielt und die neue Version gestartet wird. Wenn nötig: Markierung vorher entfernen (`Unblock-File`) oder
das Installationsprogramm direkt aus der App starten statt über PowerShell.

## 3. Fehler: Textfelder hängen beim Verschieben hinter dem Zeiger her

**Gemeldet vom Auftraggeber:** Beim Verschieben eines Textfelds (Text und Bilder bearbeiten) folgt das Feld dem
Mauszeiger deutlich verzögert.

**Vermutung (noch nicht geprüft):** Jede Zeigerbewegung löst zu viel Arbeit aus, etwa einen neuen Dokumentstand,
PDFium-Aufträge oder ein Neuzeichnen der ganzen Ebene (`ContentEditOverlay.tsx`), statt das Feld nur per CSS
(`transform`) mitzuziehen.

**Ziel:** Während des Ziehens bewegt sich nur eine Vorschau mit dem Zeiger, ohne spürbare Verzögerung. Die Änderung
(`ContentOperation`) entsteht erst beim Loslassen.

**Alle verschiebbaren Objekte prüfen und bei Bedarf genauso beheben (Auftrag des Auftraggebers):** jeweils Verschieben
und Größe ändern.
- Inhalt bearbeiten: Textfelder, Bilder, Formen (`features/content-edit/`)
- Kommentare: Notizen, Textfelder, Formen, Linien und Pfeile, Freihand, Stempel, Unterschriften (`features/annotations/`,
  `PageOverlay.tsx`)
- Markierungen: Anfasser an den Enden (`MarkupHandles`)
- Schwärzungsmarkierungen (`features/redaction/`)
- Formularfelder beim Formular bearbeiten (`FormEditOverlay.tsx`)
- Seiten im Seitenraster und Tabs in der Tableiste (Vergleich: Fühlen sie sich flüssig an?)

**Test:** Oberflächentests in `test/e2e/edit.spec.ts` und den Dateien der jeweiligen Bereiche, die während des Ziehens
die Lage des Objekts mit der des Zeigers vergleichen.

## 4. Letzten Tab schließen → Startseite statt Programmende

**Wunsch des Auftraggebers:** Schließt man den letzten Tab eines Fensters (✕ am Tab, ⌘W, „Datei → Schließen“, auch
nacheinander alle Tabs), soll das Fenster offen bleiben und die Startseite zeigen. Heute schließt sich dann das Fenster,
und ist es das letzte, beendet sich Blattwerk.

**Bleibt wie heute (ausdrücklich gewünscht):** Der rote Knopf oben links im Fenster (macOS) und „Fenster schließen“
schließen das ganze Fenster; ist es das letzte, beendet sich die App vollständig (Rückfrage zum Speichern vorher).
Ebenso ⌘Q.

**Hinweise:** Nicht verwechseln mit dem Schließen nach einer Tab-Übergabe in ein anderes Fenster (`window:close` in
`TabBar.tsx`/`transferTab`): Ein Fenster, das durch Herausziehen leer wird, schließt sich weiter. Unter Windows
entsprechend: ✕ am Tab → Startseite, ✕ oben rechts am Fenster → Fenster zu bzw. App beendet. Regel „Letztes Fenster zu →
App beendet“ in CLAUDE.md unter „Fenster“ und ADR 0026 präzisieren.

**Test:** Oberflächentests in `test/e2e/windows.spec.ts` bzw. `start.spec.ts` (letzten Tab schließen → Startseite
sichtbar, Fenster und App laufen weiter; Fenster schließen → App beendet).

## 5. Bei jedem Start nach Updates suchen

**Wunsch des Auftraggebers:** nicht nur alle 12 Stunden, sondern bei jedem Start. `AUTO_CHECK_INTERVAL` in
`src/main/index.ts` entfernen (still im Hintergrund, 5 s nach dem Start wie bisher). ADR 0027 und CLAUDE.md anpassen.

## 6. „Über Blattwerk“ unter Windows

**Gemeldet vom Auftraggeber:** Unter Windows gibt es kein „Über Blattwerk“. Ursache: Der Eintrag steht nur im
App-Menü von macOS (`role: 'about'` in `src/main/menu.ts`); unter Windows gibt es dieses Menü nicht.

**Ziel:** Unter Windows ein Menü „Hilfe“ mit „Über Blattwerk …“ (dort, wo Windows-Programme es üblicherweise haben). Es
zeigt Name, Version und Lizenzhinweise. Electrons eingebauter Dialog (`app.setAboutPanelOptions`/`showAboutPanel`) oder
ein eigener Dialog im Stil der App. „Nach Updates suchen …“ und „Update-Ordner wählen …“ gehören dann ebenfalls dorthin
statt ins Menü „Bearbeiten“. Texte über `t()`, Name über `{{appName}}`.

**Test:** Oberflächentest, der den Eintrag unter Windows/Linux im Menü findet und den Dialog mit der Version zeigt.

## 7. Schon geplante Erweiterungen

Vor Beginn kurz prüfen, ob ein Punkt inzwischen erledigt ist.

- **Barrierefreiheit:** Tags anlegen und bearbeiten, Alternativtexte für Bilder setzen (bisher nur anzeigen und prüfen,
  ADR 0018). Größte Lücke zu Acrobat.
- **PDF/A:** Dokumente mit nicht eingebetteten Schriften wie Calibri umwandeln (Schrift des Rechners einbetten, ADR 0024).
- **Kommentare** (Phase 2): eigene Stempel (Bild, Datum, eigener Text), Deckkraft und Füllfarbe, Kommentare filtern,
  sortieren und als Zusammenfassung exportieren.
- **Seiten** (Phase 3): Seiten ersetzen, Seiten zuschneiden, Seiten zwischen Tabs ziehen.
- **Anzeige** (Phase 1): Zoom-Prozentwert frei eintippen.
- **Wasserzeichen:** Schriften für andere Schriftsysteme (Kyrillisch, Griechisch, Asiatisch).
- **Schwärzen:** „Dokument bereinigen“ (Lesezeichen, Anhänge, Dokument-JavaScript).
- **Windows:** von Hand ausprobieren (Auftraggeber), gefundene Fehler hier eintragen.

Für jede Auslieferung die Version erhöhen.
