import { User } from "firebase/auth";
import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/config";
import { ReaderHighlight } from "@/types";
import { removeLocalStorageByPrefixes } from "@/utils/userScopedStorage";

const HIGHLIGHT_PREFIX = "reader-highlights:";

const canUseLocalStorage = () => typeof window !== "undefined" && "localStorage" in window;
const getHighlightKey = (userId: string, bookId: string) => `${HIGHLIGHT_PREFIX}${userId}:${bookId}`;
const getHighlightDocId = (userId: string, highlightId: string) => `${userId}_${highlightId}`;

const readLocalHighlights = (userId: string, bookId: string) => {
    if (!canUseLocalStorage()) return [] as ReaderHighlight[];

    try {
        const raw = localStorage.getItem(getHighlightKey(userId, bookId));
        return raw ? JSON.parse(raw) as ReaderHighlight[] : [];
    } catch {
        return [];
    }
};

const saveLocalHighlights = (userId: string, bookId: string, highlights: ReaderHighlight[]) => {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(getHighlightKey(userId, bookId), JSON.stringify(highlights));
};

export const loadHighlights = async (user: User | null | undefined, bookId: string) => {
    if (!user) return [] as ReaderHighlight[];

    try {
        const snapshot = await getDocs(query(
            collection(db, "highlights"),
            where("userId", "==", user.uid),
            where("bookId", "==", bookId)
        ));
        const highlights = snapshot.docs
            .map((highlightDoc) => ({ id: highlightDoc.id.replace(`${user.uid}_`, ""), ...highlightDoc.data() }) as ReaderHighlight)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        saveLocalHighlights(user.uid, bookId, highlights);
        return highlights;
    } catch (err) {
        console.warn("Could not load remote highlights, using local copy:", err);
        return readLocalHighlights(user.uid, bookId);
    }
};

export const addHighlight = async (user: User | null | undefined, highlight: Omit<ReaderHighlight, "id" | "createdAt" | "userId" | "updatedAt">) => {
    if (!user) throw new Error("Sign in before adding highlights.");

    const highlights = readLocalHighlights(user.uid, highlight.bookId);
    const nextHighlight: ReaderHighlight = {
        ...highlight,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: user.uid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    const nextHighlights = [nextHighlight, ...highlights];

    saveLocalHighlights(user.uid, highlight.bookId, nextHighlights);
    await setDoc(doc(db, "highlights", getHighlightDocId(user.uid, nextHighlight.id)), nextHighlight, { merge: true });
    return nextHighlight;
};

export const deleteHighlight = async (user: User | null | undefined, bookId: string, highlightId: string) => {
    if (!user) return [] as ReaderHighlight[];

    const highlights = readLocalHighlights(user.uid, bookId).filter((highlight) => highlight.id !== highlightId);
    saveLocalHighlights(user.uid, bookId, highlights);
    await deleteDoc(doc(db, "highlights", getHighlightDocId(user.uid, highlightId)));
    return highlights;
};

export const clearLocalHighlights = (userId: string) => {
    removeLocalStorageByPrefixes([`${HIGHLIGHT_PREFIX}${userId}:`]);
};
