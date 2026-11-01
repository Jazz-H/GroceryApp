/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_USE_EMULATORS?: string;
  readonly VITE_PUSH_URL?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_GEMINI_MODEL?: string;
}
