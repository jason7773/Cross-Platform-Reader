import { loadBackendServices } from "@/backend";
import { ReaderBookmark, SessionUser } from "@/types";
import { removeLocalStorageByPrefixes } from "@/utils/userScopedStorage";

const BOOKMARK_PREFIX = "reader-bookmarks:";
const canUseLocalStorage = () => typeof window !== "undefined" && "localStorage" in window;
const keyFor = (userId: string, bookId: string) => `${BOOKMARK_PREFIX}${userId}:${bookId}`;

const localBookmarks = (userId: string, bookId: string): ReaderBookmark[] => {
    if (!canUseLocalStorage()) return [];
    try {
        const raw = localStorage.getItem(keyFor(userId, bookId));
        return raw ? JSON.parse(raw) as ReaderBookmark[] : [];
    } catch {
        return [];
    }
};

const saveLocalBookmarks = (userId: string, bookId: string, records: ReaderBookmark[]) => {
    if (canUseLocalStorage()) localStorage.setItem(keyFor(userId, bookId), JSON.stringify(records));
};

export const getBookmarks = localBookmarks;

export const loadBookmarks = async (user: SessionUser | null | undefined, bookId: string) => {
    if (!user) return [] as ReaderBookmark[];
    try {
        const { readerData } = await loadBackendServices();
        const records = (await readerData.listBookmarks(user.uid, bookId))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        saveLocalBookmarks(user.uid, bookId, records);
        return records;
    } catch (error) {
        console.warn("Could not load bookmarks, using local copy:", error);
        return localBookmarks(user.uid, bookId);
    }
};

export const addBookmark = async (user: SessionUser | null | undefined, bookmark: Omit<ReaderBookmark, "id" | "createdAt" | "userId" | "updatedAt">) => {
    if (!user) throw new Error("Sign in before adding bookmarks.");
    const record: ReaderBookmark = {
        ...bookmark,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: user.uid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    const records = [record, ...localBookmarks(user.uid, bookmark.bookId)];
    saveLocalBookmarks(user.uid, bookmark.bookId, records);
    try {
        const { readerData } = await loadBackendServices();
        await readerData.saveBookmark(record);
    } catch (error) {
        console.warn("Bookmark saved locally and will not sync until the library is reachable:", error);
    }
    return record;
};

export const updateBookmarkNote = async (user: SessionUser | null | undefined, bookId: string, bookmarkId: string, note: string) => {
    if (!user) return [] as ReaderBookmark[];
    const records = localBookmarks(user.uid, bookId).map((record) => record.id === bookmarkId
        ? { ...record, note, updatedAt: Date.now() }
        : record);
    saveLocalBookmarks(user.uid, bookId, records);
    const changed = records.find((record) => record.id === bookmarkId);
    if (changed) {
        try {
            const { readerData } = await loadBackendServices();
            await readerData.saveBookmark(changed);
        } catch (error) {
            console.warn("Could not sync bookmark update:", error);
        }
    }
    return records;
};

export const deleteBookmark = async (user: SessionUser | null | undefined, bookId: string, bookmarkId: string) => {
    if (!user) return [] as ReaderBookmark[];
    const records = localBookmarks(user.uid, bookId).filter((record) => record.id !== bookmarkId);
    saveLocalBookmarks(user.uid, bookId, records);
    try {
        const { readerData } = await loadBackendServices();
        await readerData.removeBookmark(user.uid, bookId, bookmarkId);
    } catch (error) {
        console.warn("Could not sync bookmark deletion:", error);
    }
    return records;
};

export const clearLocalBookmarks = (userId: string) => removeLocalStorageByPrefixes([`${BOOKMARK_PREFIX}${userId}:`]);
