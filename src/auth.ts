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

/** iPhone or iPad (iPadOS reports itself as a Mac, so check for touch too). */
export function isIOS(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  );
}

/**
 * Google sign-in.
 *
 * - Installed app on iPhone: full-page redirect. Popups can't report back to iOS home-screen
 *   apps, and the redirect works because the sign-in handler is on the app's own domain.
 * - Everywhere else (including the installed Android app): popup. On Android, a redirect opens
 *   Google in a separate browser layer that loses the sign-in state ("missing initial state").
 *   Falls back to redirect only if the popup is blocked outright.
 */
export async function signInWithGoogle(): Promise<void> {
  if (isStandalone() && isIOS()) {
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
