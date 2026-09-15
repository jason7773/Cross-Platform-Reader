import type {
    Book,
    EpubReaderSettings,
    PdfReaderSettings,
    ReaderBookmark,
    ReaderHighlight,
    ReadingProgress,
    SessionUser,
} from "@/types";

export type Unsubscribe = () => void;

export type BookUpload = Omit<Book, "id" | "uploadedBy" | "createdAt">;

/** A complete book submission. The backend owns how files and metadata are
 * persisted so the reader UI never needs provider SDK calls. */
export type LibraryUpload = {
    file: File;
    cover?: Blob | null;
    title: string;
    author: string;
    tags: string[];
    notes: string;
};

export type StoredFile = {
    path: string;
    contentType: string;
    size: number;
};

export interface AuthService {
    subscribe(listener: (user: SessionUser | null) => void, onError?: (error: Error) => void): Unsubscribe;
    signInWithPassword(email: string, password: string): Promise<SessionUser>;
    signUpWithPassword(email: string, password: string): Promise<SessionUser>;
    signInWithGoogle(): Promise<SessionUser>;
    signOut(): Promise<void>;
}

export interface LibraryRepository {
    list(userId: string): Promise<Book[]>;
    get(userId: string, bookId: string): Promise<Book | null>;
    subscribe(userId: string, listener: (books: Book[]) => void, onError?: (error: Error) => void): Unsubscribe;
    create(user: SessionUser, book: BookUpload): Promise<Book>;
    upload(user: SessionUser, upload: LibraryUpload): Promise<Book>;
    remove(userId: string, bookId: string): Promise<void>;
}

export interface ReaderDataRepository {
    getProgress(userId: string, bookId: string): Promise<ReadingProgress | null>;
    listProgress(userId: string): Promise<ReadingProgress[]>;
    subscribeProgress(userId: string, listener: (progress: ReadingProgress[]) => void, onError?: (error: Error) => void): Unsubscribe;
    saveProgress(progress: ReadingProgress): Promise<void>;
    listBookmarks(userId: string, bookId: string): Promise<ReaderBookmark[]>;
    saveBookmark(bookmark: ReaderBookmark): Promise<void>;
    removeBookmark(userId: string, bookId: string, bookmarkId: string): Promise<void>;
    listHighlights(userId: string, bookId: string): Promise<ReaderHighlight[]>;
    saveHighlight(highlight: ReaderHighlight): Promise<void>;
    removeHighlight(userId: string, bookId: string, highlightId: string): Promise<void>;
    getEpubSettings(userId: string): Promise<EpubReaderSettings | null>;
    getPdfSettings(userId: string): Promise<PdfReaderSettings | null>;
    saveEpubSettings(userId: string, settings: EpubReaderSettings): Promise<void>;
    savePdfSettings(userId: string, settings: PdfReaderSettings): Promise<void>;
}

export interface FileStore {
    uploadBook(userId: string, file: Blob, contentType: string, fileName: string): Promise<StoredFile>;
    uploadCover(userId: string, file: Blob, contentType: string, fileName: string): Promise<StoredFile>;
    read(path: string): Promise<Blob>;
    remove(path: string): Promise<void>;
}

export interface ReaderBackendServices {
    auth: AuthService;
    library: LibraryRepository;
    readerData: ReaderDataRepository;
    files: FileStore;
}
