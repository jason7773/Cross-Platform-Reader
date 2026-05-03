"use client";
import { useEffect, useMemo, useState } from "react";
import { collection, query, onSnapshot, orderBy, doc, deleteDoc, where } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import Image from "next/image";
import { db, storage } from "@/firebase/config";
import { Book } from "@/types";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import styles from "./BookList.module.css";

type BookListProps = {
    searchQuery?: string;
};

const getStorageTarget = (path?: string, url?: string) => path || url || "";

export default function BookList({ searchQuery = "" }: BookListProps) {
    const { user } = useAuth();
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [failedCovers, setFailedCovers] = useState<Record<string, true>>({});

    useEffect(() => {
        if (!user) return;

        setLoading(true);
        const q = query(
            collection(db, "books"),
            where("uploadedBy", "==", user.uid),
            orderBy("createdAt", "desc")
        );

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const booksData = snapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                })) as Book[];
                setBooks(booksData);
                setError("");
                setLoading(false);
            },
            (err) => {
                console.error("Error loading library:", err);
                setError("Could not load your library.");
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [user]);

    const filteredBooks = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        if (!normalizedQuery) return books;

        return books.filter((book) =>
            `${book.title} ${book.author} ${book.format}`.toLowerCase().includes(normalizedQuery)
        );
    }, [books, searchQuery]);

    const deleteStorageTarget = async (pathOrUrl: string) => {
        if (!pathOrUrl) return;
        await deleteObject(ref(storage, pathOrUrl));
    };

    const handleDelete = async (book: Book) => {
        setDeletingId(book.id);
        setError("");

        try {
            const bookTarget = getStorageTarget(book.storagePath, book.url);
            const coverTarget = getStorageTarget(book.coverStoragePath, book.coverUrl);

            const storageResults = await Promise.allSettled([
                deleteStorageTarget(bookTarget),
                deleteStorageTarget(coverTarget),
            ]);

            storageResults.forEach((result) => {
                if (result.status === "rejected") {
                    console.warn("Failed to delete storage object:", result.reason);
                }
            });

            await deleteDoc(doc(db, "books", book.id));
            setDeleteTarget(null);
        } catch (err) {
            console.error("Error deleting book:", err);
            setError("Could not delete this book. Try again in a moment.");
        } finally {
            setDeletingId(null);
        }
    };

    if (loading) return <div className={styles.status}>Loading library...</div>;
    if (error && books.length === 0) return <div className={styles.status}>{error}</div>;

    return (
        <>
            {error && <div className={styles.inlineError}>{error}</div>}
            <div className={styles.grid}>
                {filteredBooks.map((book) => (
                    <article key={book.id} className={styles.card}>
                        <Link href={`/read/${book.id}`} className={styles.coverPlaceholder} aria-label={`Read ${book.title}`}>
                            {book.coverUrl && !failedCovers[book.id] ? (
                                <Image
                                    src={book.coverUrl}
                                    alt={book.title}
                                    fill
                                    unoptimized
                                    sizes="(max-width: 640px) 45vw, (max-width: 1100px) 25vw, 220px"
                                    className={styles.coverImage}
                                    onError={() => setFailedCovers((current) => ({ ...current, [book.id]: true }))}
                                />
                            ) : (
                                <span className={styles.coverFallback}>{book.format === "pdf" ? "PDF" : "ePub"}</span>
                            )}
                            <span className={styles.formatBadge}>{book.format}</span>
                        </Link>
                        <div className={styles.info}>
                            <h4 className={styles.title} title={book.title}>{book.title}</h4>
                            <p className={styles.author}>{book.author}</p>
                            <div className={styles.actions}>
                                <Link href={`/read/${book.id}`} className={styles.readBtn}>
                                    Read
                                </Link>
                                {user && user.uid === book.uploadedBy && (
                                    <button
                                        type="button"
                                        onClick={() => setDeleteTarget(book)}
                                        className={styles.deleteBtn}
                                    >
                                        Delete
                                    </button>
                                )}
                            </div>
                        </div>
                    </article>
                ))}
                {filteredBooks.length === 0 && (
                    <p className={styles.empty}>
                        {books.length === 0 ? "No books yet. Add your first PDF or ePub." : "No books match your search."}
                    </p>
                )}
            </div>

            {deleteTarget && (
                <div className={styles.dialogBackdrop} role="presentation" onClick={() => setDeleteTarget(null)}>
                    <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="delete-book-title" onClick={(e) => e.stopPropagation()}>
                        <h3 id="delete-book-title">Delete book?</h3>
                        <p>{deleteTarget.title}</p>
                        <div className={styles.dialogActions}>
                            <button type="button" className={styles.cancelBtn} onClick={() => setDeleteTarget(null)}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className={styles.confirmDeleteBtn}
                                onClick={() => handleDelete(deleteTarget)}
                                disabled={deletingId === deleteTarget.id}
                            >
                                {deletingId === deleteTarget.id ? "Deleting..." : "Delete"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
