// electron-builder: läuft nach dem Zusammenstellen der App und vor dem Signieren.
// Entfernt erweiterte Dateiattribute (z. B. von iCloud oder dem Finder), an denen codesign sonst scheitert.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('/usr/bin/xattr', ['-cr', appPath]);
};
