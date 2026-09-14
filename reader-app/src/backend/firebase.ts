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
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import type { AuthService, FileStore, LibraryRepository, ReaderBackendServices, ReaderDataRepository, StoredFile } from "@/backend/contracts";
import { assertFirebaseConfigured, auth, db, googleProvider, storage } from "@/firebase/config";
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
        return onAuthStateChanged(auth, (user) => listener(user ? sessionUser(user) : null), (error) => onError?.(asError(error)));
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
    async remove(userId, bookId) {
        const snapshot = await getDoc(doc(db, "books", bookId));
        if (!snapshot.exists() || snapshot.data().uploadedBy !== userId) {
            throw new Error("Book not found or you do not have access to it.");
        }
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
    removeBookmark: (userId, id) => deleteDoc(doc(db, "bookmarks", recordId(userId, id))),
    async listHighlights(userId, bookId) {
        const snapshot = await getDocs(query(collection(db, "highlights"), where("userId", "==", userId), where("bookId", "==", bookId)));
        return snapshot.docs.map((item) => ({ id: item.id.replace(`${userId}_`, ""), ...item.data() }) as ReaderHighlight);
    },
    saveHighlight: (highlight) => setDoc(doc(db, "highlights", recordId(requireUserRecord(highlight.userId, "Highlight"), highlight.id)), highlight, { merge: true }),
    removeHighlight: (userId, id) => deleteDoc(doc(db, "highlights", recordId(userId, id))),
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
    if (!/^(books|covers)\/[A-Za-z0-9_-]+\//.test(path)) throw new Error("Invalid reader storage path.");
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
            assertInternalPath(path);
            const response = await fetch(await getDownloadURL(ref(storage, path)), { credentials: "omit", cache: "no-store" });
            if (!response.ok) throw new Error(`Could not download file (${response.status}).`);
            return response.blob();
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
