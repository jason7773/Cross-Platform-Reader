import {
    GoogleAuthProvider,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    type User,
} from "firebase/auth";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    where,
} from "firebase/firestore";
import { deleteObject, getBlob, ref, uploadBytes } from "firebase/storage";
import type { AuthService, FileStore, LibraryRepository, LibraryUpload, ReaderBackendServices, ReaderDataRepository, StoredFile } from "@/backend/contracts";
import { assertFirebaseConfigured, auth, db, googleProvider, storage } from "@/firebase/config";
import { getFirebasePublicConfig } from "@/backend/config";
import type { Book, EpubReaderSettings, PdfReaderSettings, ReaderBookmark, ReaderHighlight, ReadingProgress, SessionUser } from "@/types";

const asError = (error: unknown) => error instanceof Error ? error : new Error("Firebase request failed.");
const sessionUser = (user: User): SessionUser => ({ uid: user.uid, email: user.email, displayName: user.displayName });
const recordId = (userId: string, recordId: string) => `${userId}_${recordId}`;

const requireUserRecord = (userId: string | undefined, kind: string) => {
    if (!userId) throw new Error(`${kind} must belong to a signed-in user.`);
    return userId;
};

const createAuth = (): AuthService => ({
    subscribe(listener, onError) {
        assertFirebaseConfigured();
        return onAuthStateChanged(auth, async (user) => {
            if (!user) {
                listener(null);
                return;
            }
            try {
                const membership = await getDoc(doc(db, "members", user.uid));
                if (!membership.exists() || membership.data().active !== true) {
                    await signOut(auth);
                    listener(null);
                    onError?.(new Error("This account has not been approved by the library administrator."));
                    return;
                }
                listener(sessionUser(user));
            } catch (error) {
                await signOut(auth).catch(() => undefined);
                listener(null);
                onError?.(asError(error));
            }
        }, (error) => onError?.(asError(error)));
    },
    async signInWithPassword(email, password) {
        assertFirebaseConfigured();
        return sessionUser((await signInWithEmailAndPassword(auth, email, password)).user);
    },
    async signUpWithPassword(email, password) {
        assertFirebaseConfigured();
        return sessionUser((await createUserWithEmailAndPassword(auth, email, password)).user);
    },
    async signInWithGoogle() {
        assertFirebaseConfigured();
        return sessionUser((await signInWithPopup(auth, googleProvider)).user);
    },
    signOut: () => signOut(auth),
});

const contentTypeForBook = (format: "pdf" | "epub", supplied: string) => (
    format === "pdf" && supplied === "application/pdf" ? supplied
        : format === "epub" && supplied === "application/epub+zip" ? supplied
            : format === "pdf" ? "application/pdf" : "application/epub+zip"
);

const createLibrary = (): LibraryRepository => ({
    async list(userId) {
        const snapshot = await getDocs(query(collection(db, "books"), where("uploadedBy", "==", userId), orderBy("createdAt", "desc")));
        return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Book);
    },
    async get(userId, bookId) {
        const snapshot = await getDoc(doc(db, "books", bookId));
        if (!snapshot.exists()) return null;
        const book = { id: snapshot.id, ...snapshot.data() } as Book;
        return book.uploadedBy === userId ? book : null;
    },
    subscribe(userId, listener, onError) {
        return onSnapshot(
            query(collection(db, "books"), where("uploadedBy", "==", userId), orderBy("createdAt", "desc")),
            (snapshot) => listener(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Book)),
            (error) => onError?.(asError(error)),
        );
    },
    async create(user, book) {
        const createdAt = Date.now();
        const result = await addDoc(collection(db, "books"), { ...book, uploadedBy: user.uid, createdAt });
        return { id: result.id, ...book, uploadedBy: user.uid, createdAt };
    },
    async upload(user, upload: LibraryUpload) {
        const extension = upload.file.name.split(".").pop()?.toLowerCase();
        if (extension !== "pdf" && extension !== "epub") throw new Error("Only PDF and ePub formats are supported.");
        if (upload.file.size <= 0 || upload.file.size > 100 * 1024 * 1024) throw new Error("Books must be between 1 byte and 100 MiB.");
        const format = extension;
        const mimeType = contentTypeForBook(format, upload.file.type);
        const storagePath = `books/${user.uid}/${crypto.randomUUID()}_${safeFileName(upload.file.name)}`;
        let coverStoragePath = "";

        try {
            await uploadBytes(ref(storage, storagePath), upload.file, { contentType: mimeType, cacheControl: "private, max-age=0, no-store" });
            if (upload.cover) {
                if (upload.cover.size <= 0 || upload.cover.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(upload.cover.type)) {
                    throw new Error("Covers must be JPEG, PNG, or WebP images up to 2 MiB.");
                }
                const coverExtension = upload.cover.type === "image/png" ? "png" : upload.cover.type === "image/webp" ? "webp" : "jpg";
                coverStoragePath = `covers/${user.uid}/${crypto.randomUUID()}.${coverExtension}`;
                await uploadBytes(ref(storage, coverStoragePath), upload.cover, { contentType: upload.cover.type, cacheControl: "private, max-age=0, no-store" });
            }
            return await this.create(user, {
                title: upload.title.trim(),
                author: upload.author.trim() || "Unknown",
                format,
                storagePath,
                coverStoragePath: coverStoragePath || undefined,
                fileSize: upload.file.size,
                mimeType,
                coverSize: upload.cover?.size,
                coverMimeType: upload.cover?.type,
                tags: upload.tags,
                notes: upload.notes.trim(),
            });
        } catch (error) {
            await Promise.allSettled([storagePath ? deleteObject(ref(storage, storagePath)) : Promise.resolve(), coverStoragePath ? deleteObject(ref(storage, coverStoragePath)) : Promise.resolve()]);
            throw error;
        }
    },
    async remove(userId, bookId) {
        const snapshot = await getDoc(doc(db, "books", bookId));
        if (!snapshot.exists() || snapshot.data().uploadedBy !== userId) {
            throw new Error("Book not found or you do not have access to it.");
        }
        const data = snapshot.data() as Book;
        await Promise.all([data.storagePath ? deleteObject(ref(storage, data.storagePath)) : Promise.resolve(), data.coverStoragePath ? deleteObject(ref(storage, data.coverStoragePath)) : Promise.resolve()]);
        await deleteDoc(doc(db, "books", bookId));
    },
});

const createReaderData = (): ReaderDataRepository => ({
    async getProgress(userId, bookId) {
        const snapshot = await getDoc(doc(db, "progress", recordId(userId, bookId)));
        return snapshot.exists() ? snapshot.data() as ReadingProgress : null;
    },
    async listProgress(userId) {
        const snapshot = await getDocs(query(collection(db, "progress"), where("userId", "==", userId)));
        return snapshot.docs.map((item) => item.data() as ReadingProgress);
    },
    subscribeProgress(userId, listener, onError) {
        return onSnapshot(
            query(collection(db, "progress"), where("userId", "==", userId)),
            (snapshot) => listener(snapshot.docs.map((item) => item.data() as ReadingProgress)),
            (error) => onError?.(asError(error)),
        );
    },
    saveProgress: (progress) => setDoc(doc(db, "progress", recordId(progress.userId, progress.bookId)), progress, { merge: true }),
    async listBookmarks(userId, bookId) {
        const snapshot = await getDocs(query(collection(db, "bookmarks"), where("userId", "==", userId), where("bookId", "==", bookId)));
        return snapshot.docs.map((item) => ({ id: item.id.replace(`${userId}_`, ""), ...item.data() }) as ReaderBookmark);
    },
    saveBookmark: (bookmark) => setDoc(doc(db, "bookmarks", recordId(requireUserRecord(bookmark.userId, "Bookmark"), bookmark.id)), bookmark, { merge: true }),
    removeBookmark: (userId, _bookId, id) => deleteDoc(doc(db, "bookmarks", recordId(userId, id))),
    async listHighlights(userId, bookId) {
        const snapshot = await getDocs(query(collection(db, "highlights"), where("userId", "==", userId), where("bookId", "==", bookId)));
        return snapshot.docs.map((item) => ({ id: item.id.replace(`${userId}_`, ""), ...item.data() }) as ReaderHighlight);
    },
    saveHighlight: (highlight) => setDoc(doc(db, "highlights", recordId(requireUserRecord(highlight.userId, "Highlight"), highlight.id)), highlight, { merge: true }),
    removeHighlight: (userId, _bookId, id) => deleteDoc(doc(db, "highlights", recordId(userId, id))),
    async getEpubSettings(userId) {
        const snapshot = await getDoc(doc(db, "readerSettings", `${userId}_epub`));
        return snapshot.exists() ? snapshot.data().settings as EpubReaderSettings : null;
    },
    async getPdfSettings(userId) {
        const snapshot = await getDoc(doc(db, "readerSettings", `${userId}_pdf`));
        return snapshot.exists() ? snapshot.data().settings as PdfReaderSettings : null;
    },
    saveEpubSettings: (userId, settings) => setDoc(doc(db, "readerSettings", `${userId}_epub`), { userId, kind: "epub", settings, updatedAt: Date.now() }, { merge: true }),
    savePdfSettings: (userId, settings) => setDoc(doc(db, "readerSettings", `${userId}_pdf`), { userId, kind: "pdf", settings, updatedAt: Date.now() }, { merge: true }),
});

const safeFileName = (fileName: string) => fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "upload";
const assertInternalPath = (path: string) => {
    if (/^https?:\/\//i.test(path) || path.startsWith("/")) throw new Error("File paths must be internal storage paths.");
    if (!/^(books|covers)\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(path)) throw new Error("Invalid reader storage path.");
};

const legacyUrlToPath = (value: string) => {
    if (!/^https?:\/\//i.test(value)) return value;
    const url = new URL(value);
    const bucket = getFirebasePublicConfig().storageBucket;
    let encodedPath = "";
    if (url.hostname === "firebasestorage.googleapis.com") {
        const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.*)$/);
        if (!match || decodeURIComponent(match[1]) !== bucket) throw new Error("File URL is not from the configured Firebase bucket.");
        encodedPath = match[2];
    } else if (url.hostname === "storage.googleapis.com") {
        const match = url.pathname.match(/^\/([^/]+)\/(.*)$/);
        if (!match || decodeURIComponent(match[1]) !== bucket) throw new Error("File URL is not from the configured Firebase bucket.");
        encodedPath = match[2];
    } else {
        throw new Error("External file URLs are not supported.");
    }
    return decodeURIComponent(encodedPath);
};

const createFiles = (): FileStore => {
    const upload = async (kind: "books" | "covers", userId: string, file: Blob, contentType: string, fileName: string): Promise<StoredFile> => {
        const path = `${kind}/${userId}/${crypto.randomUUID()}_${safeFileName(fileName)}`;
        await uploadBytes(ref(storage, path), file, { contentType, cacheControl: "private, max-age=0, no-store" });
        return { path, contentType, size: file.size };
    };

    return {
        uploadBook: (userId, file, contentType, fileName) => upload("books", userId, file, contentType, fileName),
        uploadCover: (userId, file, contentType, fileName) => upload("covers", userId, file, contentType, fileName),
        async read(path) {
            path = legacyUrlToPath(path);
            assertInternalPath(path);
            // getBlob sends the signed-in Firebase session and lets Storage rules
            // authorize the read. getDownloadURL creates a transferable bearer URL.
            return getBlob(ref(storage, path));
        },
        async remove(path) {
            if (!path) return;
            assertInternalPath(path);
            await deleteObject(ref(storage, path));
        },
    };
};

export const createFirebaseBackend = (): ReaderBackendServices => ({
    auth: createAuth(),
    library: createLibrary(),
    readerData: createReaderData(),
    files: createFiles(),
});
