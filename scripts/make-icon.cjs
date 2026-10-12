// Rendert resources/icon.svg mit Electron in build/icon.png (1024 × 1024).
// Aufruf: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'resources', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  win.webContents.setZoomFactor(1);
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const resized = image.getSize().width === 1024 ? image : image.resize({ width: 1024, height: 1024, quality: 'best' });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), resized.toPNG());
  console.log('build/icon.png', resized.getSize());
  app.quit();
});
