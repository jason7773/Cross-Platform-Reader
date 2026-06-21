import { User } from "firebase/auth";
import { deleteDoc, doc, getDocs, query, setDoc, where, collection } from "firebase/firestore";
import { db } from "@/firebase/config";
import { ReaderBookmark } from "@/types";
import { removeLocalStorageByPrefixes } from "@/utils/userScopedStorage";

const BOOKMARK_PREFIX = "reader-bookmarks:";

const canUseLocalStorage = () => typeof window !== "undefined" && "localStorage" in window;

const getBookmarkKey = (userId: string, bookId: string) => `${BOOKMARK_PREFIX}${userId}:${bookId}`;
const getBookmarkDocId = (userId: string, bookmarkId: string) => `${userId}_${bookmarkId}`;

const readLocalBookmarks = (userId: string, bookId: string) => {
    if (!canUseLocalStorage()) return [] as ReaderBookmark[];

    try {
        const raw = localStorage.getItem(getBookmarkKey(userId, bookId));
        return raw ? JSON.parse(raw) as ReaderBookmark[] : [];
    } catch {
        return [];
    }
};

const saveLocalBookmarks = (userId: string, bookId: string, bookmarks: ReaderBookmark[]) => {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(getBookmarkKey(userId, bookId), JSON.stringify(bookmarks));
};

export const getBookmarks = (userId: string, bookId: string) => readLocalBookmarks(userId, bookId);

export const loadBookmarks = async (user: User | null | undefined, bookId: string) => {
    if (!user) return [] as ReaderBookmark[];

    try {
        const snapshot = await getDocs(query(
            collection(db, "bookmarks"),
            where("userId", "==", user.uid),
            where("bookId", "==", bookId)
        ));
        const bookmarks = snapshot.docs
            .map((bookmarkDoc) => ({ id: bookmarkDoc.id.replace(`${user.uid}_`, ""), ...bookmarkDoc.data() }) as ReaderBookmark)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        saveLocalBookmarks(user.uid, bookId, bookmarks);
        return bookmarks;
    } catch (err) {
        console.warn("Could not load remote bookmarks, using local copy:", err);
        return readLocalBookmarks(user.uid, bookId);
    }
};

export const addBookmark = async (user: User | null | undefined, bookmark: Omit<ReaderBookmark, "id" | "createdAt" | "userId" | "updatedAt">) => {
    if (!user) throw new Error("Sign in before adding bookmarks.");

    const bookmarks = readLocalBookmarks(user.uid, bookmark.bookId);
    const nextBookmark: ReaderBookmark = {
        ...bookmark,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: user.uid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    const nextBookmarks = [nextBookmark, ...bookmarks];

    saveLocalBookmarks(user.uid, bookmark.bookId, nextBookmarks);
    await setDoc(doc(db, "bookmarks", getBookmarkDocId(user.uid, nextBookmark.id)), nextBookmark, { merge: true });
    return nextBookmark;
};

export const updateBookmarkNote = async (user: User | null | undefined, bookId: string, bookmarkId: string, note: string) => {
    if (!user) return [] as ReaderBookmark[];

    const bookmarks = readLocalBookmarks(user.uid, bookId).map((bookmark) => (
        bookmark.id === bookmarkId ? { ...bookmark, note, updatedAt: Date.now() } : bookmark
    ));
    const bookmark = bookmarks.find((item) => item.id === bookmarkId);

    saveLocalBookmarks(user.uid, bookId, bookmarks);
    if (bookmark) {
        await setDoc(doc(db, "bookmarks", getBookmarkDocId(user.uid, bookmarkId)), bookmark, { merge: true });
    }
    return bookmarks;
};

export const deleteBookmark = async (user: User | null | undefined, bookId: string, bookmarkId: string) => {
    if (!user) return [] as ReaderBookmark[];

    const bookmarks = readLocalBookmarks(user.uid, bookId).filter((bookmark) => bookmark.id !== bookmarkId);
    saveLocalBookmarks(user.uid, bookId, bookmarks);
    await deleteDoc(doc(db, "bookmarks", getBookmarkDocId(user.uid, bookmarkId)));
    return bookmarks;
};

export const clearLocalBookmarks = (userId: string) => {
    removeLocalStorageByPrefixes([`${BOOKMARK_PREFIX}${userId}:`]);
};
