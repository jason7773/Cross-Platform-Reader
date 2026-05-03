"use client";
import { useEffect, useMemo, useState } from "react";
import { collection, query, onSnapshot, orderBy, doc, deleteDoc, where, updateDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import Image from "next/image";
import { db, storage } from "@/firebase/config";
import { Book, ReadingProgress } from "@/types";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import styles from "./BookList.module.css";
import { cacheBookFromUrl, deleteCachedBook, isBookCached } from "@/utils/bookCache";
import { cacheBookMetadata, deleteCachedBookMetadata } from "@/utils/bookMetadataCache";
import { getAllLocalProgress, hasPendingProgress, syncPendingProgress } from "@/utils/readingProgress";

type BookListProps = {
    searchQuery?: string;
};

type SortMode = "recent" | "title" | "author" | "progress";
type ViewMode = "grid" | "list";

const getStorageTarget = (path?: string, url?: string) => path || url || "";

export default function BookList({ searchQuery = "" }: BookListProps) {
    const { user } = useAuth();
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [failedCovers, setFailedCovers] = useState<Record<string, true>>({});
    const [progressByBook, setProgressByBook] = useState<Record<string, ReadingProgress>>({});
    const [offlineByBook, setOfflineByBook] = useState<Record<string, boolean>>({});
    const [offlineBusyId, setOfflineBusyId] = useState<string | null>(null);
    const [sortMode, setSortMode] = useState<SortMode>("recent");
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
    const [selectedTag, setSelectedTag] = useState("");
    const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
    const [syncPending, setSyncPending] = useState(false);

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
                booksData.forEach(cacheBookMetadata);
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

    useEffect(() => {
        if (!user) return;

        const q = query(
            collection(db, "progress"),
            where("userId", "==", user.uid)
        );

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const remoteProgress = snapshot.docs.map((doc) => doc.data() as ReadingProgress);
                const localProgress = getAllLocalProgress(user.uid);
                const merged = [...remoteProgress, ...localProgress].reduce<Record<string, ReadingProgress>>((acc, item) => {
                    const current = acc[item.bookId];
                    if (!current || item.lastRead > current.lastRead) {
                        acc[item.bookId] = item;
                    }
                    return acc;
                }, {});

                setProgressByBook(merged);
                setSyncPending(hasPendingProgress(user.uid));
            },
            (err) => {
                console.error("Error loading progress:", err);
                const localProgress = getAllLocalProgress(user.uid);
                setProgressByBook(Object.fromEntries(localProgress.map((item) => [item.bookId, item])));
                setSyncPending(hasPendingProgress(user.uid));
            }
        );

        return () => unsubscribe();
    }, [user]);

    useEffect(() => {
        if (!user) return;

        syncPendingProgress(user).finally(() => setSyncPending(hasPendingProgress(user.uid)));
        const sync = () => syncPendingProgress(user).finally(() => setSyncPending(hasPendingProgress(user.uid)));
        window.addEventListener("online", sync);

        return () => window.removeEventListener("online", sync);
    }, [user]);

    useEffect(() => {
        books.forEach((book) => {
            setTagDrafts((current) => ({
                ...current,
                [book.id]: (book.tags || []).join(", "),
            }));
        });
    }, [books]);

    useEffect(() => {
        let cancelled = false;

        const refreshOfflineStatus = async () => {
            const entries = await Promise.all(books.map(async (book) => [book.id, await isBookCached(book.url)] as const));
            if (!cancelled) {
                setOfflineByBook(Object.fromEntries(entries));
            }
        };

        refreshOfflineStatus();

        return () => {
            cancelled = true;
        };
    }, [books]);

    const filteredBooks = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        let nextBooks = books;

        if (selectedTag) {
            nextBooks = nextBooks.filter((book) => (book.tags || []).includes(selectedTag));
        }

        if (normalizedQuery) {
            nextBooks = nextBooks.filter((book) =>
                `${book.title} ${book.author} ${book.format} ${(book.tags || []).join(" ")}`.toLowerCase().includes(normalizedQuery)
            );
        }

        return [...nextBooks].sort((a, b) => {
            if (sortMode === "title") return a.title.localeCompare(b.title);
            if (sortMode === "author") return a.author.localeCompare(b.author);
            if (sortMode === "progress") return (progressByBook[b.id]?.percentage || 0) - (progressByBook[a.id]?.percentage || 0);
            return (progressByBook[b.id]?.lastRead || b.createdAt || 0) - (progressByBook[a.id]?.lastRead || a.createdAt || 0);
        });
    }, [books, progressByBook, searchQuery, selectedTag, sortMode]);

    const continueBook = useMemo(() => (
        books
            .filter((book) => progressByBook[book.id])
            .sort((a, b) => (progressByBook[b.id]?.lastRead || 0) - (progressByBook[a.id]?.lastRead || 0))[0]
    ), [books, progressByBook]);

    const allTags = useMemo(() => (
        Array.from(new Set(books.flatMap((book) => book.tags || []))).sort((a, b) => a.localeCompare(b))
    ), [books]);

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
            deleteCachedBook(book.url).catch((err) => {
                console.warn("Could not delete cached book file:", err);
            });
            deleteCachedBookMetadata(book.id);
            setDeleteTarget(null);
        } catch (err) {
            console.error("Error deleting book:", err);
            setError("Could not delete this book. Try again in a moment.");
        } finally {
            setDeletingId(null);
        }
    };

    const toggleOffline = async (book: Book) => {
        setOfflineBusyId(book.id);

        try {
            if (offlineByBook[book.id]) {
                await deleteCachedBook(book.url);
                setOfflineByBook((current) => ({ ...current, [book.id]: false }));
            } else {
                await cacheBookFromUrl(book.url);
                setOfflineByBook((current) => ({ ...current, [book.id]: true }));
            }
        } catch (err) {
            console.error("Offline cache action failed:", err);
            setError("Could not update offline copy. Try again in a moment.");
        } finally {
            setOfflineBusyId(null);
        }
    };

    const saveTags = async (book: Book) => {
        const tags = (tagDrafts[book.id] || "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, 8);

        try {
            await updateDoc(doc(db, "books", book.id), { tags });
        } catch (err) {
            console.error("Could not save tags:", err);
            setError("Could not save tags.");
        }
    };

    const formatLastRead = (timestamp?: number) => {
        if (!timestamp) return "Not started";

        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }).format(timestamp);
    };

    if (loading) return <div className={styles.status}>Loading library...</div>;
    if (error && books.length === 0) return <div className={styles.status}>{error}</div>;

    return (
        <>
            {error && <div className={styles.inlineError}>{error}</div>}
            {continueBook && (
                <section className={styles.continuePanel}>
                    <div>
                        <span>Continue reading</span>
                        <h3>{continueBook.title}</h3>
                        <p>{Math.round(progressByBook[continueBook.id]?.percentage || 0)}% read · {formatLastRead(progressByBook[continueBook.id]?.lastRead)}</p>
                    </div>
                    <Link href={`/read/${continueBook.id}`}>Resume</Link>
                </section>
            )}
            <div className={styles.toolbar}>
                <label>
                    <span>Sort</span>
                    <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                        <option value="recent">Recent</option>
                        <option value="title">Title</option>
                        <option value="author">Author</option>
                        <option value="progress">Progress</option>
                    </select>
                </label>
                <label>
                    <span>Tag</span>
                    <select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)}>
                        <option value="">All</option>
                        {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                    </select>
                </label>
                <div className={styles.segmented}>
                    <button type="button" className={viewMode === "grid" ? styles.activeSegment : ""} onClick={() => setViewMode("grid")}>Grid</button>
                    <button type="button" className={viewMode === "list" ? styles.activeSegment : ""} onClick={() => setViewMode("list")}>List</button>
                </div>
                {syncPending && <span className={styles.syncBadge}>Progress pending sync</span>}
            </div>
            <div className={`${styles.grid} ${viewMode === "list" ? styles.list : ""}`}>
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
                            <span className={`${styles.offlineBadge} ${offlineByBook[book.id] ? styles.offlineReady : ""}`}>
                                {offlineByBook[book.id] ? "Offline" : "Online"}
                            </span>
                        </Link>
                        <div className={styles.info}>
                            <h4 className={styles.title} title={book.title}>{book.title}</h4>
                            <p className={styles.author}>{book.author}</p>
                            <div className={styles.progressBlock}>
                                <div>
                                    <span>{Math.round(progressByBook[book.id]?.percentage || 0)}%</span>
                                    <span>{formatLastRead(progressByBook[book.id]?.lastRead)}</span>
                                </div>
                                <div className={styles.progressTrack}>
                                    <span style={{ width: `${Math.round(progressByBook[book.id]?.percentage || 0)}%` }} />
                                </div>
                            </div>
                            <div className={styles.tagEditor}>
                                <input
                                    type="text"
                                    value={tagDrafts[book.id] || ""}
                                    onChange={(event) => setTagDrafts((current) => ({ ...current, [book.id]: event.target.value }))}
                                    onBlur={() => saveTags(book)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.currentTarget.blur();
                                        }
                                    }}
                                    placeholder="Tags, comma separated"
                                />
                            </div>
                            <div className={styles.actions}>
                                <Link href={`/read/${book.id}`} className={styles.readBtn}>
                                    Read
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => toggleOffline(book)}
                                    className={styles.offlineBtn}
                                    disabled={offlineBusyId === book.id}
                                >
                                    {offlineBusyId === book.id ? "Saving" : offlineByBook[book.id] ? "Remove offline" : "Save offline"}
                                </button>
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
