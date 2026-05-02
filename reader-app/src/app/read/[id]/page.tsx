"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc, setDoc, getDocFromCache } from "firebase/firestore"; // Added getDocFromCache if needed, but standard getDoc is fine
import { db } from "@/firebase/config";
import { Book } from "@/types";
import { useAuth } from "../../../context/AuthContext";
import styles from "./page.module.css";
// Dynamic imports for PDF and Epub readers to avoid SSR issues
import dynamic from "next/dynamic";

const PDFReader = dynamic(() => import("../../../components/PDFReader"), { ssr: false });
const EpubReader = dynamic(() => import("../../../components/EpubReader"), { ssr: false });

export default function ReadPage() {
    const { id } = useParams();
    const { user } = useAuth();
    const [book, setBook] = useState<Book | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) return;
        const fetchBook = async () => {
            try {
                const docRef = doc(db, "books", id as string);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setBook({ id: docSnap.id, ...docSnap.data() } as Book);
                } else {
                    alert("Book not found");
                }
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        fetchBook();
    }, [id]);

    if (loading) return <div>Loading book...</div>;
    if (!book) return <div>Book not found</div>;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <a href="/" className={styles.backBtn}>← Back to Library</a>
                <h1 className={styles.title}>{book.title}</h1>
            </header>
            <div className={styles.readerContainer}>
                {book.format === "pdf" ? (
                    <PDFReader url={book.url} bookId={book.id} />
                ) : (
                    <EpubReader url={book.url} bookId={book.id} title={book.title} />
                )}
            </div>
        </div>
    );
}
