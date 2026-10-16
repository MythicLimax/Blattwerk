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

// Windows: wartet, bis die App beendet ist, startet das Installationsprogramm still (/S) und lässt es die App danach
// starten (--force-run). Werte werden als PowerShell-Zeichenketten eingesetzt (einfache Anführungszeichen verdoppelt).
export function windowsInstallCommand(pid: number, installer: string, reopen: boolean, cleanup: boolean): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return [
    `$appPid = ${Math.trunc(pid)}`,
    `$installer = ${quote(installer)}`,
    'try { Wait-Process -Id $appPid -Timeout 600 -ErrorAction SilentlyContinue } catch {}',
    `$arguments = @('/S'${reopen ? ", '--force-run'" : ''})`,
    '$process = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru',
    cleanup ? 'if ($process.ExitCode -eq 0) { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue }' : '',
  ]
    .filter(Boolean)
    .join('; ');
}
