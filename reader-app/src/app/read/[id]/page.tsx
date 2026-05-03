"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import { Book } from "@/types";
import styles from "./page.module.css";
import dynamic from "next/dynamic";
import { cacheBookMetadata, getCachedBookMetadata } from "@/utils/bookMetadataCache";

const PDFReader = dynamic(() => import("../../../components/PDFReader"), { ssr: false });
const EpubReader = dynamic(() => import("../../../components/EpubReader"), { ssr: false });

export default function ReadPage() {
    const { id } = useParams();
    const [book, setBook] = useState<Book | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) return;

        const fetchBook = async () => {
            try {
                const docRef = doc(db, "books", id as string);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const loadedBook = { id: docSnap.id, ...docSnap.data() } as Book;
                    setBook(loadedBook);
                    cacheBookMetadata(loadedBook);
                } else {
                    const cachedBook = getCachedBookMetadata(id as string);
                    if (cachedBook) {
                        setBook(cachedBook);
                    } else {
                        alert("Book not found");
                    }
                }
            } catch (err) {
                console.error(err);
                const cachedBook = getCachedBookMetadata(id as string);
                if (cachedBook) {
                    setBook(cachedBook);
                }
            } finally {
                setLoading(false);
            }
        };

        fetchBook();
    }, [id]);

    if (loading) return <div className={styles.status}>Loading book...</div>;
    if (!book) return <div className={styles.status}>Book not found</div>;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link href="/" className={styles.backBtn} aria-label="Back to library">Library</Link>
                <h1 className={styles.title}>{book.title}</h1>
            </header>
            <div className={styles.readerContainer}>
                {book.format === "pdf" ? (
                    <PDFReader url={book.url} bookId={book.id} mimeType={book.mimeType} />
                ) : (
                    <EpubReader url={book.url} bookId={book.id} mimeType={book.mimeType} />
                )}
            </div>
        </div>
    );
}
