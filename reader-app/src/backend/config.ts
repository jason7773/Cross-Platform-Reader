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

const firebaseEnvironmentFields = {
    apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
    authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
} as const;

const publicEnv = (key: string) => process.env[key]?.trim() || "";

export const getReaderBackend = (): ReaderBackend => {
    const value = publicEnv("NEXT_PUBLIC_READER_BACKEND") || "firebase";
    if (value === "firebase" || value === "local") return value;

    throw new BackendConfigurationError(
        `NEXT_PUBLIC_READER_BACKEND must be "firebase" or "local"; received "${value}".`
    );
};

export const getFirebasePublicConfig = (): FirebasePublicConfig => {
    const config = Object.fromEntries(
        Object.entries(firebaseEnvironmentFields).map(([field, environmentName]) => [field, publicEnv(environmentName)])
    ) as FirebasePublicConfig;
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
