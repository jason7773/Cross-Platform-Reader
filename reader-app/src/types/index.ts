export interface Book {
    id: string;
    title: string;
    author: string;
    format: 'pdf' | 'epub';
    url: string;
    coverUrl?: string; // Optional cover image
    storagePath?: string;
    coverStoragePath?: string;
    fileSize?: number;
    mimeType?: string;
    coverSize?: number;
    coverMimeType?: string;
    uploadedBy: string; // User ID
    createdAt: number; // Timestamp
}

export interface UserProfile {
    uid: string;
    email: string;
    role: 'admin' | 'user';
}

export interface ReadingProgress {
    userId: string;
    bookId: string;
    location: string | number; // CFI for Epub, page number for PDF
    percentage?: number;
    lastRead: number;
}

export interface ReaderBookmark {
    id: string;
    bookId: string;
    label: string;
    note: string;
    location: string | number;
    percentage?: number;
    createdAt: number;
}

export interface EpubReaderSettings {
    fontSize: number;
    lineHeight: number;
    pageWidth: number;
}

export interface PdfReaderSettings {
    zoom: number;
    pageMode: 'single' | 'continuous';
}
