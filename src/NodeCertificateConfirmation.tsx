import { useCallback, useEffect, useState } from 'react';
import { t } from './i18n';

// Confirming a remote node's certificate by hand.
//
// A node that is not on this machine presents a certificate nothing vouches
// for, so Home cannot decide on its own whether it is the right one. It shows
// the fingerprint it was offered and the command that prints the same
// fingerprint on the node itself; the user compares them and says whether they
// match. Home only trusts the certificate after that, and only that exact one —
// if it changes, this panel says so instead of quietly carrying on.

type NodeCertificateConfirmationProps = {
  nodeApiUrl: string;
  onConfirmed: () => void;
};

function formatError(error: unknown) {
  if (!(error instanceof Error)) {
    return t('node.certificate.confirmFailed');
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function Fingerprint({ label, value }: { label: string; value: string }) {
  return (
    <p className="node-certificate__row">
      <span className="node-certificate__label">{label}</span>
      <code className="node-certificate__fingerprint">{value}</code>
    </p>
  );
}

export function NodeCertificateConfirmation({ nodeApiUrl, onConfirmed }: NodeCertificateConfirmationProps) {
  const [status, setStatus] = useState<QortiumNodeCertificateStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setStatus((await window.qortiumHome.node.getCertificateStatus?.(nodeApiUrl)) ?? null);
    } catch (caught) {
      setStatus(null);
      setError(formatError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [nodeApiUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (isLoading && !status) {
    return <p className="node-certificate__state">{t('node.certificate.loading')}</p>;
  }

  if (!status || !status.confirmationRequired) {
    return error ? <p className="node-connection__message--error">{error}</p> : null;
  }

  const presentedFingerprint = status.presented?.fingerprint ?? null;
  // A confirmed host that is now presenting something else: worth its own,
  // louder state, because it is the case this flow exists to catch.
  const isMismatch =
    !!status.confirmedFingerprint && !!presentedFingerprint && !status.matchesConfirmed;

  async function run(action: () => Promise<QortiumNodeCertificateStatus> | undefined) {
    setIsBusy(true);
    setError(null);
    try {
      setStatus((await action()) ?? null);
      onConfirmed();
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="node-certificate">
      <p className="node-certificate__title">{t('node.certificate.title')}</p>

      {status.confirmedFingerprint ? (
        <Fingerprint label={t('node.certificate.confirmedLabel')} value={status.confirmedFingerprint} />
      ) : null}

      {presentedFingerprint ? (
        <Fingerprint label={t('node.certificate.presentedLabel')} value={presentedFingerprint} />
      ) : null}

      {status.observeError ? (
        <p className="node-connection__message--error">
          {t('node.certificate.unreachable', { host: status.host })}
        </p>
      ) : isMismatch ? (
        <p className="node-connection__message--error">{t('node.certificate.mismatch')}</p>
      ) : status.matchesConfirmed ? (
        <p className="node-certificate__state">{t('node.certificate.confirmed')}</p>
      ) : (
        <p className="node-certificate__state">{t('node.certificate.unconfirmed')}</p>
      )}

      {presentedFingerprint && !status.matchesConfirmed ? (
        <>
          <p className="node-certificate__state">{t('node.certificate.instructions')}</p>
          <code className="node-certificate__command">{status.verifyCommand}</code>
        </>
      ) : null}

      {error ? <p className="node-connection__message--error">{error}</p> : null}

      <div className="node-certificate__actions">
        {presentedFingerprint && !status.matchesConfirmed ? (
          <button
            className="button button--primary button--compact"
            disabled={isBusy}
            type="button"
            onClick={() =>
              void run(() =>
                window.qortiumHome.node.confirmCertificate?.(status.nodeApiUrl, presentedFingerprint),
              )
            }
          >
            {t('node.certificate.confirm')}
          </button>
        ) : null}
        {status.confirmedFingerprint ? (
          <button
            className="button button--compact"
            disabled={isBusy}
            type="button"
            onClick={() => void run(() => window.qortiumHome.node.forgetCertificate?.(status.nodeApiUrl))}
          >
            {t('node.certificate.forget')}
          </button>
        ) : null}
        <button className="button button--compact" disabled={isBusy} type="button" onClick={() => void refresh()}>
          {t('node.certificate.retry')}
        </button>
      </div>
    </div>
  );
}
