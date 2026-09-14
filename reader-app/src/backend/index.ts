import type { ReaderBackendServices } from "@/backend/contracts";
import { getReaderBackend } from "@/backend/config";

export * from "@/backend/contracts";
export * from "@/backend/config";

/** The configured deployment mode. Safe to call before loading any adapter. */
export const getBackend = getReaderBackend;

let services: ReaderBackendServices | null = null;

/**
 * Returns the services for the selected deployment mode. Local mode is wired
 * by the server-backed adapter; keeping selection here prevents UI code from
 * importing a provider SDK directly.
 */
export const loadBackendServices = async (): Promise<ReaderBackendServices> => {
    if (services) return services;

    if (getReaderBackend() === "firebase") {
        // Keep Firebase out of the local deployment bundle's runtime. The
        // module initializes the provider only after Firebase was selected.
        const { createFirebaseBackend } = await import("@/backend/firebase");
        services = createFirebaseBackend();
        return services;
    }

    const { createLocalBackend } = await import("@/backend/local");
    services = createLocalBackend();
    return services;
};
