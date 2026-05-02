"use client";
import { useEffect, useState } from "react";
import { collection, query, onSnapshot, orderBy, doc, deleteDoc, where } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { db, storage } from "@/firebase/config";
import { Book } from "@/types";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import styles from "./BookList.module.css";

export default function BookList() {
    const { user } = useAuth();
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;

        const q = query(
            collection(db, "books"),
            where("uploadedBy", "==", user.uid),
            orderBy("createdAt", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const booksData = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as Book[];
            setBooks(booksData);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const handleDelete = async (book: Book) => {
        if (!confirm(`Are you sure you want to delete "${book.title}"?`)) return;
        try {
            // 1. Delete Firestore Document
            await deleteDoc(doc(db, "books", book.id));

            // 2. Delete Book File from Storage
            const bookRef = ref(storage, book.url);
            deleteObject(bookRef).catch(err => console.warn("Failed to delete book file:", err));

            // 3. Delete Cover Image from Storage (if exists)
            if (book.coverUrl) {
                const coverRef = ref(storage, book.coverUrl);
                deleteObject(coverRef).catch(err => console.warn("Failed to delete cover image:", err));
            }
        } catch (err) {
            console.error("Error deleting book:", err);
            alert("Failed to delete book. Check console for details.");
        }
    };

    if (loading) return <div>Loading library...</div>;

    return (
        <div className={styles.grid}>
            {books.map((book) => (
                <div key={book.id} className={styles.card}>
                    <div className={styles.coverPlaceholder}>
                        {book.coverUrl ? (
                            <img src={book.coverUrl} alt={book.title} className={styles.coverImage} />
                        ) : (
                            <span>{book.format === "pdf" ? "PDF" : "ePub"}</span>
                        )}
                    </div>
                    <div className={styles.info}>
                        <h4 className={styles.title} title={book.title}>{book.title}</h4>
                        <p className={styles.author}>{book.author}</p>
                        <div className={styles.actions}>
                            <Link href={`/read/${book.id}`} className={styles.readBtn}>
                                Read
                            </Link>
                            {user && user.uid === book.uploadedBy && (
                                <button
                                    onClick={() => handleDelete(book)}
                                    className={styles.deleteBtn}
                                >
                                    Delete
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            ))}
            {books.length === 0 && <p>No books found. Upload one above!</p>}
        </div>
    );
}
