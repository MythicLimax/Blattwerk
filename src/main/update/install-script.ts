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
