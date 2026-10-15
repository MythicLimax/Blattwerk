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
  // Hauptansicht sichtbar (im Raster „Seiten organisieren“ gibt es kein Zoomen, Blättern und Suchen)
  const viewing = doc && !state.organizeMode;

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
      cmd('file.combine', t('menu.file.combine')),
      cmd('file.fromImages', t('menu.file.fromImages')),
      { type: 'separator' },
      cmd('file.save', t('menu.file.save'), { enabled: doc && state.activeDirty }),
      cmd('file.saveAs', t('menu.file.saveAs'), { enabled: doc }),
      { type: 'separator' },
      // Schließen wirkt auf jeden Tab, auch während des Ladens, bei Kennwortabfrage oder Fehler.
      // Ohne Tabs schließt dasselbe Kürzel unter macOS das Fenster, wie in anderen Mac-Apps.
      ...(isMac && state.tabCount === 0
        ? [{ role: 'close' as const, label: t('menu.file.closeWindow'), accelerator: SHORTCUTS['file.close']?.accelerator }]
        : [cmd('file.close', t('menu.file.close'), { enabled: state.tabCount > 0 })]),
      { type: 'separator' },
      {
        label: t('menu.file.export'),
        enabled: viewing,
        submenu: [
          cmd('file.exportImages', t('menu.file.exportImages'), { enabled: viewing }),
          cmd('file.exportText', t('menu.file.exportText'), { enabled: viewing }),
        ],
      },
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
      // Rückgängig/Wiederholen gehen an den Renderer: In Eingabefeldern wirken sie auf den Text,
      // sonst auf die Kommentare des Dokuments. Deshalb immer aktiv.
      cmd('edit.undo', t('menu.edit.undo')),
      cmd('edit.redo', t('menu.edit.redo')),
      { type: 'separator' },
      { role: 'cut', label: t('menu.edit.cut') },
      { role: 'copy', label: t('menu.edit.copy') },
      { role: 'paste', label: t('menu.edit.paste') },
      cmd('edit.delete', t('menu.edit.delete'), { enabled: doc }),
      { role: 'selectAll', label: t('menu.edit.selectAll') },
      { type: 'separator' },
      cmd('edit.find', t('menu.edit.find'), { enabled: viewing }),
      cmd('edit.findNext', t('menu.edit.findNext'), { enabled: viewing }),
      cmd('edit.findPrevious', t('menu.edit.findPrevious'), { enabled: viewing }),
      ...(isMac ? [] : [{ type: 'separator' as const }, cmd('app.settings', t('menu.app.settings'))]),
    ],
  };

  const modeItem = (mode: ViewMode, label: string): MenuItemConstructorOptions =>
    cmd(VIEW_MODE_COMMANDS[mode], label, {
      type: 'radio',
      checked: state.viewMode === mode,
      enabled: viewing,
    });

  const viewMenu: MenuItemConstructorOptions = {
    label: t('menu.view.title'),
    submenu: [
      cmd('view.zoomIn', t('menu.view.zoomIn'), { enabled: viewing }),
      cmd('view.zoomOut', t('menu.view.zoomOut'), { enabled: viewing }),
      { type: 'separator' },
      cmd('view.fitPage', t('menu.view.fitPage'), { enabled: viewing }),
      cmd('view.actualSize', t('menu.view.actualSize'), { enabled: viewing }),
      cmd('view.fitWidth', t('menu.view.fitWidth'), { enabled: viewing }),
      { type: 'separator' },
      {
        label: t('menu.view.pageDisplay'),
        enabled: viewing,
        submenu: [
          modeItem('single', t('menu.view.modeSingle')),
          modeItem('continuous', t('menu.view.modeContinuous')),
          modeItem('two-page', t('menu.view.modeTwoPage')),
          modeItem('two-page-continuous', t('menu.view.modeTwoPageContinuous')),
        ],
      },
      {
        label: t('menu.view.rotate'),
        enabled: viewing,
        submenu: [
          cmd('view.rotateClockwise', t('menu.view.rotateClockwise'), { enabled: viewing }),
          cmd('view.rotateCounterClockwise', t('menu.view.rotateCounterClockwise'), { enabled: viewing }),
        ],
      },
      { type: 'separator' },
      cmd('view.toggleSidebar', t('menu.view.toggleSidebar'), {
        type: 'checkbox',
        checked: viewing && state.sidebarVisible,
        enabled: viewing,
      }),
      cmd('view.toggleRightPanel', t('menu.view.toggleRightPanel'), {
        type: 'checkbox',
        checked: viewing && state.rightPanelVisible,
        enabled: viewing,
      }),
      cmd('view.toggleCommentTools', t('menu.view.toggleCommentTools'), {
        type: 'checkbox',
        checked: viewing && state.commentToolsVisible,
        enabled: viewing,
      }),
      { type: 'separator' },
      { role: 'togglefullscreen', label: t('menu.view.fullscreen') },
      ...(ctx.devTools ? [{ role: 'toggleDevTools' as const, label: t('menu.view.devTools') }] : []),
    ],
  };

  // Seiten organisieren (wie das frühere Menü „Dokument“ in Acrobat)
  const assemble = doc && state.canAssemble;
  const documentMenu: MenuItemConstructorOptions = {
    label: t('menu.pages.title'),
    submenu: [
      cmd('pages.organize', t('menu.pages.organize'), { type: 'checkbox', checked: doc && state.organizeMode, enabled: doc }),
      { type: 'separator' },
      {
        label: t('menu.pages.rotate'),
        enabled: assemble,
        submenu: [
          cmd('pages.rotateClockwise', t('menu.pages.rotateClockwise'), { enabled: assemble }),
          cmd('pages.rotateCounterClockwise', t('menu.pages.rotateCounterClockwise'), { enabled: assemble }),
        ],
      },
      cmd('pages.delete', t('menu.pages.delete'), { enabled: assemble }),
      {
        label: t('menu.pages.insert'),
        enabled: assemble,
        submenu: [
          cmd('pages.insertFromFile', t('menu.pages.insertFromFile'), { enabled: assemble }),
          cmd('pages.insertBlank', t('menu.pages.insertBlank'), { enabled: assemble }),
        ],
      },
      { type: 'separator' },
      cmd('pages.extract', t('menu.pages.extract'), { enabled: doc && state.canExtract }),
      cmd('pages.split', t('menu.pages.split'), { enabled: doc && state.canExtract }),
      { type: 'separator' },
      cmd('tools.sign', t('menu.pages.sign'), { enabled: viewing && !state.formEditing }),
      cmd('content.edit', t('menu.pages.editContent'), { type: 'checkbox', checked: viewing && state.contentEditing, enabled: viewing }),
      cmd('forms.edit', t('menu.pages.editForm'), { type: 'checkbox', checked: viewing && state.formEditing, enabled: viewing && state.canEditForms }),
      { type: 'separator' },
      cmd('redact.tools', t('menu.pages.redact'), { type: 'checkbox', checked: viewing && state.redactToolsVisible, enabled: viewing && !state.formEditing }),
      cmd('redact.find', t('menu.pages.redactFind'), { enabled: viewing && !state.formEditing }),
      cmd('redact.apply', t('menu.pages.redactApply'), { enabled: viewing && state.hasRedactionMarks }),
      { type: 'separator' },
      {
        label: t('menu.pages.watermark'),
        enabled: doc,
        submenu: [
          cmd('stamp.watermark', t('menu.pages.addWatermark'), { enabled: doc }),
          cmd('stamp.removeWatermark', t('menu.pages.removeWatermark'), { enabled: doc }),
        ],
      },
      {
        label: t('menu.pages.headerFooter'),
        enabled: doc,
        submenu: [
          cmd('stamp.headerFooter', t('menu.pages.addHeaderFooter'), { enabled: doc }),
          cmd('stamp.removeHeaderFooter', t('menu.pages.removeHeaderFooter'), { enabled: doc }),
        ],
      },
      cmd('stamp.pageNumbers', t('menu.pages.pageNumbers'), { enabled: doc }),
    ],
  };

  // Werkzeuge (Phase 6)
  const toolsMenu: MenuItemConstructorOptions = {
    label: t('menu.tools.title'),
    submenu: [
      cmd('tools.compare', t('menu.tools.compare'), { enabled: viewing }),
      cmd('tools.compress', t('menu.tools.compress'), { enabled: viewing }),
      cmd('tools.security', t('menu.tools.security'), { enabled: viewing }),
    ],
  };

  const navMenu: MenuItemConstructorOptions = {
    label: t('menu.nav.title'),
    submenu: [
      cmd('nav.firstPage', t('menu.nav.firstPage'), { enabled: viewing }),
      cmd('nav.previousPage', t('menu.nav.previousPage'), { enabled: viewing }),
      cmd('nav.nextPage', t('menu.nav.nextPage'), { enabled: viewing }),
      cmd('nav.lastPage', t('menu.nav.lastPage'), { enabled: viewing }),
      { type: 'separator' },
      cmd('nav.goToPage', t('menu.nav.goToPage'), { enabled: viewing }),
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
            cmd('app.settings', t('menu.app.settings')),
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

  return [...appMenu, fileMenu, editMenu, viewMenu, documentMenu, toolsMenu, navMenu, windowMenu];
}

export function applyMenu(ctx: MenuContext): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(ctx)));
}
