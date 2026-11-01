import {
  getRedirectResult,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
} from 'firebase/auth';
import { auth, googleProvider, usingEmulators } from './firebase';

/** True when running from the home screen (installed PWA) rather than a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Google sign-in. Installed apps use a full-page redirect, because popups are unreliable in
 * iOS home-screen apps. Browser tabs use a popup and fall back to redirect if it's blocked.
 */
export async function signInWithGoogle(): Promise<void> {
  if (isStandalone()) {
    await signInWithRedirect(auth, googleProvider);
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    throw e;
  }
}

/** Surfaces errors from a redirect sign-in that just finished. */
export function finishRedirectSignIn(): Promise<unknown> {
  return getRedirectResult(auth);
}

export function signOut(): Promise<void> {
  return fbSignOut(auth);
}

/**
 * Local-emulator-only sign-in with a fake Google account. The auth emulator accepts unsigned
 * test credentials, so this works offline and without Google's sign-in scripts.
 */
export async function signInAsTestUser(email: string, name: string): Promise<void> {
  if (!usingEmulators) throw new Error('Test sign-in only works with the local emulators.');
  const sub = email.toLowerCase().replace(/[^a-z0-9]/g, '');
  const credential = GoogleAuthProvider.credential(
    JSON.stringify({ sub, email, name, email_verified: true }),
  );
  await signInWithCredential(auth, credential);
}
