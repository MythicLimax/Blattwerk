import {
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Info,
  MessageSquare,
  PanelLeft,
  Printer,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewMode } from '../../shared/ipc';
import { IconButton } from '../components/IconButton';
import { focusViewer, getRuntime } from '../engine/runtime';
import { executeCommand, goToPage, openWithDialog, printTab, setScaleValue, setViewMode } from '../engine/session';
import { isDirty, useTabAnnotations } from '../state/annotations-store';
import { VIEW_MODES } from '../features/viewer/view-modes';
import { isPresetScaleValue, scaleToPercent, ZOOM_MENU_PERCENTS } from '../features/viewer/zoom';
import { useActiveTab, type TabState } from '../state/documents-store';
import { useUi } from '../state/ui-store';
import styles from './Toolbar.module.css';

function PageInput({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  // Während der Eingabe zeigt das Feld den Entwurf, sonst die aktuelle Seite.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(tab.currentPage);

  const commit = () => {
    if (draft !== null) {
      const page = Number.parseInt(draft, 10);
      if (Number.isFinite(page)) goToPage(tab, page);
    }
    setDraft(null);
  };

  const done = (input: HTMLInputElement) => {
    input.blur();
    focusViewer(getRuntime(tab.id));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commit();
      done(event.currentTarget);
    } else if (event.key === 'Escape') {
      setDraft(null);
      done(event.currentTarget);
    }
  };

  return (
    <span className={styles.pageGroup}>
      <input
        className={styles.pageInput}
        aria-label={t('toolbar.pageNumber')}
        data-testid="page-input"
        inputMode="numeric"
        value={value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onFocus={(event) => event.currentTarget.select()}
      />
      <span className={styles.pageCount} data-testid="page-count">
        {t('toolbar.pageOf', { count: tab.pageCount })}
      </span>
    </span>
  );
}

function ZoomSelect({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const percent = scaleToPercent(tab.scale);
  const presetLabels: Record<string, string> = {
    auto: t('toolbar.zoom.auto'),
    'page-width': t('toolbar.zoom.pageWidth'),
    'page-fit': t('toolbar.zoom.pageFit'),
    'page-actual': t('toolbar.zoom.pageActual'),
  };
  const isPreset = isPresetScaleValue(tab.scaleValue);
  const matchingPercent = ZOOM_MENU_PERCENTS.find((p) => Math.abs(p / 100 - tab.scale) < 0.001);
  const selectValue = isPreset ? tab.scaleValue : matchingPercent ? String(matchingPercent / 100) : 'custom';

  return (
    <select
      className={styles.select}
      aria-label={t('toolbar.zoomSelect')}
      title={t('toolbar.zoomSelect')}
      data-testid="zoom-select"
      value={selectValue}
      onChange={(event) => {
        setScaleValue(tab, event.target.value);
        focusViewer(getRuntime(tab.id));
      }}
    >
      {Object.entries(presetLabels).map(([value, label]) => (
        <option key={value} value={value}>
          {value === tab.scaleValue ? `${label} (${t('toolbar.zoom.percent', { value: percent })})` : label}
        </option>
      ))}
      <option disabled>──────</option>
      {ZOOM_MENU_PERCENTS.map((p) => (
        <option key={p} value={String(p / 100)}>
          {t('toolbar.zoom.percent', { value: p })}
        </option>
      ))}
      {selectValue === 'custom' && (
        <option value="custom" hidden>
          {t('toolbar.zoom.percent', { value: percent })}
        </option>
      )}
    </select>
  );
}

function ViewModeSelect({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  return (
    <select
      className={styles.select}
      aria-label={t('toolbar.viewMode')}
      title={t('toolbar.viewMode')}
      data-testid="view-mode-select"
      value={tab.viewMode}
      onChange={(event) => {
        setViewMode(tab, event.target.value as ViewMode);
        focusViewer(getRuntime(tab.id));
      }}
    >
      {VIEW_MODES.map((mode) => (
        <option key={mode} value={mode}>
          {t(`viewMode.${mode}`)}
        </option>
      ))}
    </select>
  );
}

export function Toolbar() {
  const { t } = useTranslation();
  const tab = useActiveTab();
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const rightPanelVisible = useUi((s) => s.rightPanelVisible);
  const commentToolsVisible = useUi((s) => s.commentToolsVisible);
  const annotations = useTabAnnotations(tab?.id);
  const ready = tab?.status === 'ready';
  const dirty = ready && isDirty(annotations);

  return (
    <header
      className={styles.toolbar}
      data-testid="toolbar"
      // Klicks auf Schaltflächen nehmen dem Dokument nicht den Tastaturfokus (Pfeile, Bild auf/ab scrollen weiter).
      // Per Tab-Taste bleiben die Schaltflächen erreichbar.
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) event.preventDefault();
      }}
    >
      <div className={styles.group}>
        {ready && (
          <IconButton
            icon={PanelLeft}
            label={t('toolbar.sidebar')}
            pressed={sidebarVisible}
            onClick={() => executeCommand('view.toggleSidebar')}
          />
        )}
        <IconButton icon={FolderOpen} label={t('toolbar.open')} onClick={() => void openWithDialog()} data-testid="open-button" />
        {ready && (
          <IconButton
            icon={Save}
            label={t('toolbar.save')}
            disabled={!dirty || tab.saving}
            onClick={() => executeCommand('file.save')}
            data-testid="save-button"
          />
        )}
        {ready && (
          <IconButton
            icon={Printer}
            label={t('toolbar.print')}
            disabled={!tab.canPrint}
            onClick={() => void printTab(tab)}
            data-testid="print-button"
          />
        )}
      </div>

      {ready && (
        <div className={styles.center}>
          <div className={styles.group}>
            <IconButton
              icon={ChevronUp}
              label={t('toolbar.previousPage')}
              disabled={tab.currentPage <= 1}
              onClick={() => executeCommand('nav.previousPage')}
            />
            <IconButton
              icon={ChevronDown}
              label={t('toolbar.nextPage')}
              disabled={tab.currentPage >= tab.pageCount}
              onClick={() => executeCommand('nav.nextPage')}
            />
            <PageInput key={tab.id} tab={tab} />
          </div>
          <span className={styles.separator} />
          <div className={styles.group}>
            <IconButton icon={ZoomOut} label={t('toolbar.zoomOut')} onClick={() => executeCommand('view.zoomOut')} />
            <ZoomSelect tab={tab} />
            <IconButton icon={ZoomIn} label={t('toolbar.zoomIn')} onClick={() => executeCommand('view.zoomIn')} />
          </div>
          <span className={styles.separator} />
          <div className={styles.group}>
            <ViewModeSelect tab={tab} />
            <IconButton
              icon={RotateCcw}
              label={t('toolbar.rotateCounterClockwise')}
              onClick={() => executeCommand('view.rotateCounterClockwise')}
            />
            <IconButton
              icon={RotateCw}
              label={t('toolbar.rotateClockwise')}
              onClick={() => executeCommand('view.rotateClockwise')}
            />
          </div>
        </div>
      )}

      {ready && (
        <div className={styles.group}>
          <IconButton
            icon={MessageSquare}
            label={t('toolbar.comment')}
            pressed={commentToolsVisible}
            onClick={() => executeCommand('view.toggleCommentTools')}
            data-testid="comment-tools-button"
          />
          <IconButton
            icon={Info}
            label={t('toolbar.properties')}
            onClick={() => executeCommand('file.properties')}
            data-testid="properties-button"
          />
          <IconButton
            icon={Search}
            label={t('toolbar.search')}
            pressed={rightPanelVisible}
            onClick={() => (rightPanelVisible ? executeCommand('view.toggleRightPanel') : executeCommand('edit.find'))}
            data-testid="search-button"
          />
        </div>
      )}
    </header>
  );
}
