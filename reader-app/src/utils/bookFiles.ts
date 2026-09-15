import { getReaderBackend, loadBackendServices } from "@/backend";
import { Book } from "@/types";

const resolvedObjectUrls = new Map<string, string>();

const assertInternalStoragePath = (path: string) => {
    if (!/^(books|covers)\/[A-Za-z0-9_-]+\/[^/]+$/.test(path)) {
        throw new Error("Book files must use an internal Firebase Storage path.");
    }
    return path;
};

const toStoragePath = (path: string) => assertInternalStoragePath(path);

export const getBookCacheKey = (book: Pick<Book, "id" | "storagePath" | "url">) => (
    `${process.env.NEXT_PUBLIC_READER_DEPLOYMENT_ID || "default"}:${getReaderBackend()}:${book.storagePath || book.url || `legacy-book:${book.id}`}`
);

export const getCoverCacheKey = (book: Pick<Book, "id" | "coverStoragePath" | "coverUrl">) => (
    `${process.env.NEXT_PUBLIC_READER_DEPLOYMENT_ID || "default"}:${getReaderBackend()}:${book.coverStoragePath || book.coverUrl || `legacy-cover:${book.id}`}`
);

export const resolveStorageUrl = async (path?: string, localApiPath?: string) => {
    if (!path && !localApiPath) return "";
    const cacheKey = localApiPath || path || "";
    const existing = resolvedObjectUrls.get(cacheKey);
    if (existing) return existing;

    const { files } = await loadBackendServices();
    const source = getReaderBackend() === "local" ? localApiPath : toStoragePath(path || "");
    if (!source) return "";
    // Each adapter authorizes the Blob read itself. The UI only keeps a short
    // lived object URL, never a transferable Storage download URL.
    const objectUrl = URL.createObjectURL(await files.read(source));
    resolvedObjectUrls.set(cacheKey, objectUrl);
    return objectUrl;
};

/** Release all in-memory URLs when the signed-in library session ends. */
export const clearResolvedStorageUrls = () => {
    resolvedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    resolvedObjectUrls.clear();
};

export const resolveBookUrl = async (book: Pick<Book, "id" | "storagePath" | "url">) => (
    resolveStorageUrl(book.storagePath || book.url, `/api/v1/books/${encodeURIComponent(book.id)}/file`)
);

export const resolveCoverUrl = async (book: Pick<Book, "id" | "coverStoragePath" | "coverUrl">) => (
    resolveStorageUrl(book.coverStoragePath || book.coverUrl, `/api/v1/books/${encodeURIComponent(book.id)}/cover`)
);

export const isOwnerBook = (book: Pick<Book, "uploadedBy"> | null | undefined, userId?: string) => (
    Boolean(book && userId && book.uploadedBy === userId)
);
