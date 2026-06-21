"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import { Book } from "@/types";
import styles from "./page.module.css";
import dynamic from "next/dynamic";
import { cacheBookMetadata, deleteCachedBookMetadata, getCachedBookMetadata } from "@/utils/bookMetadataCache";
import { useAuth } from "@/context/AuthContext";
import { getBookCacheKey, isOwnerBook, resolveBookUrl } from "@/utils/bookFiles";

const PDFReader = dynamic(() => import("../../../components/PDFReader"), { ssr: false });
const EpubReader = dynamic(() => import("../../../components/EpubReader"), { ssr: false });

export default function ReadPage() {
    const { id } = useParams();
    const { user, loading: authLoading } = useAuth();
    const [book, setBook] = useState<Book | null>(null);
    const [fileUrl, setFileUrl] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id || authLoading) return;
        if (!user) {
            setLoading(false);
            return;
        }

        const fetchBook = async () => {
            try {
                const docRef = doc(db, "books", id as string);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const loadedBook = { id: docSnap.id, ...docSnap.data() } as Book;
                    if (!isOwnerBook(loadedBook, user.uid)) {
                        setBook(null);
                        setFileUrl("");
                        return;
                    }
                    setBook(loadedBook);
                    setFileUrl(await resolveBookUrl(loadedBook));
                    cacheBookMetadata(user.uid, loadedBook);
                } else {
                    const cachedBook = getCachedBookMetadata(user.uid, id as string);
                    if (cachedBook) {
                        setBook(cachedBook);
                        setFileUrl(await resolveBookUrl(cachedBook));
                    } else {
                        alert("Book not found");
                    }
                }
            } catch (err) {
                console.error(err);
                const cachedBook = getCachedBookMetadata(user.uid, id as string);
                if (cachedBook) {
                    if (isOwnerBook(cachedBook, user.uid)) {
                        setBook(cachedBook);
                        setFileUrl(await resolveBookUrl(cachedBook));
                    } else {
                        deleteCachedBookMetadata(user.uid, id as string);
                    }
                }
            } finally {
                setLoading(false);
            }
        };

        fetchBook();
    }, [authLoading, id, user]);

    if (loading || authLoading) return <div className={styles.status}>Loading book...</div>;
    if (!book) return <div className={styles.status}>Book not found</div>;
    if (!fileUrl) return <div className={styles.status}>Book file is unavailable</div>;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Link href="/" className={styles.backBtn} aria-label="Back to library">Library</Link>
                <h1 className={styles.title}>{book.title}</h1>
            </header>
            <div className={styles.readerContainer}>
                {book.format === "pdf" ? (
                    <PDFReader url={fileUrl} cacheKey={getBookCacheKey(book)} bookId={book.id} mimeType={book.mimeType} />
                ) : (
                    <EpubReader url={fileUrl} cacheKey={getBookCacheKey(book)} bookId={book.id} mimeType={book.mimeType} />
                )}
            </div>
        </div>
    );
}
