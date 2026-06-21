import { Book } from "@/types";
import { removeLocalStorageByPrefixes } from "@/utils/userScopedStorage";

const BOOK_METADATA_PREFIX = "reader-book-metadata:";

const canUseLocalStorage = () => typeof window !== "undefined" && "localStorage" in window;

const getBookKey = (userId: string, bookId: string) => `${BOOK_METADATA_PREFIX}${userId}:${bookId}`;

export const cacheBookMetadata = (userId: string, book: Book) => {
    if (!canUseLocalStorage()) return;
    if (book.uploadedBy !== userId) return;

    try {
        localStorage.setItem(getBookKey(userId, book.id), JSON.stringify(book));
    } catch (err) {
        console.warn("Could not cache book metadata:", err);
    }
};

export const getCachedBookMetadata = (userId: string, bookId: string) => {
    if (!canUseLocalStorage()) return null;

    try {
        const value = localStorage.getItem(getBookKey(userId, bookId));
        const book = value ? JSON.parse(value) as Book : null;
        return book?.uploadedBy === userId ? book : null;
    } catch (err) {
        console.warn("Could not read cached book metadata:", err);
        return null;
    }
};

export const deleteCachedBookMetadata = (userId: string, bookId: string) => {
    if (!canUseLocalStorage()) return;

    try {
        localStorage.removeItem(getBookKey(userId, bookId));
    } catch (err) {
        console.warn("Could not delete cached book metadata:", err);
    }
};

export const clearCachedBookMetadata = (userId: string) => {
    removeLocalStorageByPrefixes([`${BOOK_METADATA_PREFIX}${userId}:`]);
};
