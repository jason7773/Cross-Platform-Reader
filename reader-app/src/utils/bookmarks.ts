import { ReaderBookmark } from "@/types";

const BOOKMARK_PREFIX = "reader-bookmarks:";

const canUseLocalStorage = () => typeof window !== "undefined" && "localStorage" in window;

const getBookmarkKey = (bookId: string) => `${BOOKMARK_PREFIX}${bookId}`;

export const getBookmarks = (bookId: string) => {
    if (!canUseLocalStorage()) return [] as ReaderBookmark[];

    try {
        const raw = localStorage.getItem(getBookmarkKey(bookId));
        return raw ? JSON.parse(raw) as ReaderBookmark[] : [];
    } catch {
        return [];
    }
};

export const saveBookmarks = (bookId: string, bookmarks: ReaderBookmark[]) => {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(getBookmarkKey(bookId), JSON.stringify(bookmarks));
};

export const addBookmark = (bookmark: Omit<ReaderBookmark, "id" | "createdAt">) => {
    const bookmarks = getBookmarks(bookmark.bookId);
    const nextBookmark: ReaderBookmark = {
        ...bookmark,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
    };

    saveBookmarks(bookmark.bookId, [nextBookmark, ...bookmarks]);
    return nextBookmark;
};

export const updateBookmarkNote = (bookId: string, bookmarkId: string, note: string) => {
    const bookmarks = getBookmarks(bookId).map((bookmark) => (
        bookmark.id === bookmarkId ? { ...bookmark, note } : bookmark
    ));

    saveBookmarks(bookId, bookmarks);
    return bookmarks;
};

export const deleteBookmark = (bookId: string, bookmarkId: string) => {
    const bookmarks = getBookmarks(bookId).filter((bookmark) => bookmark.id !== bookmarkId);
    saveBookmarks(bookId, bookmarks);
    return bookmarks;
};
