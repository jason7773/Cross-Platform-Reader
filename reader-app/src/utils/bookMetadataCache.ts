import { Book } from "@/types";

const BOOK_METADATA_PREFIX = "reader-book-metadata:";

const canUseLocalStorage = () => typeof window !== "undefined" && "localStorage" in window;

const getBookKey = (bookId: string) => `${BOOK_METADATA_PREFIX}${bookId}`;

export const cacheBookMetadata = (book: Book) => {
    if (!canUseLocalStorage()) return;

    try {
        localStorage.setItem(getBookKey(book.id), JSON.stringify(book));
    } catch (err) {
        console.warn("Could not cache book metadata:", err);
    }
};

export const getCachedBookMetadata = (bookId: string) => {
    if (!canUseLocalStorage()) return null;

    try {
        const value = localStorage.getItem(getBookKey(bookId));
        return value ? JSON.parse(value) as Book : null;
    } catch (err) {
        console.warn("Could not read cached book metadata:", err);
        return null;
    }
};

export const deleteCachedBookMetadata = (bookId: string) => {
    if (!canUseLocalStorage()) return;

    try {
        localStorage.removeItem(getBookKey(bookId));
    } catch (err) {
        console.warn("Could not delete cached book metadata:", err);
    }
};
