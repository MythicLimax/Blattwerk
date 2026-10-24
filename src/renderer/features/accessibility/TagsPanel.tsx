import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccessibilityReport, TagNode } from '../../../shared/accessibility';
import { DialogButton } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { applyAccessibilityFix, goToPage } from '../../engine/session';
import type { TabState } from '../../state/documents-store';
import outline from '../outline/Outline.module.css';
import { useAccessibility } from './accessibility-store';
import { accessibilityReport } from './report';
import styles from './Accessibility.module.css';

// Rollen, die einen Alternativtext brauchen (PDF/UA): Abbildungen und Formeln
const ALT_ROLES = new Set(['Figure', 'Formula']);

// Alternativtext eines Elements eintragen (Enter übernimmt, Esc verwirft); leer entfernt ihn
function AltEditor({ tab, node, onDone }: { tab: TabState; node: TagNode; onDone: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(node.alt ?? '');
  const save = () => {
    onDone();
    if (value.trim() !== (node.alt ?? '')) void applyAccessibilityFix(tab.id, { lang: null, title: null, elements: [{ id: node.id, alt: value }] });
  };
  return (
    <form
      className={styles.altEditor}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <input
        className={styles.altInput}
        value={value}
        autoFocus
        maxLength={1000}
        placeholder={t('accessibility.tags.altPlaceholder')}
        aria-label={t('accessibility.tags.altLabel')}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
          }
        }}
        data-testid="tag-alt-input"
      />
      <DialogButton type="submit" primary testId="tag-alt-save">
        {t('accessibility.tags.altSave')}
      </DialogButton>
    </form>
  );
}

// Ein Element der Tag-Struktur: Rolle, Zusatzangaben (Alternativtext, Sprache), Klick springt zur Seite
function TagItem({ tab, node, depth }: { tab: TabState; node: TagNode; depth: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(depth < 2);
  const [editing, setEditing] = useState(false);
  const editable = ALT_ROLES.has(node.role) && tab.canModify && !tab.encrypted;
  const hasChildren = node.children.length > 0;
  const Chevron = open ? ChevronDown : ChevronRight;
  const detail = node.alt ?? node.actualText ?? node.title;
  const missingAlt = node.role === 'Figure' && !node.alt && !node.actualText;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-level={depth + 1}>
      <div className={outline.row} style={{ paddingLeft: 4 + depth * 14 }}>
        {hasChildren ? (
          <button type="button" className={outline.toggle} aria-label={open ? t('sidebar.collapse') : t('sidebar.expand')} onClick={() => setOpen(!open)}>
            <Chevron size={14} aria-hidden="true" />
          </button>
        ) : (
          <span className={outline.spacer} />
        )}
        <button
          type="button"
          className={outline.title}
          title={[node.customRole && t('accessibility.tags.customRole', { role: node.customRole }), detail, node.pageIndex !== null && t('accessibility.tags.page', { page: node.pageIndex + 1 })].filter(Boolean).join(' · ')}
          onClick={() => node.pageIndex !== null && goToPage(tab, node.pageIndex + 1)}
          data-testid="tag-item"
          data-role={node.role}
        >
          <span className={styles.role}>&lt;{node.role}&gt;</span>
          {detail && <span className={styles.detail}> {detail}</span>}
          {missingAlt && <span className={styles.missing}> {t('accessibility.tags.noAlt')}</span>}
          {node.lang && <span className={styles.detail}> [{node.lang}]</span>}
        </button>
        {editable && <IconButton icon={Pencil} size={14} label={t('accessibility.tags.altEdit')} onClick={() => setEditing(!editing)} data-testid="tag-alt-edit" />}
      </div>
      {editing && <AltEditor tab={tab} node={node} onDone={() => setEditing(false)} />}
      {hasChildren && open && (
        <ul role="group" className={outline.list}>
          {node.children.map((child, index) => (
            <TagItem key={index} tab={tab} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

// Seitenleiste „Tags“: Struktur für Bildschirmleser
export function TagsPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ pdf: unknown; report: AccessibilityReport | null } | null>(null);
  const pending = accessibilityReport(tab);

  useEffect(() => {
    let cancelled = false;
    pending
      ?.then((report) => !cancelled && setState({ pdf: pending, report }))
      .catch(() => !cancelled && setState({ pdf: pending, report: null }));
    return () => {
      cancelled = true;
    };
  }, [pending]);

  const check = <DialogButton onClick={() => useAccessibility.getState().setOpen(true)} testId="tags-check">{t('accessibility.tags.check')}</DialogButton>;
  if (!state || state.pdf !== pending) return <p className={outline.empty}>{t('accessibility.tags.loading')}</p>;
  if (!state.report) return <p className={outline.empty}>{t('accessibility.tags.failed')}</p>;
  if (state.report.tree.length === 0)
    return (
      <div className={styles.emptyPanel} data-testid="tags-empty">
        <p className={outline.empty}>{t('accessibility.tags.none')}</p>
        {check}
      </div>
    );
  return (
    <div className={outline.scroller} data-testid="tags">
      <ul role="tree" className={outline.list} aria-label={t('sidebar.tags')}>
        {state.report.tree.map((node, index) => (
          <TagItem key={index} tab={tab} node={node} depth={0} />
        ))}
      </ul>
      {state.report.truncated && <p className={outline.empty}>{t('accessibility.tags.truncated')}</p>}
      <div className={styles.panelFooter}>{check}</div>
    </div>
  );
}
