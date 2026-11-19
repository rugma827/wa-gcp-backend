import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

/**
 * Sign in and return { idToken, accessToken, refreshToken }
 * idToken is the Firebase ID token — sent as Bearer to the GCP backend.
 * accessToken mirrors idToken so authCookies.getCognitoToken() still works.
 */
export async function signInWithFirebase(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const idToken = await cred.user.getIdToken();
  return {
    accessToken: idToken,   // stored in access_token cookie → getCognitoToken()
    idToken,
    refreshToken: cred.user.refreshToken,
  };
}

export async function signUpWithFirebase(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function sendFirebasePasswordReset(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function signOutFirebase() {
  await signOut(auth);
}

/** Refresh the Firebase ID token using the current user. Returns new idToken or null. */
export async function refreshFirebaseToken() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const idToken = await user.getIdToken(/* forceRefresh */ true);
    return { accessToken: idToken, idToken };
  } catch {
    return null;
  }
}

export { auth };
