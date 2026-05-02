declare module 'epubjs' {
    export default function ePub(urlOrData: string | ArrayBuffer): Book;

    export interface Book {
        ready: Promise<void>;
        coverUrl(): Promise<string | null>;
        // Add other methods as needed
    }
}
