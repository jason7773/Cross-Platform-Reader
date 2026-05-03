const BOOK_CACHE_NAME = "reader-book-files-v1";

type BookCacheSource = "cache" | "network";

type CachedBookBlob = {
    blob: Blob;
    source: BookCacheSource;
};

const supportsCacheStorage = () => typeof window !== "undefined" && "caches" in window;

const createRequest = (url: string) => new Request(url, {
    mode: "cors",
    credentials: "omit",
});

const fetchBook = async (url: string) => {
    const response = await fetch(createRequest(url), { cache: "force-cache" });

    if (!response.ok) {
        throw new Error(`Failed to fetch book file: ${response.status}`);
    }

    return response;
};

export const getCachedBookBlob = async (url: string): Promise<CachedBookBlob> => {
    if (!supportsCacheStorage()) {
        const response = await fetchBook(url);
        return { blob: await response.blob(), source: "network" };
    }

    const cache = await caches.open(BOOK_CACHE_NAME);
    const request = createRequest(url);
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

export const cacheUploadedBook = async (url: string, blob: Blob, contentType?: string) => {
    if (!supportsCacheStorage()) return;

    const cache = await caches.open(BOOK_CACHE_NAME);
    const headers = new Headers();

    if (contentType || blob.type) {
        headers.set("Content-Type", contentType || blob.type);
    }

    await cache.put(createRequest(url), new Response(blob, { headers }));
};

export const cacheBookFromUrl = async (url: string) => {
    const { blob } = await getCachedBookBlob(url);
    return blob;
};

export const isBookCached = async (url?: string) => {
    if (!url || !supportsCacheStorage()) return false;

    const cache = await caches.open(BOOK_CACHE_NAME);
    return Boolean(await cache.match(createRequest(url)));
};

export const deleteCachedBook = async (url?: string) => {
    if (!url || !supportsCacheStorage()) return;

    const cache = await caches.open(BOOK_CACHE_NAME);
    await cache.delete(createRequest(url));
};
