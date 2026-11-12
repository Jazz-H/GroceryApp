import { useState } from 'react';
import { createVoiceKey, deviceLabel, removeVoiceKey, useVoiceKeys } from '../data/voice';
import { relayUrl } from '../push';
import type { Household } from '../types';

/** Settings card: voice keys for "Hey Siri, Stocked", with step-by-step Shortcut setup. */
export function VoiceAdd({ household, uid }: { household: Household; uid: string }) {
  const relay = relayUrl();
  const keys = useVoiceKeys(household.id);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const endpoint = `${relay}/add`;

  async function make() {
    setBusy(true);
    setError(null);
    try {
      setNewKey(await createVoiceKey(household.id, uid, deviceLabel()));
    } catch {
      setError('Couldn’t make a key. Check your connection and try again.');
    }
    setBusy(false);
  }

  async function copy(what: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2500);
    } catch {
      setError('Couldn’t copy. Press and hold the text to copy it instead.');
    }
  }

  return (
    <div className="card voice-add">
      <h2>Add by voice</h2>
      <p className="muted">
        Say “Hey Siri, Stocked”, then what you need: “milk, eggs and two avocados”. The items go on
        the Grocery list as added by you. Anything already on the list is skipped, and Siri tells
        you which.
      </p>

      {!relay ? (
        <p className="hint">
          This copy of the app was built without the relay, so voice add is off.
        </p>
      ) : newKey ? (
        <div className="voice-setup">
          <p>
            <b>Your voice key.</b> It’s shown only now. Keep it in your Shortcut and nowhere else:
            anyone with it can add to your list.
          </p>
          <div className="copy-row">
            <input
              readOnly
              value={newKey}
              aria-label="Voice key"
              onFocus={(e) => e.target.select()}
            />
            <button className="btn ghost small" onClick={() => copy('key', newKey)}>
              {copied === 'key' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="copy-row">
            <input
              readOnly
              value={endpoint}
              aria-label="Address for the Shortcut"
              onFocus={(e) => e.target.select()}
            />
            <button className="btn ghost small" onClick={() => copy('url', endpoint)}>
              {copied === 'url' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <h3 className="label">iPhone: make the Shortcut</h3>
          <ol className="steps">
            <li>
              Open the <b>Shortcuts</b> app, tap <b>+</b>, and name the shortcut <b>Stocked</b>.
              That name is what you say to Siri.
            </li>
            <li>
              Add the action <b>Dictate Text</b>.
            </li>
            <li>
              Add <b>Get Contents of URL</b> and paste the address above. Tap the arrow to show
              more: set <b>Method</b> to <b>POST</b> and <b>Request Body</b> to <b>JSON</b>.
            </li>
            <li>
              Add two <b>Text</b> fields: <code>key</code> with your voice key pasted in, and{' '}
              <code>text</code> set to <b>Dictated Text</b>.
            </li>
            <li>
              Add <b>Speak Text</b> (it speaks the <b>Contents of URL</b>), so Siri tells you what
              was added.
            </li>
            <li>Try it: “Hey Siri, Stocked” … “bananas and coffee”.</li>
          </ol>

          <h3 className="label">Android</h3>
          <p className="hint">
            Google Assistant can’t send to an address on its own. The free <b>HTTP Shortcuts</b> app
            can: make a shortcut that asks for text, sends a POST with the same JSON (
            <code>key</code> and <code>text</code>) to the address above, and shows the response.
            Then say “Hey Google, open Stocked add” (or whatever you name it).
          </p>

          <div className="row-actions">
            <button className="btn primary" onClick={() => setNewKey(null)}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="row-actions">
          <button className="btn primary" onClick={make} disabled={busy}>
            {busy ? 'Making a key…' : 'Set up on this phone'}
          </button>
        </div>
      )}

      {keys.length > 0 && (
        <>
          <h3 className="label">Voice keys</h3>
          <ul className="voice-keys">
            {keys.map((k) => (
              <li key={k.hash}>
                <span>
                  {k.label}
                  <span className="hint">
                    {' '}
                    ·{' '}
                    {k.uid === uid
                      ? 'yours'
                      : (household.members[k.uid]?.name ?? 'former member')}{' '}
                    · made{' '}
                    {new Date(k.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </span>
                {confirm === k.hash ? (
                  <span className="row-actions">
                    <button className="btn ghost small" onClick={() => setConfirm(null)}>
                      Keep
                    </button>
                    <button
                      className="btn danger small"
                      onClick={async () => {
                        setConfirm(null);
                        try {
                          await removeVoiceKey(household.id, k.hash);
                        } catch {
                          setError('Couldn’t remove it. Check your connection and try again.');
                        }
                      }}
                    >
                      Remove
                    </button>
                  </span>
                ) : (
                  <button className="btn link danger-text" onClick={() => setConfirm(k.hash)}>
                    Remove…
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="hint">Removing a key stops its Shortcut right away.</p>
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
