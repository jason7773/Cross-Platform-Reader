import { initializeApp, getApps, getApp } from "firebase/app";
import type { FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import type { Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";

const firebaseEnvironment = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() || "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() || "",
};

export const readerBackend = process.env.NEXT_PUBLIC_READER_BACKEND?.trim() || "firebase";
export const firebaseEnabled = readerBackend === "firebase";
const missingFirebaseEnvironment = Object.entries(firebaseEnvironment)
    .filter(([, value]) => !value)
    .map(([field]) => `NEXT_PUBLIC_FIREBASE_${field === "apiKey" ? "API_KEY" : field === "authDomain" ? "AUTH_DOMAIN" : field === "projectId" ? "PROJECT_ID" : field === "storageBucket" ? "STORAGE_BUCKET" : field === "messagingSenderId" ? "MESSAGING_SENDER_ID" : "APP_ID"}`);

export const firebaseConfigError = firebaseEnabled && missingFirebaseEnvironment.length
    ? `Firebase is not configured. Set ${missingFirebaseEnvironment.join(", ")} before running this deployment.`
    : null;

export const assertFirebaseConfigured = () => {
    if (firebaseConfigError) throw new Error(firebaseConfigError);
};

const firebaseConfig: FirebaseOptions = {
    ...firebaseEnvironment,
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
