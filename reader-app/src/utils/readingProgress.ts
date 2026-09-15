import { loadBackendServices } from "@/backend";
import { ReadingProgress, SessionUser } from "@/types";

import { removeLocalStorageByPrefixes } from "@/utils/userScopedStorage";

const LOCAL_PROGRESS_PREFIX = "reader-progress:";
const PENDING_PROGRESS_PREFIX = "reader-pending-progress:";

const canUseLocalStorage = () => typeof window !== "undefined" && "localStorage" in window;

const getLocalProgressKey = (userId: string, bookId: string) => `${LOCAL_PROGRESS_PREFIX}${userId}:${bookId}`;
const getPendingProgressKey = (userId: string) => `${PENDING_PROGRESS_PREFIX}${userId}`;

const readPendingProgress = (userId: string) => {
    if (!canUseLocalStorage()) return [] as ReadingProgress[];

    try {
        const raw = localStorage.getItem(getPendingProgressKey(userId));
        return raw ? JSON.parse(raw) as ReadingProgress[] : [];
    } catch {
        return [];
    }
};

const writePendingProgress = (userId: string, items: ReadingProgress[]) => {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(getPendingProgressKey(userId), JSON.stringify(items));
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
    const items = readPendingProgress(progress.userId);
    const nextItems = [
        ...items.filter((item) => !(item.userId === progress.userId && item.bookId === progress.bookId)),
        progress,
    ];

    writePendingProgress(progress.userId, nextItems);
};

export const saveReadingProgress = async (user: SessionUser | null | undefined, progress: Omit<ReadingProgress, "userId">) => {
    if (!user) return;

    const nextProgress: ReadingProgress = {
        ...progress,
        userId: user.uid,
    };

    cacheLocalProgress(nextProgress);

    try {
        const { readerData } = await loadBackendServices();
        await readerData.saveProgress(nextProgress);
    } catch (err) {
        console.warn("Progress saved locally and will sync later:", err);
        queuePendingProgress(nextProgress);
    }
};

export const syncPendingProgress = async (user: SessionUser | null | undefined) => {
    if (!user) return;

    const ownItems = readPendingProgress(user.uid).filter((item) => item.userId === user.uid);
    const failedItems: ReadingProgress[] = [];

    for (const item of ownItems) {
        try {
            const { readerData } = await loadBackendServices();
            await readerData.saveProgress(item);
        } catch (err) {
            console.warn("Pending progress sync failed:", err);
            failedItems.push(item);
        }
    }

    writePendingProgress(user.uid, failedItems);
};

export const hasPendingProgress = (userId: string) => readPendingProgress(userId).some((item) => item.userId === userId);

export const clearLocalProgress = (userId: string) => {
    removeLocalStorageByPrefixes([
        `${LOCAL_PROGRESS_PREFIX}${userId}:`,
        `${PENDING_PROGRESS_PREFIX}${userId}`,
    ]);
};
