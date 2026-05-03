import { doc, setDoc } from "firebase/firestore";
import { User } from "firebase/auth";
import { db } from "@/firebase/config";
import { ReadingProgress } from "@/types";

const LOCAL_PROGRESS_PREFIX = "reader-progress:";
const PENDING_PROGRESS_KEY = "reader-pending-progress";

const canUseLocalStorage = () => typeof window !== "undefined" && "localStorage" in window;

const getLocalProgressKey = (userId: string, bookId: string) => `${LOCAL_PROGRESS_PREFIX}${userId}:${bookId}`;

const readPendingProgress = () => {
    if (!canUseLocalStorage()) return [] as ReadingProgress[];

    try {
        const raw = localStorage.getItem(PENDING_PROGRESS_KEY);
        return raw ? JSON.parse(raw) as ReadingProgress[] : [];
    } catch {
        return [];
    }
};

const writePendingProgress = (items: ReadingProgress[]) => {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(PENDING_PROGRESS_KEY, JSON.stringify(items));
};

export const cacheLocalProgress = (progress: ReadingProgress) => {
    if (!canUseLocalStorage()) return;

    localStorage.setItem(getLocalProgressKey(progress.userId, progress.bookId), JSON.stringify(progress));
};

export const getLocalProgress = (userId: string, bookId: string) => {
    if (!canUseLocalStorage()) return null;

    try {
        const raw = localStorage.getItem(getLocalProgressKey(userId, bookId));
        return raw ? JSON.parse(raw) as ReadingProgress : null;
    } catch {
        return null;
    }
};

export const getAllLocalProgress = (userId: string) => {
    if (!canUseLocalStorage()) return [] as ReadingProgress[];

    const items: ReadingProgress[] = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(`${LOCAL_PROGRESS_PREFIX}${userId}:`)) continue;

        try {
            const raw = localStorage.getItem(key);
            if (raw) items.push(JSON.parse(raw) as ReadingProgress);
        } catch {
            // Ignore malformed local progress records.
        }
    }

    return items;
};

const queuePendingProgress = (progress: ReadingProgress) => {
    const items = readPendingProgress();
    const nextItems = [
        ...items.filter((item) => !(item.userId === progress.userId && item.bookId === progress.bookId)),
        progress,
    ];

    writePendingProgress(nextItems);
};

export const saveReadingProgress = async (user: User | null | undefined, progress: Omit<ReadingProgress, "userId">) => {
    if (!user) return;

    const nextProgress: ReadingProgress = {
        ...progress,
        userId: user.uid,
    };

    cacheLocalProgress(nextProgress);

    try {
        await setDoc(doc(db, "progress", `${user.uid}_${progress.bookId}`), nextProgress, { merge: true });
    } catch (err) {
        console.warn("Progress saved locally and will sync later:", err);
        queuePendingProgress(nextProgress);
    }
};

export const syncPendingProgress = async (user: User | null | undefined) => {
    if (!user) return;

    const items = readPendingProgress();
    const ownItems = items.filter((item) => item.userId === user.uid);
    const otherItems = items.filter((item) => item.userId !== user.uid);
    const failedItems: ReadingProgress[] = [];

    for (const item of ownItems) {
        try {
            await setDoc(doc(db, "progress", `${item.userId}_${item.bookId}`), item, { merge: true });
        } catch (err) {
            console.warn("Pending progress sync failed:", err);
            failedItems.push(item);
        }
    }

    writePendingProgress([...otherItems, ...failedItems]);
};

export const hasPendingProgress = (userId: string) => readPendingProgress().some((item) => item.userId === userId);
