# 0023 Apples Liquid Glass über eine native Erweiterung (Weg 2)

Stand: 2026-10-15 · ergänzt ADR 0021/0022

## Entscheidung

- **Native Erweiterung** `native/macos-glass/glass.mm` (Objective-C++, Node-API ohne Abhängigkeiten): legt
  `NSGlassEffectView` (macOS 26+) als unterste Unteransichten in die Inhaltsansicht des Fensters, also unter die
  Web-Ansicht. Das Fenster wird durchsichtig (`opaque = NO`, klare Hintergrundfarbe, Schatten bleibt). Das Glas zeigt,
  was hinter dem Fenster liegt (Schreibtisch, andere Fenster), getönt in den Farben der App (`tintColor`).
- **Gebaut** mit `clang++` direkt (`scripts/build-native.mjs`, Teil von `npm run build`): Node-API ist über Node- und
  Electron-Versionen stabil, die Header des Node-Werkzeugs genügen (`-undefined dynamic_lookup`), kein node-gyp, kein
  Netz. Universell (arm64 + x86_64), Mindestversion macOS 12; das Glas nur ab macOS 26 (`@available`). Ohne
  Xcode-Werkzeuge oder unter Windows wird die Erweiterung übersprungen.
- **Paket:** `asarUnpack: out/native/**`; geladen mit `process.dlopen` aus `app.asar.unpacked` (`src/main/native-glass.ts`).
  Abschalten zum Vergleich: `BLATTWERK_NO_NATIVE_GLASS=1`.
- **Flächen** meldet der Renderer (`src/renderer/app/native-glass.ts`, IPC `glass:regions`, geprüft mit
  `validateGlassRegions`): Startseite = ganzes Fenster; Dokument = Band oben (Werkzeugleiste, Tabs, Modusleiste) und
  die schwebenden Seitenleisten. Neu gemessen bei Größenänderung, Ein- und Ausblenden von Leisten und Farbschema.
  Die Flächen haben `autoresizingMask`, damit sie beim Ziehen am Fenster ohne Verzögerung mitgehen.
- **Oberfläche** unter `[data-native-glass='on']`: an den Glasstellen durchsichtig, Dokumentansicht deckend; die Lücken
  rund um die schwebenden Seitenleisten füllt ein breiter Schatten in der Farbe der Dokumentansicht.
- **Prüfung:** Oberflächentest liest die nativen Rahmen aus (`__blattwerkGlass`, nur im Testmodus); der Rauchtest der
  fertigen App prüft, dass die Erweiterung geladen ist.

## Erfahrungen aus der Sichtprüfung (Fenster kurz sichtbar, mit Erlaubnis des Auftraggebers)

- Das Fenster muss **beim Erzeugen** durchsichtig sein (`transparent: true`). Wird es erst danach umgestellt, löscht
  Chromium durchsichtig gewordene Bereiche nicht: Unter der Startseite blieben Reste des vorher offenen Dokuments
  stehen, die Seitenleiste zeigte alte dunkle Bildpunkte statt Glas.
- Tönung 72 % (Band, Startseite) bzw. 68 % (Seitenleisten) in Papier- bzw. Flächenfarbe: Farben dahinter bleiben
  erkennbar, Text gut lesbar. Mit 55 % dominierten bunte Hintergründe.

## Grenzen

- Das Glas liegt unter der Web-Ansicht: Es bricht den Schreibtisch, nicht die Inhalte der App. Die Brechung von
  App-Inhalten (Dialoge, Umschalter) bleibt beim CSS-Glas aus ADR 0022.
- Bildschirmfotos aus den unsichtbaren Tests zeigen das native Glas nicht (es entsteht erst im Fenstersystem).
- Geprüft im dunklen Modus; der helle Modus folgt denselben Regeln, wurde aber nicht am sichtbaren Fenster angesehen.
