import { useState } from 'react';
import { isStandalone, signInAsTestUser, signInWithGoogle } from '../auth';
import { usingEmulators } from '../firebase';

export function SignIn({ error }: { error?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(error ?? null);

  async function go() {
    setBusy(true);
    setMessage(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center-page signin">
      <img className="app-icon" src="/icon-192.png" width="112" height="112" alt="" />
      <h1 className="wordmark">Fridgeboard</h1>
      <p className="muted">The fridge whiteboard, on both your phones.</p>
      <button className="btn primary big" onClick={go} disabled={busy}>
        <GoogleMark /> {busy ? 'Opening Google…' : 'Sign in with Google'}
      </button>
      {message && (
        <p className="error" role="alert">
          Sign-in didn’t finish: {message}
        </p>
      )}
      {usingEmulators && <TestSignIn />}
      {!isStandalone() && <InstallHint />}
    </main>
  );
}

function TestSignIn() {
  const [email, setEmail] = useState('alex@example.com');
  const [name, setName] = useState('Alex');
  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        signInAsTestUser(email, name);
      }}
    >
      <p className="label">Local test account (emulators only)</p>
      <label htmlFor="test-email">
        Email
        <input id="test-email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label htmlFor="test-name">
        Name
        <input id="test-name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button className="btn ghost">Sign in as test user</button>
    </form>
  );
}

function InstallHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <p className="hint">
      {ios
        ? 'Tip: install it first. Tap Share, then “Add to Home Screen”, then sign in from the new icon.'
        : 'Tip: install it from Chrome’s menu (⋮ → Install app) so it opens like a regular app.'}
    </p>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
