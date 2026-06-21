const canUseLocalStorage = () => typeof window !== "undefined" && "localStorage" in window;
const supportsCacheStorage = () => typeof window !== "undefined" && "caches" in window;

export const userScopedKey = (prefix: string, userId: string, suffix = "") => (
    `${prefix}:${userId}${suffix ? `:${suffix}` : ""}`
);

export const removeLocalStorageByPrefixes = (prefixes: string[]) => {
    if (!canUseLocalStorage()) return;

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
            keysToRemove.push(key);
        }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
};

export const deleteCacheByPrefix = async (cacheName: string, urlPrefix: string) => {
    if (!supportsCacheStorage()) return;

    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    await Promise.all(
        requests
            .filter((request) => request.url.startsWith(urlPrefix))
            .map((request) => cache.delete(request))
    );
};
