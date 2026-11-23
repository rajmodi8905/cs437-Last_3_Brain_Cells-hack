import { useEffect, useRef, useState } from 'react';
import { plainMessage } from '../../src/app/plainError';
import { ApiFailure } from '../client/api';
import type { getAutoSync } from '../client/autosync';
import type { PairingProgress } from '../client/sync';

type Controller = ReturnType<typeof getAutoSync>;
type Pairing = PairingProgress & {
  /** `new`: this device asked for the key; `old`: this device sends it. */
  role: 'new' | 'old';
  /** New device: the code to type on the other device. */
  code?: string;
  /** New device: the student said the numbers match; it now waits for the key. */
  confirmed?: boolean;
};

const POLL_MS = 2000;
const group = (text: string, size: number) => text.match(new RegExp(`.{1,${size}}`, 'g'))!;
const pairingCode = (code: string) => group(code, 4).join('-');
const checkNumber = (number: string) => group(number, 3).join(' ');
const lastGroup = (code: string) => code.split('-').at(-1) ?? '';

/** Pairing failures in words about pairing, not about items. */
function pairingMessage(cause: unknown) {
  if (cause instanceof ApiFailure && cause.code === 'NOT_FOUND')
    return 'That pairing code is not valid or has expired. Check it, or start again on the new device.';
  if (cause instanceof ApiFailure && cause.code === 'INVALID_INPUT')
    return 'Pairing could not continue. Start again on the new device.';
  return plainMessage(cause);
}

/**
 * End-to-end encryption in Settings (docs/pilot/e2ee-design.md): turn it on with a recovery
 * code, unlock this device with the code, or pass the key between devices by pairing.
 */
export function EncryptionPanel({
  controller,
  encryption,
  notify,
}: {
  controller: Controller;
  encryption: { on: boolean; unlocked: boolean };
  notify: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [setupCode, setSetupCode] = useState<string>();
  const [typedGroup, setTypedGroup] = useState('');
  const [shownCode, setShownCode] = useState<string>();
  const [recoveryInput, setRecoveryInput] = useState('');
  const [addingDevice, setAddingDevice] = useState(false);
  const [pairingInput, setPairingInput] = useState('');
  const [pairing, setPairing] = useState<Pairing>();
  const polling = useRef(false);

  const act =
    (work: () => Promise<unknown>, message = plainMessage) =>
    async () => {
      setBusy(true);
      setError('');
      try {
        await work();
      } catch (cause) {
        setError(message(cause));
      } finally {
        setBusy(false);
      }
    };

  // Waits for the other device: for its key, or, once confirmed here, for the sealed secret.
  const waiting =
    pairing &&
    (pairing.stage === 'waiting' ||
      (pairing.stage === 'compare' && pairing.role === 'new' && pairing.confirmed));
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const next = await controller.pairingStep();
        setPairing((current) => current && { ...current, ...next });
        if (next.stage === 'done')
          notify('This device has the key. Your cloud library syncs here now.');
      } catch (cause) {
        setPairing(undefined);
        setError(pairingMessage(cause));
      } finally {
        polling.current = false;
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [controller, notify, pairing, waiting]);

  // Leaving Settings ends a pairing: its keys live only in this page.
  useEffect(() => () => void controller.cancelPairing(), [controller]);

  const stopPairing = (message?: string) =>
    act(async () => {
      setPairing(undefined);
      setAddingDevice(false);
      await controller.cancelPairing();
      if (message) setError(message);
    });
  const differ = stopPairing(
    'Pairing stopped. Different numbers can mean someone interfered with the connection. Start again.',
  );

  const comparing = pairing?.stage === 'compare' && (
    <div className="notice" role="status">
      <span>
        Check that the {pairing.role === 'new' ? 'other' : 'new'} device shows{' '}
        <strong className="check-number">{checkNumber(pairing.checkNumber)}</strong>.
        {pairing.confirmed ? ' Waiting for the other device to send the key…' : ''}
      </span>
      {!pairing.confirmed && (
        <div className="button-row">
          <button
            className="button primary"
            disabled={busy}
            onClick={act(async () => {
              const next = await controller.confirmPairing();
              if (pairing.role === 'old') {
                setPairing(undefined);
                setAddingDevice(false);
                notify('Key sent. The new device opens your cloud library once it confirms too.');
              } else {
                setPairing({ ...pairing, ...next, confirmed: true });
                if (next.stage === 'done')
                  notify('This device has the key. Your cloud library syncs here now.');
              }
            }, pairingMessage)}
          >
            The numbers match
          </button>
          <button className="button secondary" disabled={busy} onClick={differ}>
            They differ
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="encryption-panel">
      <h3>End-to-end encryption</h3>

      {!encryption.on && !setupCode && (
        <>
          <p>
            Off. Cloud copies are encrypted in storage, but the pilot service can read them. Turn
            this on to encrypt originals, titles and search data on your devices before they are
            uploaded.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={act(async () => setSetupCode(await controller.prepareEncryption()))}
          >
            Turn on end-to-end encryption
          </button>
        </>
      )}

      {!encryption.on && setupCode && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await controller.turnOnEncryption();
              setSetupCode(undefined);
              setTypedGroup('');
              notify('End-to-end encryption is on. New items are encrypted before upload.');
            })();
          }}
        >
          <p>
            This is your recovery code. Write it down and keep it somewhere safe. A new device needs
            it, or a device that already has the key, to open your cloud library. If you lose the
            code and every device, nobody can recover your cloud library, including the pilot team.
          </p>
          <p>
            Recovery code: <strong className="recovery-code">{setupCode}</strong>
          </p>
          <p className="field-help">
            Items already in your cloud library are encrypted on the next sync, and their readable
            copies are deleted. Copies in the service&apos;s backups can remain for up to 14 days.
            Items you send to the Telegram bot stay readable by the pilot service, because the bot
            has to read them.
          </p>
          <label>
            Type the last group of the code to confirm you saved it
            <input
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={typedGroup}
              onChange={(e) => setTypedGroup(e.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy || typedGroup.trim().toUpperCase() !== lastGroup(setupCode)}
            >
              Turn on encryption
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setSetupCode(undefined);
                setTypedGroup('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {encryption.on && encryption.unlocked && (
        <>
          <p>
            On. Originals, titles and search data are encrypted on your devices before they are
            uploaded. Items you send to the Telegram bot stay readable by the pilot service.
          </p>
          {shownCode && (
            <p>
              Recovery code: <strong className="recovery-code">{shownCode}</strong>
            </p>
          )}
          {!addingDevice && (
            <div className="button-row">
              <button
                className="button secondary"
                disabled={busy}
                onClick={act(async () =>
                  setShownCode(shownCode ? undefined : await controller.recoveryCode()),
                )}
              >
                {shownCode ? 'Hide recovery code' : 'Show recovery code'}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setError('');
                  setAddingDevice(true);
                }}
              >
                Add a device
              </button>
            </div>
          )}
          {addingDevice && !pairing && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const next = await controller.claimPairing(pairingInput);
                  setPairing({ ...next, role: 'old' });
                  setPairingInput('');
                }, pairingMessage)();
              }}
            >
              <p>
                On the new device, sign in and choose Pair with another device. Then type the code
                it shows.
              </p>
              <label>
                Pairing code from the new device
                <input
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={pairingInput}
                  onChange={(e) => setPairingInput(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button className="button primary" disabled={busy || !pairingInput.trim()}>
                  Continue
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setAddingDevice(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {pairing?.role === 'old' && pairing.stage === 'waiting' && (
            <p role="status">Waiting for the new device…</p>
          )}
          {pairing?.role === 'old' && comparing}
        </>
      )}

      {encryption.on && !encryption.unlocked && (
        <>
          <p className="notice" role="status">
            Your cloud library is end-to-end encrypted. Enter its recovery code, or pair with a
            device that has the key, to sync on this device. Nothing syncs here until then.
          </p>
          {!pairing && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await controller.unlock(recoveryInput);
                    setRecoveryInput('');
                    notify('Unlocked. Your cloud library syncs on this device now.');
                  })();
                }}
              >
                <label>
                  Recovery code
                  <input
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={recoveryInput}
                    onChange={(e) => setRecoveryInput(e.target.value)}
                  />
                </label>
                <button className="button primary" disabled={busy || !recoveryInput.trim()}>
                  Unlock
                </button>
              </form>
              <button
                className="button secondary"
                disabled={busy}
                onClick={act(async () => {
                  const started = await controller.startPairing();
                  setPairing({ stage: 'waiting', role: 'new', code: started.code });
                }, pairingMessage)}
              >
                Pair with another device
              </button>
            </>
          )}
          {pairing?.role === 'new' && pairing.stage === 'waiting' && (
            <div className="notice" role="status">
              <span>
                On a device that has your library, open Settings, choose Add a device and type this
                code. It works for 10 minutes.
              </span>
              <strong className="recovery-code">{pairingCode(pairing.code ?? '')}</strong>
              <button className="button secondary" disabled={busy} onClick={stopPairing()}>
                Cancel
              </button>
            </div>
          )}
          {pairing?.role === 'new' && comparing}
        </>
      )}

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
