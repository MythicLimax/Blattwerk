import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { CommandId } from '../shared/commands';
import type { MenuState, RecentFile, ViewMode } from '../shared/ipc';
import { SHORTCUTS } from '../shared/shortcuts';
import { t } from './i18n';

export interface MenuContext {
  platform: NodeJS.Platform;
  state: MenuState;
  recent: RecentFile[];
  devTools: boolean;
  sendCommand: (command: CommandId) => void;
  openFileDialog: () => void;
  openRecent: (filePath: string) => void;
  clearRecent: () => void;
  setDefaultApp: () => void;
}

const VIEW_MODE_COMMANDS: Record<ViewMode, CommandId> = {
  single: 'view.modeSingle',
  continuous: 'view.modeContinuous',
  'two-page': 'view.modeTwoPage',
  'two-page-continuous': 'view.modeTwoPageContinuous',
};

export function buildMenuTemplate(ctx: MenuContext): MenuItemConstructorOptions[] {
  const isMac = ctx.platform === 'darwin';
  const { state } = ctx;
  const doc = state.hasDocument;

  // Menüpunkt, der einen Befehl an den Renderer schickt. Kürzel kommen aus der zentralen Tabelle.
  const cmd = (
    command: CommandId,
    label: string,
    extra: Partial<MenuItemConstructorOptions> = {},
  ): MenuItemConstructorOptions => {
    const shortcut = SHORTCUTS[command];
    return {
      id: command,
      label,
      click: () => ctx.sendCommand(command),
      ...(shortcut ? { accelerator: shortcut.accelerator, registerAccelerator: !shortcut.rendererHandled } : {}),
      ...extra,
    };
  };

  // "&" leitet in Menütexten ein Tastenkürzel ein; als Zeichen muss es verdoppelt werden.
  const escapeLabel = (text: string) => text.replaceAll('&', '&&');

  const recentItems: MenuItemConstructorOptions[] =
    ctx.recent.length === 0
      ? [{ label: t('menu.file.noRecent'), enabled: false }]
      : [
          ...ctx.recent.map((file) => ({
            label: escapeLabel(file.name),
            sublabel: escapeLabel(file.dir),
            click: () => ctx.openRecent(file.path),
          })),
          { type: 'separator' as const },
          { label: t('menu.file.clearRecent'), click: () => ctx.clearRecent() },
        ];

  const fileMenu: MenuItemConstructorOptions = {
    label: isMac ? t('menu.file.title') : t('menu.file.titleWindows'),
    submenu: [
      {
        id: 'file.open',
        label: t('menu.file.open'),
        accelerator: SHORTCUTS['file.open']?.accelerator,
        click: () => ctx.openFileDialog(),
      },
      { label: t('menu.file.openRecent'), submenu: recentItems },
      { type: 'separator' },
      // Schließen wirkt auf jeden Tab, auch während des Ladens, bei Kennwortabfrage oder Fehler.
      // Ohne Tabs schließt dasselbe Kürzel unter macOS das Fenster, wie in anderen Mac-Apps.
      ...(isMac && state.tabCount === 0
        ? [{ role: 'close' as const, label: t('menu.file.closeWindow'), accelerator: SHORTCUTS['file.close']?.accelerator }]
        : [cmd('file.close', t('menu.file.close'), { enabled: state.tabCount > 0 })]),
      { type: 'separator' },
      cmd('file.properties', t('menu.file.properties'), { enabled: doc }),
      cmd('file.print', t('menu.file.print'), { enabled: doc && state.canPrint }),
      { type: 'separator' },
      { label: t('menu.file.setDefault'), click: () => ctx.setDefaultApp() },
      ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: t('menu.file.quit') }]),
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: t('menu.edit.title'),
    submenu: [
      // Rollen wirken in Eingabefeldern (z. B. Suchfeld). Für Dokumentänderungen kommt Rückgängig in Phase 2.
      { role: 'undo', label: t('menu.edit.undo') },
      { role: 'redo', label: t('menu.edit.redo') },
      { type: 'separator' },
      { role: 'cut', label: t('menu.edit.cut') },
      { role: 'copy', label: t('menu.edit.copy') },
      { role: 'paste', label: t('menu.edit.paste') },
      { role: 'selectAll', label: t('menu.edit.selectAll') },
      { type: 'separator' },
      cmd('edit.find', t('menu.edit.find'), { enabled: doc }),
      cmd('edit.findNext', t('menu.edit.findNext'), { enabled: doc }),
      cmd('edit.findPrevious', t('menu.edit.findPrevious'), { enabled: doc }),
    ],
  };

  const modeItem = (mode: ViewMode, label: string): MenuItemConstructorOptions =>
    cmd(VIEW_MODE_COMMANDS[mode], label, {
      type: 'radio',
      checked: state.viewMode === mode,
      enabled: doc,
    });

  const viewMenu: MenuItemConstructorOptions = {
    label: t('menu.view.title'),
    submenu: [
      cmd('view.zoomIn', t('menu.view.zoomIn'), { enabled: doc }),
      cmd('view.zoomOut', t('menu.view.zoomOut'), { enabled: doc }),
      { type: 'separator' },
      cmd('view.fitPage', t('menu.view.fitPage'), { enabled: doc }),
      cmd('view.actualSize', t('menu.view.actualSize'), { enabled: doc }),
      cmd('view.fitWidth', t('menu.view.fitWidth'), { enabled: doc }),
      { type: 'separator' },
      {
        label: t('menu.view.pageDisplay'),
        enabled: doc,
        submenu: [
          modeItem('single', t('menu.view.modeSingle')),
          modeItem('continuous', t('menu.view.modeContinuous')),
          modeItem('two-page', t('menu.view.modeTwoPage')),
          modeItem('two-page-continuous', t('menu.view.modeTwoPageContinuous')),
        ],
      },
      {
        label: t('menu.view.rotate'),
        enabled: doc,
        submenu: [
          cmd('view.rotateClockwise', t('menu.view.rotateClockwise'), { enabled: doc }),
          cmd('view.rotateCounterClockwise', t('menu.view.rotateCounterClockwise'), { enabled: doc }),
        ],
      },
      { type: 'separator' },
      cmd('view.toggleSidebar', t('menu.view.toggleSidebar'), {
        type: 'checkbox',
        checked: doc && state.sidebarVisible,
        enabled: doc,
      }),
      cmd('view.toggleRightPanel', t('menu.view.toggleRightPanel'), {
        type: 'checkbox',
        checked: doc && state.rightPanelVisible,
        enabled: doc,
      }),
      { type: 'separator' },
      { role: 'togglefullscreen', label: t('menu.view.fullscreen') },
      ...(ctx.devTools ? [{ role: 'toggleDevTools' as const, label: t('menu.view.devTools') }] : []),
    ],
  };

  const navMenu: MenuItemConstructorOptions = {
    label: t('menu.nav.title'),
    submenu: [
      cmd('nav.firstPage', t('menu.nav.firstPage'), { enabled: doc }),
      cmd('nav.previousPage', t('menu.nav.previousPage'), { enabled: doc }),
      cmd('nav.nextPage', t('menu.nav.nextPage'), { enabled: doc }),
      cmd('nav.lastPage', t('menu.nav.lastPage'), { enabled: doc }),
      { type: 'separator' },
      cmd('nav.goToPage', t('menu.nav.goToPage'), { enabled: doc }),
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: t('menu.window.title'),
    role: isMac ? 'windowMenu' : undefined,
    submenu: [
      { role: 'minimize', label: isMac ? t('menu.window.minimize') : t('menu.window.minimizeWindows') },
      ...(isMac ? [{ role: 'zoom' as const, label: t('menu.window.zoom') }] : []),
      { type: 'separator' },
      cmd('window.nextTab', t('menu.window.nextTab'), { enabled: state.tabCount > 1 }),
      cmd('window.previousTab', t('menu.window.previousTab'), { enabled: state.tabCount > 1 }),
      ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const, label: t('menu.window.front') }] : []),
    ],
  };

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          role: 'appMenu',
          submenu: [
            { role: 'about', label: t('menu.app.about') },
            { type: 'separator' },
            { role: 'services', label: t('menu.app.services') },
            { type: 'separator' },
            { role: 'hide', label: t('menu.app.hide') },
            { role: 'hideOthers', label: t('menu.app.hideOthers') },
            { role: 'unhide', label: t('menu.app.showAll') },
            { type: 'separator' },
            { role: 'quit', label: t('menu.app.quit') },
          ],
        },
      ]
    : [];

  return [...appMenu, fileMenu, editMenu, viewMenu, navMenu, windowMenu];
}

export function applyMenu(ctx: MenuContext): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(ctx)));
}
