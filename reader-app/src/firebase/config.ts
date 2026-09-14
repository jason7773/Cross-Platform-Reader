import { initializeApp, getApps, getApp } from "firebase/app";
import type { FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import type { Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";

const requiredFirebaseEnvironment = [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

export const readerBackend = process.env.NEXT_PUBLIC_READER_BACKEND || "firebase";
export const firebaseEnabled = readerBackend === "firebase";
const missingFirebaseEnvironment = requiredFirebaseEnvironment.filter((name) => !process.env[name]?.trim());

export const firebaseConfigError = firebaseEnabled && missingFirebaseEnvironment.length
    ? `Firebase is not configured. Set ${missingFirebaseEnvironment.join(", ")} before running this deployment.`
    : null;

export const assertFirebaseConfigured = () => {
    if (firebaseConfigError) throw new Error(firebaseConfigError);
};

const firebaseConfig: FirebaseOptions = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Local deployments can import shared UI code without creating a Firebase App.
// Backend-specific adapters must call assertFirebaseConfigured before using these
// exports. The legacy exports remain typed for the Firebase adapter.
const firebaseApp = firebaseEnabled
    ? (!getApps().length ? initializeApp(firebaseConfig) : getApp())
    : undefined;
const auth = (firebaseApp ? getAuth(firebaseApp) : undefined) as Auth;
const db = (firebaseApp ? getFirestore(firebaseApp) : undefined) as Firestore;
const storage = (firebaseApp ? getStorage(firebaseApp) : undefined) as FirebaseStorage;
const googleProvider = (firebaseApp ? new GoogleAuthProvider() : undefined) as GoogleAuthProvider;

export { firebaseApp as app, auth, db, storage, googleProvider };
