// Direct Google sign-in through the pilot's own Firebase project. The Firebase SDK is loaded
// only when the user presses the button, keeps its login in memory, and is signed out as soon
// as the one ID token is read: the pilot's own session cookie is the only login kept.
import type { FirebaseApp, FirebaseOptions } from '@firebase/app';
import type {
  Auth,
  Dependencies,
  Persistence,
  PopupRedirectResolver,
  UserCredential,
} from '@firebase/auth';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
}

/** The parts of the Firebase SDK this flow uses; tests pass a fake. */
export interface FirebaseAuthModule {
  initializeApp(options: FirebaseOptions, name: string): FirebaseApp;
  getApps(): FirebaseApp[];
  initializeAuth(app: FirebaseApp, deps?: Dependencies): Auth;
  inMemoryPersistence: Persistence;
  browserPopupRedirectResolver: PopupRedirectResolver;
  GoogleAuthProvider: new () => {
    setCustomParameters(parameters: Record<string, string>): unknown;
  };
  signInWithPopup(
    auth: Auth,
    provider: never,
    resolver?: PopupRedirectResolver,
  ): Promise<UserCredential>;
  signOut(auth: Auth): Promise<void>;
}

const APP_NAME = 'campus-recall-pilot';
// Only the IITGN account chooser is offered; the server still checks the domain itself.
const HOSTED_DOMAIN = 'iitgn.ac.in';

export async function loadFirebase(): Promise<FirebaseAuthModule> {
  const [app, auth] = await Promise.all([import('@firebase/app'), import('@firebase/auth')]);
  return {
    initializeApp: app.initializeApp,
    getApps: app.getApps,
    initializeAuth: auth.initializeAuth,
    inMemoryPersistence: auth.inMemoryPersistence,
    browserPopupRedirectResolver: auth.browserPopupRedirectResolver,
    GoogleAuthProvider: auth.GoogleAuthProvider,
    signInWithPopup: auth.signInWithPopup as FirebaseAuthModule['signInWithPopup'],
    signOut: auth.signOut,
  };
}

const auths = new WeakMap<FirebaseAuthModule, Auth>();

/** Opens Google's account chooser and returns one Firebase ID token for the pilot API. */
export async function googleIdToken(
  config: FirebaseWebConfig,
  load: () => Promise<FirebaseAuthModule> = loadFirebase,
): Promise<string> {
  const firebase = await load();
  let auth = auths.get(firebase);
  if (!auth) {
    const app =
      firebase.getApps().find((candidate) => candidate.name === APP_NAME) ??
      firebase.initializeApp(config, APP_NAME);
    auth = firebase.initializeAuth(app, {
      persistence: firebase.inMemoryPersistence,
      popupRedirectResolver: firebase.browserPopupRedirectResolver,
    });
    auths.set(firebase, auth);
  }
  const provider = new firebase.GoogleAuthProvider();
  provider.setCustomParameters({ hd: HOSTED_DOMAIN, prompt: 'select_account' });
  try {
    const { user } = await firebase.signInWithPopup(auth, provider as never);
    return await user.getIdToken();
  } finally {
    await firebase.signOut(auth).catch(() => undefined);
  }
}
