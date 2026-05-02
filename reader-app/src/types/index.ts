export interface Book {
    id: string;
    title: string;
    author: string;
    format: 'pdf' | 'epub';
    url: string;
    coverUrl?: string; // Optional cover image
    storagePath?: string;
    coverStoragePath?: string;
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
