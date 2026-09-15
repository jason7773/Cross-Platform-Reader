export type ReaderBackend = "firebase" | "local";

export class BackendConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BackendConfigurationError";
    }
}

export type FirebasePublicConfig = {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
};

// Next only substitutes public environment variables when each property access
// is statically visible during the client build. Do not replace these reads
// with process.env[name].
const firebaseEnvironmentFields = {
    apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
    authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
} as const;

const publicFirebaseEnvironment = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() || "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() || "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() || "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() || "",
} satisfies FirebasePublicConfig;

const readerBackendEnvironment = process.env.NEXT_PUBLIC_READER_BACKEND?.trim() || process.env.READER_BACKEND?.trim() || "";
const serverBackendEnvironment = process.env.READER_BACKEND?.trim() || "";

export const getReaderBackend = (): ReaderBackend => {
    const value = readerBackendEnvironment || "firebase";
    if (serverBackendEnvironment && readerBackendEnvironment && serverBackendEnvironment !== readerBackendEnvironment) {
        throw new BackendConfigurationError("READER_BACKEND and NEXT_PUBLIC_READER_BACKEND must match.");
    }
    if (value === "firebase" || value === "local") return value;

    throw new BackendConfigurationError(
        `NEXT_PUBLIC_READER_BACKEND must be "firebase" or "local"; received "${value}".`
    );
};

export const getFirebasePublicConfig = (): FirebasePublicConfig => {
    const config = publicFirebaseEnvironment;
    const missing = Object.entries(config)
        .filter(([, value]) => !value)
        .map(([field]) => firebaseEnvironmentFields[field as keyof typeof firebaseEnvironmentFields]);

    if (missing.length > 0) {
        throw new BackendConfigurationError(
            `Firebase backend is not configured. Set ${missing.join(", ")} or select NEXT_PUBLIC_READER_BACKEND=local.`
        );
    }

    return config;
};

/** Throws for an invalid selected backend and incomplete Firebase configuration. */
export const validateBackendConfiguration = () => {
    const backend = getReaderBackend();
    if (backend === "firebase") getFirebasePublicConfig();
    return backend;
};
