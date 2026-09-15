import { loadBackendServices } from "@/backend";
import { ReaderHighlight, SessionUser } from "@/types";
import { removeLocalStorageByPrefixes } from "@/utils/userScopedStorage";

const HIGHLIGHT_PREFIX = "reader-highlights:";
const canUseLocalStorage = () => typeof window !== "undefined" && "localStorage" in window;
const keyFor = (userId: string, bookId: string) => `${HIGHLIGHT_PREFIX}${userId}:${bookId}`;

const localHighlights = (userId: string, bookId: string): ReaderHighlight[] => {
    if (!canUseLocalStorage()) return [];
    try {
        const raw = localStorage.getItem(keyFor(userId, bookId));
        return raw ? JSON.parse(raw) as ReaderHighlight[] : [];
    } catch {
        return [];
    }
};

const saveLocalHighlights = (userId: string, bookId: string, records: ReaderHighlight[]) => {
    if (canUseLocalStorage()) localStorage.setItem(keyFor(userId, bookId), JSON.stringify(records));
};

export const loadHighlights = async (user: SessionUser | null | undefined, bookId: string) => {
    if (!user) return [] as ReaderHighlight[];
    try {
        const { readerData } = await loadBackendServices();
        const records = (await readerData.listHighlights(user.uid, bookId))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        saveLocalHighlights(user.uid, bookId, records);
        return records;
    } catch (error) {
        console.warn("Could not load highlights, using local copy:", error);
        return localHighlights(user.uid, bookId);
    }
};

export const addHighlight = async (user: SessionUser | null | undefined, highlight: Omit<ReaderHighlight, "id" | "createdAt" | "userId" | "updatedAt">) => {
    if (!user) throw new Error("Sign in before adding highlights.");
    const record: ReaderHighlight = {
        ...highlight,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: user.uid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    const records = [record, ...localHighlights(user.uid, highlight.bookId)];
    saveLocalHighlights(user.uid, highlight.bookId, records);
    try {
        const { readerData } = await loadBackendServices();
        await readerData.saveHighlight(record);
    } catch (error) {
        console.warn("Highlight saved locally and will not sync until the library is reachable:", error);
    }
    return record;
};

export const deleteHighlight = async (user: SessionUser | null | undefined, bookId: string, highlightId: string) => {
    if (!user) return [] as ReaderHighlight[];
    const records = localHighlights(user.uid, bookId).filter((record) => record.id !== highlightId);
    saveLocalHighlights(user.uid, bookId, records);
    try {
        const { readerData } = await loadBackendServices();
        await readerData.removeHighlight(user.uid, bookId, highlightId);
    } catch (error) {
        console.warn("Could not sync highlight deletion:", error);
    }
    return records;
};

export const clearLocalHighlights = (userId: string) => removeLocalStorageByPrefixes([`${HIGHLIGHT_PREFIX}${userId}:`]);
