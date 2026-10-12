// Befehle, die das native Menü an den Renderer schickt.
// Jeder Befehl braucht einen Eintrag in shortcuts.ts und eine Übersetzung unter menu.<id>.
export const COMMANDS = [
  'file.open',
  'file.close',
  'file.print',
  'file.properties',
  'edit.find',
  'edit.findNext',
  'edit.findPrevious',
  'view.zoomIn',
  'view.zoomOut',
  'view.fitPage',
  'view.actualSize',
  'view.fitWidth',
  'view.modeSingle',
  'view.modeContinuous',
  'view.modeTwoPage',
  'view.modeTwoPageContinuous',
  'view.rotateClockwise',
  'view.rotateCounterClockwise',
  'view.toggleSidebar',
  'view.toggleRightPanel',
  'nav.firstPage',
  'nav.previousPage',
  'nav.nextPage',
  'nav.lastPage',
  'nav.goToPage',
  'window.nextTab',
  'window.previousTab',
] as const;

export type CommandId = (typeof COMMANDS)[number];

export function isCommandId(value: unknown): value is CommandId {
  return typeof value === 'string' && (COMMANDS as readonly string[]).includes(value);
}
