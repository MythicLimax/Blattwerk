# 0020 Gestaltung: Papier, Flaschengrün, Farben je Arbeitsbereich

Stand: 2026-10-15 · Wunsch des Auftraggebers: farbiger, hilfreich und eigenständig, kein „typisches KI-Design“

## Entscheidung

- **Grundton Papier und Druckfarbe** passend zum Namen: warmer Papierton als Hintergrund, Flaschengrün aus dem
  App-Symbol als Markenfarbe (Hauptschaltflächen, Fokus, aktiver Tab, Auswahl). Dunkler Modus mit warmem Schwarz.
- **Jeder Arbeitsbereich hat eine eigene Farbe** („Töne“, `styles/tokens.css`), überall gleich: Kommentieren Ocker,
  Text und Bilder bearbeiten Ultramarin, Formulare Petrol, Seiten organisieren Moosgrün, Schwärzen Zinnober,
  Unterschreiben Siena. Die Farbe erscheint am Symbol in der Werkzeugleiste, als gefüllte Schaltfläche, wenn der
  Bereich aktiv ist, und als Farbkante mit Namensschild (`ModeBadge`) an seiner Leiste. So sieht man jederzeit, in
  welchem Modus man arbeitet. Die Startseite erklärt die Farben in einer Legende.
- **Schrift:** Oberfläche in der Systemschrift; Wortmarke, Startseite und Dialogtitel in einer Buchschrift
  (New York auf dem Mac). Das gibt einen eigenen, ruhigen Charakter.
- **Bewusst vermieden:** Farbverläufe, Glas- und Leuchteffekte, violette Akzente, stark gerundete schwebende Karten,
  Emojis. Stattdessen flache Flächen, feine Linien, kleine Radien, Farbkanten.

## Technik

- `data-tone="…"` setzt `--tone` und `--tone-soft` für ein Element und seine Kinder; `IconButton` hat die Eigenschaft
  `tone`. In einer getönten Leiste übernehmen gedrückte Werkzeuge deren Farbe.
