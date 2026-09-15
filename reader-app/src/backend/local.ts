"use client";

import type { AuthService, FileStore, LibraryRepository, ReaderBackendServices, ReaderDataRepository, StoredFile } from "@/backend/contracts";
import type { Book, EpubReaderSettings, PdfReaderSettings, ReaderBookmark, ReaderHighlight, ReadingProgress, SessionUser } from "@/types";

let csrfToken = "";
const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (csrfToken && init?.method && init.method !== "GET") headers.set("x-csrf-token", csrfToken);
    const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: "same-origin", cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || `Local API request failed (${response.status}).`);
    return payload;
};

const auth: AuthService = {
    subscribe(listener, onError) {
        let stopped = false;
        const poll = async () => {
            try {
                const payload = await request<{ user?: SessionUser; csrfToken?: string }>("/auth/session");
                if (payload.csrfToken) csrfToken = payload.csrfToken;
                if (!stopped) listener(payload.user || null);
            } catch (error) { if (!stopped) listener(null); onError?.(error instanceof Error ? error : new Error("Session check failed.")); }
        };
        void poll();
        const timer = window.setInterval(poll, 30_000);
        window.addEventListener("reader-session-changed", poll);
        window.addEventListener("focus", poll);
        return () => {
            stopped = true;
            window.clearInterval(timer);
            window.removeEventListener("reader-session-changed", poll);
            window.removeEventListener("focus", poll);
        };
    },
    async signInWithPassword(email, password) { const payload = await request<{ user: SessionUser; csrfToken: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); csrfToken = payload.csrfToken; return payload.user; },
    async signUpWithPassword() { throw new Error("Create local users with the local:user administrator command."); },
    async signInWithGoogle() { throw new Error("Google sign-in is available only in Firebase mode."); },
    async signOut() { await request("/auth/logout", { method: "POST" }); csrfToken = ""; },
};

const library: LibraryRepository = {
    async list() { return (await request<{ books: Book[] }>("/books")).books; },
    async get(_, bookId) { try { return (await request<{ book: Book }>(`/books/${encodeURIComponent(bookId)}`)).book; } catch { return null; } },
    subscribe(userId, listener, onError) {
        let stopped = false;
        const poll = async () => {
            try {
                const books = await library.list(userId);
                if (!stopped) listener(books);
            } catch (error) {
                onError?.(error instanceof Error ? error : new Error("Library request failed."));
            }
        };
        void poll();
        const timer = window.setInterval(poll, 30_000);
        window.addEventListener("focus", poll);
        return () => { stopped = true; window.clearInterval(timer); window.removeEventListener("focus", poll); };
    },
    async create() { throw new Error("Local book creation requires a multipart upload; use FileStore.uploadBook."); },
    async upload(_, upload) {
        const form = new FormData();
        form.set("file", upload.file);
        form.set("title", upload.title);
        form.set("author", upload.author);
        form.set("tags", JSON.stringify(upload.tags));
        form.set("notes", upload.notes);
        if (upload.cover) {
            form.set("cover", new File([upload.cover], "cover.jpg", { type: upload.cover.type || "image/jpeg" }));
        }
        return (await request<{ book: Book }>("/books", { method: "POST", body: form })).book;
    },
    async remove(_, bookId) { await request(`/books/${encodeURIComponent(bookId)}`, { method: "DELETE" }); },
};

const readerData: ReaderDataRepository = {
    async getProgress(_, bookId) { return (await request<{ progress?: ReadingProgress }>(`/books/${encodeURIComponent(bookId)}/progress`)).progress || null; },
    async listProgress(userId) {
        const books = await library.list(userId);
        const records = await Promise.all(books.map((book) => readerData.getProgress(userId, book.id)));
        return records.filter((record): record is ReadingProgress => Boolean(record));
    },
    subscribeProgress(userId, listener, onError) {
        let stopped = false;
        const poll = async () => {
            try {
                const progress = await readerData.listProgress(userId);
                if (!stopped) listener(progress);
            } catch (error) {
                onError?.(error instanceof Error ? error : new Error("Progress request failed."));
            }
        };
        void poll();
        const timer = window.setInterval(poll, 30_000);
        window.addEventListener("focus", poll);
        return () => { stopped = true; window.clearInterval(timer); window.removeEventListener("focus", poll); };
    },
    async saveProgress(progress) { await request(`/books/${encodeURIComponent(progress.bookId)}/progress`, { method: "PUT", body: JSON.stringify(progress) }); },
    async listBookmarks(_, bookId) { return (await request<{ bookmarks: ReaderBookmark[] }>(`/books/${encodeURIComponent(bookId)}/bookmarks`)).bookmarks; },
    async saveBookmark(bookmark) { await request(`/books/${encodeURIComponent(bookmark.bookId)}/bookmarks`, { method: "PUT", body: JSON.stringify(bookmark) }); },
    async removeBookmark(_, bookId, bookmarkId) { await request(`/books/${encodeURIComponent(bookId)}/bookmarks?id=${encodeURIComponent(bookmarkId)}`, { method: "DELETE" }); },
    async listHighlights(_, bookId) { return (await request<{ highlights: ReaderHighlight[] }>(`/books/${encodeURIComponent(bookId)}/highlights`)).highlights; },
    async saveHighlight(highlight) { await request(`/books/${encodeURIComponent(highlight.bookId)}/highlights`, { method: "PUT", body: JSON.stringify(highlight) }); },
    async removeHighlight(_, bookId, highlightId) { await request(`/books/${encodeURIComponent(bookId)}/highlights?id=${encodeURIComponent(highlightId)}`, { method: "DELETE" }); },
    async getEpubSettings() { return (await request<{ settings?: EpubReaderSettings }>(`/settings?kind=epub`)).settings || null; },
    async getPdfSettings() { return (await request<{ settings?: PdfReaderSettings }>(`/settings?kind=pdf`)).settings || null; },
    async saveEpubSettings(_, settings) { await request("/settings", { method: "PUT", body: JSON.stringify({ kind: "epub", settings }) }); },
    async savePdfSettings(_, settings) { await request("/settings", { method: "PUT", body: JSON.stringify({ kind: "pdf", settings }) }); },
};

const files: FileStore = {
    async uploadBook(userId, file, contentType, fileName): Promise<StoredFile> { const form = new FormData(); form.set("file", new File([file], fileName, { type: contentType })); form.set("title", fileName.replace(/\.[^.]+$/, "")); form.set("author", ""); const payload = await request<{ book: Book }>("/books", { method: "POST", body: form }); return { path: payload.book.storagePath || payload.book.url || "", contentType, size: file.size }; },
    async uploadCover() { throw new Error("Upload covers together with a book in local mode."); },
    async read(path) { const response = await fetch(path.startsWith("/api/") ? path : `/api/v1/books/${encodeURIComponent(path)}/file`, { credentials: "same-origin", cache: "no-store" }); if (!response.ok) throw new Error("Could not read file."); return response.blob(); },
    async remove() { return undefined; },
};

export const createLocalBackend = (): ReaderBackendServices => ({ auth, library, readerData, files });
