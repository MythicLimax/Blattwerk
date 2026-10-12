# 0004: Als Standardprogramm für PDFs festlegen

- Status: angenommen (2026-10-12, Phase 1)

## Entscheidung

- **Dateizuordnung:** electron-builder trägt `.pdf` in die Info.plist (macOS, Rolle „Viewer“, Rang „Alternate“) bzw. als ProgID im Installer (Windows) ein. Damit erscheint Blattwerk unter „Öffnen mit“.
- **macOS:** Der Menüpunkt „Als Standardprogramm für PDFs festlegen …“ ruft in der installierten App über JavaScript for Automation (`osascript -l JavaScript`) die Launch-Services-Funktion `LSSetDefaultRoleHandlerForContentType` für den Typ `com.adobe.pdf` (der systemweite Name für PDF) mit der Bundle-ID `de.blattwerk.app` auf. Klappt das nicht, zeigt die App eine Anleitung (Finder → Informationen → Öffnen mit → Alle ändern).
- **Windows:** Apps dürfen sich nicht selbst als Standard eintragen. Die App öffnet die Einstellungsseite „Standard-Apps“ und zeigt einen Hinweis.

## Begründung

Electron bietet keine Schnittstelle für Standardprogramme von Dateitypen (nur für URL-Protokolle). Ein natives Modul nur dafür wäre unverhältnismäßig. `LSSetDefaultRoleHandlerForContentType` ist veraltet, funktioniert aber; die Nachfolger-API (`NSWorkspace.setDefaultApplication`) ist aus JavaScript for Automation nur umständlich erreichbar.

## Sicherheit

Die Funktion ist nur über das native Menü im Hauptprozess erreichbar, nicht über IPC aus dem Renderer. Das Skript enthält nur feste Werte, keine Eingaben.

## Test

Nicht automatisiert, weil es die Systemeinstellung des Testrechners ändern würde. Steht im Phasenbericht als Handprüfung.
