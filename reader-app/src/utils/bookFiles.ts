import { getDownloadURL, ref } from "firebase/storage";
import { storage } from "@/firebase/config";
import { Book } from "@/types";

export const getBookCacheKey = (book: Pick<Book, "id" | "storagePath" | "url">) => (
    book.storagePath || book.url || `legacy-book:${book.id}`
);

export const getCoverCacheKey = (book: Pick<Book, "id" | "coverStoragePath" | "coverUrl">) => (
    book.coverStoragePath || book.coverUrl || `legacy-cover:${book.id}`
);

export const resolveStorageUrl = async (pathOrUrl?: string) => {
    if (!pathOrUrl) return "";
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return getDownloadURL(ref(storage, pathOrUrl));
};

export const resolveBookUrl = async (book: Pick<Book, "storagePath" | "url">) => (
    resolveStorageUrl(book.storagePath || book.url)
);

export const resolveCoverUrl = async (book: Pick<Book, "coverStoragePath" | "coverUrl">) => (
    resolveStorageUrl(book.coverStoragePath || book.coverUrl)
);

export const isOwnerBook = (book: Pick<Book, "uploadedBy"> | null | undefined, userId?: string) => (
    Boolean(book && userId && book.uploadedBy === userId)
);
