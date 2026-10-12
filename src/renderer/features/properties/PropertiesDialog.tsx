import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogButton } from '../../components/Dialog';
import { getRuntime } from '../../engine/runtime';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { deniedPermissions, describePageSize, formatFileSize, parsePdfDate, type PermissionKey } from './properties';
import styles from './PropertiesDialog.module.css';

interface Properties {
  info: Record<string, unknown>;
  // null, wenn sich Seite 1 nicht laden lässt (beschädigtes Dokument)
  pageWidth: number | null;
  pageHeight: number | null;
  tagged: boolean;
  denied: PermissionKey[];
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeStyle: 'medium' });

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function PropertiesDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const close = () => useUi.getState().openProperties(null);
  const [props, setProps] = useState<Properties | null>(null);

  useEffect(() => {
    const pdf = getRuntime(tab.id)?.pdf;
    if (!pdf) return;
    let cancelled = false;
    void (async () => {
      const [metadata, permissions, page, markInfo] = await Promise.all([
        pdf.getMetadata().catch(() => null),
        pdf.getPermissions().catch(() => null),
        pdf
          .getPage(1)
          .then((p) => p.getViewport({ scale: 1 }))
          .catch(() => null),
        pdf.getMarkInfo().catch(() => null),
      ]);
      if (cancelled) return;
      setProps({
        info: (metadata?.info ?? {}) as Record<string, unknown>,
        pageWidth: page?.width ?? null,
        pageHeight: page?.height ?? null,
        tagged: Boolean(markInfo?.Marked),
        denied: deniedPermissions(permissions),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.id]);

  const none = t('properties.none');
  const date = (value: unknown) => {
    const parsed = parsePdfDate(value);
    return parsed ? dateFormat.format(parsed) : none;
  };

  const rows: Array<[string, string]> = [];
  if (props) {
    const { info } = props;
    const size = formatFileSize(tab.size);
    const page =
      props.pageWidth !== null && props.pageHeight !== null ? describePageSize(props.pageWidth, props.pageHeight) : null;
    const pageArgs = page ? { ...page, orientation: t(`properties.${page.orientation}`) } : null;
    const encrypted = Boolean(info.EncryptFilterName);
    const security = !encrypted
      ? t('properties.noSecurity')
      : [
          tab.openedWithPassword ? t('properties.passwordProtected') : '',
          props.denied.length > 0
            ? t('properties.restricted', { list: props.denied.map((p) => t(`properties.permission.${p}`)).join(', ') })
            : t('properties.unrestricted'),
        ]
          .filter(Boolean)
          .join(' · ');

    rows.push(
      [t('properties.fileName'), tab.name],
      [t('properties.location'), tab.dir],
      [t('properties.fileSize'), t('properties.sizeBytes', size)],
      [t('properties.docTitle'), text(info.Title) ?? none],
      [t('properties.author'), text(info.Author) ?? none],
      [t('properties.subject'), text(info.Subject) ?? none],
      [t('properties.keywords'), text(info.Keywords) ?? none],
      [t('properties.created'), date(info.CreationDate)],
      [t('properties.modified'), date(info.ModDate)],
      [t('properties.creator'), text(info.Creator) ?? none],
      [t('properties.producer'), text(info.Producer) ?? none],
      [t('properties.version'), text(info.PDFFormatVersion) ?? none],
      [t('properties.pageCount'), String(tab.pageCount)],
      [
        t('properties.pageSize'),
        !page || !pageArgs
          ? none
          : page.name
            ? t('properties.pageSizeNamed', pageArgs)
            : t('properties.pageSizeValue', pageArgs),
      ],
      [t('properties.linearized'), info.IsLinearized ? t('properties.yes') : t('properties.no')],
      [t('properties.tagged'), props.tagged ? t('properties.yes') : t('properties.no')],
      [t('properties.forms'), info.IsAcroFormPresent ? t('properties.yes') : t('properties.no')],
      [t('properties.security'), security],
    );
  }

  return (
    <Dialog
      title={t('properties.title')}
      onClose={close}
      onSubmit={close}
      width={520}
      testId="properties-dialog"
      actions={
        <DialogButton type="submit" primary autoFocus>
          {t('properties.close')}
        </DialogButton>
      }
    >
      <dl className={styles.list}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.row}>
            <dt className={styles.label}>{label}</dt>
            <dd className={styles.value}>{value}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
