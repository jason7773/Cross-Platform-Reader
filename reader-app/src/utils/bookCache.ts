export const BOOK_CACHE_NAME = "reader-book-files-v2";

type BookCacheSource = "cache" | "network";

type CachedBookBlob = {
    blob: Blob;
    source: BookCacheSource;
};

const supportsCacheStorage = () => typeof window !== "undefined" && "caches" in window;

const createRequest = (userId: string, cacheKey: string) => new Request(
    `https://reader.local/cache/${encodeURIComponent(userId)}/${encodeURIComponent(cacheKey)}`,
    {
        mode: "same-origin",
    }
);

export const getBookCacheUrlPrefix = (userId: string) => (
    `https://reader.local/cache/${encodeURIComponent(userId)}/`
);

const createFetchRequest = (url: string) => new Request(url, {
    mode: "cors",
    credentials: "omit",
});

const fetchBook = async (url: string) => {
    const response = await fetch(createFetchRequest(url), { cache: "force-cache" });

    if (!response.ok) {
        throw new Error(`Failed to fetch book file: ${response.status}`);
    }

    return response;
};

export const getCachedBookBlob = async (userId: string, cacheKey: string, url: string): Promise<CachedBookBlob> => {
    if (!supportsCacheStorage()) {
        const response = await fetchBook(url);
        return { blob: await response.blob(), source: "network" };
    }

    const cache = await caches.open(BOOK_CACHE_NAME);
    const request = createRequest(userId, cacheKey);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
        return { blob: await cachedResponse.blob(), source: "cache" };
    }

    const response = await fetchBook(url);

    try {
        await cache.put(request, response.clone());
    } catch (err) {
        console.warn("Could not write book file to local cache:", err);
    }

    return { blob: await response.blob(), source: "network" };
};

export const cacheUploadedBook = async (userId: string, cacheKey: string, blob: Blob, contentType?: string) => {
    if (!supportsCacheStorage()) return;

    const cache = await caches.open(BOOK_CACHE_NAME);
    const headers = new Headers();

    if (contentType || blob.type) {
        headers.set("Content-Type", contentType || blob.type);
    }

    await cache.put(createRequest(userId, cacheKey), new Response(blob, { headers }));
};

export const cacheBookFromUrl = async (userId: string, cacheKey: string, url: string) => {
    const { blob } = await getCachedBookBlob(userId, cacheKey, url);
    return blob;
};

export const isBookCached = async (userId?: string, cacheKey?: string) => {
    if (!userId || !cacheKey || !supportsCacheStorage()) return false;

    const cache = await caches.open(BOOK_CACHE_NAME);
    return Boolean(await cache.match(createRequest(userId, cacheKey)));
};

export const deleteCachedBook = async (userId?: string, cacheKey?: string) => {
    if (!userId || !cacheKey || !supportsCacheStorage()) return;

    const cache = await caches.open(BOOK_CACHE_NAME);
    await cache.delete(createRequest(userId, cacheKey));
};
