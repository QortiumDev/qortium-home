import { Eye, File, Folder } from 'lucide-react';
import { useState } from 'react';
import { ModalDialog } from './components/ModalDialog';
import { t } from './i18n';
import { canPreviewDirectoryContent } from './platform';
import { buildQdnPreviewRoute, isQdnService, type QdnRoute } from './qdn';

type PreviewDialogState = {
  error?: string;
  isWorking: boolean;
} | null;

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('preview.failed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function QdnPreviewDialog({
  errorMessage,
  isWorking,
  onDismiss,
  onPick,
}: {
  errorMessage?: string;
  isWorking: boolean;
  onDismiss: () => void;
  onPick: (kind: 'directory' | 'file') => void;
}) {
  return (
    <ModalDialog onDismiss={onDismiss}>
      <section aria-label={t('preview.dialogTitle')} aria-modal="true" className="preview-dialog" role="dialog">
        <h3 className="preview-dialog__title">{t('preview.dialogTitle')}</h3>
        <p className="preview-dialog__intro">{t('preview.dialogIntro')}</p>
        <p className="preview-dialog__supported">{t('preview.supported')}</p>
        {errorMessage ? (
          <p className="preview-dialog__error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="preview-dialog__actions">
          <button className="button button--secondary" type="button" disabled={isWorking} onClick={onDismiss}>
            {t('common.cancel')}
          </button>
          <button className="button" type="button" disabled={isWorking} onClick={() => onPick('file')}>
            <File aria-hidden="true" size={18} strokeWidth={2} />
            {t('preview.chooseFile')}
          </button>
          {canPreviewDirectoryContent() ? (
            <button className="button" type="button" disabled={isWorking} onClick={() => onPick('directory')}>
              <Folder aria-hidden="true" size={18} strokeWidth={2} />
              {t('preview.chooseFolder')}
            </button>
          ) : null}
        </div>
      </section>
    </ModalDialog>
  );
}

/**
 * Home's temporary local-content preview is intentionally separate from QDN
 * browsing. Explore owns resource lists; this launcher stays native until an
 * app-facing, consented preview bridge can replace it.
 */
export function QdnPreviewLauncher({ onNavigate }: { onNavigate: (route: QdnRoute) => void }) {
  const [previewDialog, setPreviewDialog] = useState<PreviewDialogState>(null);

  async function handlePreviewPick(kind: 'directory' | 'file') {
    setPreviewDialog({ isWorking: true });

    try {
      const result = await window.qortiumHome.qdn.previewContent({ kind });

      if (result.canceled) {
        setPreviewDialog({ isWorking: false });
        return;
      }

      if (!isQdnService(result.service)) {
        throw new Error(t('preview.failed'));
      }

      setPreviewDialog(null);
      onNavigate(
        buildQdnPreviewRoute({
          renderUrl: result.renderUrl,
          service: result.service,
          sourceKind: result.sourceKind,
          sourceName: result.sourceName,
          sourcePath: result.sourcePath,
          sourceToken: result.sourceToken,
        }),
      );
    } catch (error) {
      setPreviewDialog({
        isWorking: false,
        error: formatError(error),
      });
    }
  }

  return (
    <section className="qdn-preview-launcher" aria-label={t('preview.ariaLabel')}>
      <header className="qdn-preview-launcher__header">
        <div className="qdn-preview-launcher__heading">
          <h2>{t('preview.dialogTitle')}</h2>
          <p>{t('preview.dialogIntro')}</p>
        </div>
        <button
          className="button button--secondary qdn-preview-launcher__preview"
          type="button"
          onClick={() => setPreviewDialog({ isWorking: false })}
        >
          <Eye aria-hidden="true" size={18} strokeWidth={2} />
          {t('explorer.previewButton')}
        </button>
      </header>

      {previewDialog ? (
        <QdnPreviewDialog
          errorMessage={previewDialog.error}
          isWorking={previewDialog.isWorking}
          onDismiss={() => setPreviewDialog(null)}
          onPick={(kind) => void handlePreviewPick(kind)}
        />
      ) : null}
    </section>
  );
}
