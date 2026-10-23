// Hilfsskripte zum Einspielen eines Updates (ADR 0025). Sie laufen losgelöst, nachdem die App sich beendet hat.

// macOS: wartet, bis die App beendet ist, kopiert die neue App daneben, tauscht sie gegen die alte aus und öffnet sie.
// Schlägt etwas fehl, bleibt die alte App erhalten. Argumente: pid, neue App, laufende App, „open“|„no“,
// „cleanup“ (Update danach löschen; nicht bei einem geteilten Ordner, den andere Rechner noch brauchen)
export const INSTALL_SCRIPT = `
pid="$1"; new="$2"; cur="$3"; reopen="$4"; cleanup="$5"
i=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.2; i=$((i+1))
  [ "$i" -gt 3000 ] && exit 1
done
tmp="$cur.update-$$"
old="$cur.old-$$"
rm -rf "$tmp"
/usr/bin/ditto "$new" "$tmp" || { rm -rf "$tmp"; exit 1; }
/usr/bin/xattr -dr com.apple.quarantine "$tmp" 2>/dev/null
mv "$cur" "$old" || { rm -rf "$tmp"; exit 1; }
if ! mv "$tmp" "$cur"; then mv "$old" "$cur"; rm -rf "$tmp"; exit 1; fi
rm -rf "$old"
[ "$cleanup" = "cleanup" ] && rm -rf "$new"
[ "$reopen" = "open" ] && /usr/bin/open "$cur"
exit 0
`;

// Windows: wartet, bis die App und ihre Hilfsprozesse beendet sind, startet das Installationsprogramm still (/S) und
// danach die App selbst neu (das Installationsprogramm mit Ordnerwahl startet sie im stillen Modus nicht). Auch wenn die
// Installation scheitert, öffnet sich die App wieder (dann die alte Version). Jeder Schritt landet in einer
// Protokolldatei. Werte werden als PowerShell-Zeichenketten eingesetzt (einfache Anführungszeichen verdoppelt).
export interface WindowsInstall {
  pid: number;
  installer: string;
  // Laufende App (process.execPath); das Installationsprogramm schreibt an denselben Ort
  app: string;
  log: string;
  reopen: boolean;
  cleanup: boolean;
}

export function windowsInstallCommand({ pid, installer, app, log, reopen, cleanup }: WindowsInstall): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return [
    `$log = ${quote(log)}`,
    "function Log($text) { try { Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $text) -Encoding UTF8 } catch {} }",
    `$appPid = ${Math.trunc(pid)}`,
    `$installer = ${quote(installer)}`,
    `$app = ${quote(app)}`,
    "Log ('Update mit ' + $installer + ', warte auf das Ende von Blattwerk')",
    'try { Wait-Process -Id $appPid -Timeout 600 -ErrorAction SilentlyContinue } catch {}',
    // Hilfsprozesse (Grafik, Fenster) enden kurz nach dem Hauptprozess; sonst bricht die Installation ab
    '$rest = @()',
    'for ($i = 0; $i -lt 150; $i++) { $rest = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $app }); if ($rest.Count -eq 0) { break }; Start-Sleep -Milliseconds 200 }',
    "if ($rest.Count -gt 0) { Log ('Beende ' + $rest.Count + ' verbliebene Prozesse'); $rest | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1 }",
    "Log 'Installiere'",
    "try { $process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru -ErrorAction Stop; $code = $process.ExitCode } catch { Log ('Installationsprogramm nicht gestartet: ' + $_); $code = -1 }",
    "Log ('Installationsprogramm beendet mit ' + $code)",
    cleanup ? 'if ($code -eq 0) { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue }' : '',
    reopen
      ? "if (Test-Path -LiteralPath $app) { try { Start-Process -FilePath $app -ErrorAction Stop; Log 'Blattwerk neu gestartet' } catch { Log ('Neustart gescheitert: ' + $_) } } else { Log ('Blattwerk nicht gefunden: ' + $app) }"
      : '',
  ]
    .filter(Boolean)
    .join('; ');
}
