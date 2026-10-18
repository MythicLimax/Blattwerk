// Verlauf der Dokumentstände (Rückgängig/Wiederholen von Seitenoperationen) und „ungespeichert“.
import { beforeEach, describe, expect, it } from 'vitest';
import { useAnnotations, type TabAnnotations } from '../../src/renderer/state/annotations-store';
import { canRedoState, canUndoState, isDirtyState } from '../../src/renderer/state/dirty';
import { historyDirty, trimHistory, useHistory, type DocState, type TabHistory } from '../../src/renderer/state/history-store';

const TAB = 'tab-h';
const state = () => useHistory.getState().tabs[TAB] as TabHistory;
const bytes = (size: number) => new Uint8Array(size);
const doc = (size: number, page = 1): DocState => ({ bytes: bytes(size), annotations: null, page, selection: [] });
const leaving = (page = 1, selection: number[] = []) => ({ annotations: null, page, selection, password: null });

describe('Verlauf der Dokumentstände', () => {
  beforeEach(() => useHistory.getState().reset(TAB));

  it('beginnt mit der Datei auf der Platte und ist dann nicht ungespeichert', () => {
    expect(state().states).toHaveLength(1);
    expect(state().states[0]?.bytes).toBeNull();
    expect(historyDirty(state())).toBe(false);
  });

  it('neue Stände, Rückgängig und Wiederholen merken Seite und Auswahl', () => {
    const store = useHistory.getState();
    store.push(TAB, leaving(3, [2]), doc(10, 5));
    expect(state().cursor).toBe(1);
    expect(historyDirty(state())).toBe(true);
    // Zurück zur Datei: der verlassene Stand merkt sich Seite 7 und Auswahl [6]
    const back = store.moveTo(TAB, 0, leaving(7, [6]));
    expect(back).toMatchObject({ bytes: null, page: 3, selection: [2] });
    expect(historyDirty(state())).toBe(false);
    const forward = store.moveTo(TAB, 1, leaving(3, [2]));
    expect(forward).toMatchObject({ page: 7, selection: [6] });
    expect(store.moveTo(TAB, 5, leaving())).toBeNull();
  });

  it('eine neue Aktion nach Rückgängig verwirft die späteren Stände', () => {
    const store = useHistory.getState();
    store.push(TAB, leaving(), doc(10));
    store.push(TAB, leaving(), doc(10));
    store.moveTo(TAB, 1, leaving());
    store.dropRedo(TAB);
    expect(state().states).toHaveLength(2);
    store.push(TAB, leaving(), doc(10));
    expect(state().states).toHaveLength(3);
    expect(state().cursor).toBe(2);
  });

  it('nach Rückgängig über den gespeicherten Stand hinaus bleibt die Datei erreichbar', () => {
    const store = useHistory.getState();
    store.push(TAB, leaving(), doc(10));
    store.moveTo(TAB, 0, leaving());
    // Neue Seitenoperation von der Datei aus: Der gespeicherte Stand (Index 0) bleibt gültig
    store.push(TAB, leaving(), doc(10));
    expect(state().savedCursor).toBe(0);
    expect(state().states).toHaveLength(2);
  });

  it('hält die Speichergrenze ein und verwirft die ältesten Stände', () => {
    const history: TabHistory = {
      states: [{ bytes: null, annotations: null, page: 1, selection: [] }, doc(400), doc(400), doc(400)],
      cursor: 3,
      savedCursor: 0,
    };
    const trimmed = trimHistory(history, 900);
    expect(trimmed.states).toHaveLength(2);
    expect(trimmed.cursor).toBe(1);
    // Die Datei auf der Platte ist nicht mehr im Verlauf: Der angezeigte Stand bleibt ungespeichert
    expect(trimmed.savedCursor).toBe(-1);
    expect(historyDirty(trimmed)).toBe(true);
  });
});

describe('Ungespeichert und Rückgängig über Kommentare und Seiten', () => {
  beforeEach(() => {
    useHistory.getState().reset(TAB);
    useAnnotations.getState().init(TAB);
  });

  it('kombiniert beide Verläufe', () => {
    const annotations = () => useAnnotations.getState().tabs[TAB] as TabAnnotations;
    expect(isDirtyState(annotations(), state())).toBe(false);
    expect(canUndoState(annotations(), state())).toBe(false);
    useHistory.getState().push(TAB, leaving(), doc(10));
    expect(isDirtyState(annotations(), state())).toBe(true);
    expect(canUndoState(annotations(), state())).toBe(true);
    expect(canRedoState(annotations(), state())).toBe(false);
    useHistory.getState().moveTo(TAB, 0, leaving());
    expect(canRedoState(annotations(), state())).toBe(true);
  });
});

describe('Tabs umsortieren', () => {
  it('verschiebt einen Tab an eine andere Stelle', async () => {
    const { useDocuments } = await import('../../src/renderer/state/documents-store');
    const store = useDocuments.getState();
    for (const id of ['a', 'b', 'c']) store.addTab({ id, fileId: id, name: `${id}.pdf`, dir: '/', size: 1 });
    const order = () => useDocuments.getState().tabs.map((tab) => tab.id);
    useDocuments.getState().moveTab('a', 2);
    expect(order()).toEqual(['b', 'c', 'a']);
    useDocuments.getState().moveTab('c', 0);
    expect(order()).toEqual(['c', 'b', 'a']);
    useDocuments.getState().moveTab('fehlt', 0);
    expect(order()).toEqual(['c', 'b', 'a']);
  });
});
