import { BOOK_CACHE_NAME, getBookCacheUrlPrefix } from "@/utils/bookCache";
import { clearLocalBookmarks } from "@/utils/bookmarks";
import { clearCachedBookMetadata } from "@/utils/bookMetadataCache";
import { clearLocalHighlights } from "@/utils/highlights";
import { clearLocalProgress } from "@/utils/readingProgress";
import { deleteCacheByPrefix, removeLocalStorageByPrefixes } from "@/utils/userScopedStorage";

const EPUB_SETTINGS_PREFIX = "reader-settings:epub:";
const PDF_SETTINGS_PREFIX = "reader-settings:pdf:";

export const clearUserLocalData = async (userId: string) => {
    clearCachedBookMetadata(userId);
    clearLocalProgress(userId);
    clearLocalBookmarks(userId);
    clearLocalHighlights(userId);
    removeLocalStorageByPrefixes([
        `${EPUB_SETTINGS_PREFIX}${userId}`,
        `${PDF_SETTINGS_PREFIX}${userId}`,
    ]);
    await deleteCacheByPrefix(BOOK_CACHE_NAME, getBookCacheUrlPrefix(userId));
};

export const removeUserOfflineBooks = async (userId: string) => {
    await deleteCacheByPrefix(BOOK_CACHE_NAME, getBookCacheUrlPrefix(userId));
};

export const getUserOfflineBookCount = async (userId: string) => {
    if (typeof window === "undefined" || !("caches" in window)) return 0;

    const cache = await caches.open(BOOK_CACHE_NAME);
    const prefix = getBookCacheUrlPrefix(userId);
    const requests = await cache.keys();
    return requests.filter((request) => request.url.startsWith(prefix)).length;
};
