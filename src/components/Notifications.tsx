import { useEffect, useState } from 'react';
import {
  disablePush,
  enablePush,
  loadPrefs,
  notify,
  pushSupport,
  setPref,
  type PushKind,
  type PushPrefs,
} from '../push';
import type { Household } from '../types';

const LABELS: Record<PushKind, string> = {
  trip: 'When my partner starts a trip',
  adds: 'When my partner adds groceries',
};

export function Notifications({ household, uid }: { household: Household; uid: string }) {
  const [support, setSupport] = useState(pushSupport);
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadPrefs(household.id)
      .then((p) => alive && setPrefs(p))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [household.id]);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      await enablePush(household.id, uid);
      setPrefs(await loadPrefs(household.id));
    } catch (e) {
      setMessage((e as Error).message);
      setSupport(pushSupport());
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    await disablePush(household.id).catch(() => undefined);
    setPrefs(null);
    setBusy(false);
  }

  async function toggle(kind: PushKind, on: boolean) {
    setPrefs((p) => (p ? { ...p, [kind]: on } : p));
    await setPref(household.id, kind, on);
  }

  async function test() {
    setMessage('Sending…');
    const res = await notify(household.id, {
      kind: 'test',
      title: 'Stocked notifications work',
      body: 'You’ll hear from your partner’s trips and adds here.',
      tag: 'test',
    });
    setMessage(
      res && res.sent > 0
        ? 'Sent. It should appear in a few seconds.'
        : 'The test didn’t go through. Check the relay URL in your settings.',
    );
  }

  return (
    <div className="card">
      <h2>Notifications</h2>
      {support === 'not-configured' && (
        <p className="muted">
          Notifications need the free push relay set up once. See “Notifications” in the README.
        </p>
      )}
      {support === 'needs-install' && (
        <p className="muted">
          On iPhone, notifications only work from the installed app. Tap Share → Add to Home Screen,
          open Stocked from the new icon, then turn this on.
        </p>
      )}
      {support === 'unsupported' && (
        <p className="muted">This browser can’t receive notifications.</p>
      )}
      {support === 'denied' && (
        <p className="muted">
          Notifications are blocked for Stocked. Allow them in your phone’s settings for this app,
          then come back here.
        </p>
      )}
      {support === 'ready' && !loading && !prefs && (
        <>
          <p className="muted">
            Get a heads-up when your partner heads to the store or adds something to the list.
          </p>
          <div className="row-actions">
            <button className="btn primary" onClick={turnOn} disabled={busy}>
              {busy ? 'Turning on…' : 'Turn on notifications'}
            </button>
          </div>
        </>
      )}
      {support === 'ready' && prefs && (
        <>
          <div className="toggles">
            {(Object.keys(LABELS) as PushKind[]).map((kind) => (
              <label key={kind} className="toggle" htmlFor={`pref-${kind}`}>
                <span>{LABELS[kind]}</span>
                <input
                  id={`pref-${kind}`}
                  type="checkbox"
                  role="switch"
                  checked={prefs[kind]}
                  onChange={(e) => toggle(kind, e.target.checked)}
                />
              </label>
            ))}
          </div>
          <div className="row-actions">
            <button className="btn ghost" onClick={test}>
              Send me a test
            </button>
            <button className="btn link danger-text" onClick={turnOff} disabled={busy}>
              Turn off on this phone
            </button>
          </div>
        </>
      )}
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
