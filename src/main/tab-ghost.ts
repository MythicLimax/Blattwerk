// Vorschau am Zeiger beim Herausziehen eines Tabs (ADR 0026): ein kleines, durchsichtiges Fenster ohne Rahmen, das
// keine Mausereignisse annimmt und nie den Fokus bekommt. Es zeigt den Tab und ein verkleinertes Bild des Fensters.
// Die Seite (ghost.html) hat keinen Preload und bekommt ihre Daten im Fragment der Adresse.
import { BrowserWindow, nativeTheme } from 'electron';
import { ghostLayout, type GhostLayout, type Point } from './window-layout';

export interface GhostOptions {
  // Adresse von ghost.html (app://bundle/ghost.html bzw. der Vite-Server)
  url: string;
  source: BrowserWindow;
  title: string;
  tabOffset: Point;
}

export class TabGhost {
  private win: BrowserWindow | null = null;
  private layout: GhostLayout;
  private ready = false;
  private visible = false;
  private destroyed = false;
  private last: Point | null = null;

  constructor(private readonly options: GhostOptions) {
    const [width, height] = options.source.getContentSize();
    this.layout = ghostLayout({ width: width ?? 1, height: height ?? 1 }, options.tabOffset);
    void this.create();
  }

  private async create(): Promise<void> {
    // Bild des Fensters vor dem Herausziehen; misslingt es, zeigt die Vorschau nur den Tab
    let image: string;
    try {
      const shot = await this.options.source.webContents.capturePage();
      image = shot.resize({ width: this.layout.preview.width * 2, quality: 'good' }).toJPEG(80).toString('base64');
    } catch {
      image = '';
    }
    if (this.destroyed) return;
    const { width, height } = this.layout;
    const win = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, spellcheck: false },
    });
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'pop-up-menu');
    this.win = win;
    const data = {
      title: this.options.title,
      image: image ? `data:image/jpeg;base64,${image}` : '',
      preview: this.layout.preview,
      dark: nativeTheme.shouldUseDarkColors,
    };
    win.webContents.once('did-finish-load', () => {
      this.ready = true;
      this.apply();
    });
    void win.loadURL(`${this.options.url}#${encodeURIComponent(JSON.stringify(data))}`).catch(() => undefined);
  }

  // Zeiger an dieser Stelle des Bildschirms; ohne Punkt verbergen
  moveTo(point: Point | null): void {
    this.last = point;
    this.apply();
  }

  private apply(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !this.ready) return;
    if (!this.last) {
      if (this.visible) win.hide();
      this.visible = false;
      return;
    }
    win.setPosition(Math.round(this.last.x - this.layout.anchor.x), Math.round(this.last.y - this.layout.anchor.y));
    if (!this.visible) win.showInactive();
    this.visible = true;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
