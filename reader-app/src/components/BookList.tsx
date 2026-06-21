"use client";
import { useEffect, useMemo, useState } from "react";
import { collection, query, onSnapshot, orderBy, doc, deleteDoc, where } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import Image from "next/image";
import Link from "next/link";
import { db, storage } from "@/firebase/config";
import { Book, ReadingProgress } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { cacheBookFromUrl, deleteCachedBook, isBookCached } from "@/utils/bookCache";
import { cacheBookMetadata, deleteCachedBookMetadata } from "@/utils/bookMetadataCache";
import { getAllLocalProgress, hasPendingProgress, syncPendingProgress } from "@/utils/readingProgress";
import { getBookCacheKey, resolveBookUrl, resolveCoverUrl } from "@/utils/bookFiles";

type BookListProps = {
    searchQuery?: string;
};

type SortMode = "recent" | "title" | "author" | "progress";
type ViewMode = "grid" | "list";

const getStorageTarget = (path?: string, url?: string) => path || url || "";
const selectClass = "min-h-9 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-sm text-[var(--foreground)]";
const actionButtonClass = "inline-flex min-h-10 flex-1 items-center justify-center rounded-lg px-3 text-center text-sm font-bold";

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
    const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
    const [selectedTag, setSelectedTag] = useState("all");
    const [sortMode, setSortMode] = useState<SortMode>("recent");
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
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
                booksData.forEach((book) => cacheBookMetadata(user.uid, book));
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
        if (!user) return;
        let cancelled = false;

        const refreshOfflineStatus = async () => {
            const entries = await Promise.all(books.map(async (book) => [book.id, await isBookCached(user.uid, getBookCacheKey(book))] as const));
            if (!cancelled) {
                setOfflineByBook(Object.fromEntries(entries));
            }
        };

        refreshOfflineStatus();

        return () => {
            cancelled = true;
        };
    }, [books, user]);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;

        const loadCovers = async () => {
            const entries = await Promise.all(books.map(async (book) => {
                try {
                    return [book.id, await resolveCoverUrl(book)] as const;
                } catch {
                    return [book.id, ""] as const;
                }
            }));

            if (!cancelled) {
                setCoverUrls(Object.fromEntries(entries));
            }
        };

        loadCovers();

        return () => {
            cancelled = true;
        };
    }, [books, user]);

    const allTags = useMemo(() => (
        Array.from(new Set(books.flatMap((book) => book.tags || []))).sort((a, b) => a.localeCompare(b))
    ), [books]);

    const filteredBooks = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        let nextBooks = selectedTag === "all"
            ? books
            : books.filter((book) => (book.tags || []).includes(selectedTag));

        if (normalizedQuery) {
            nextBooks = nextBooks.filter((book) =>
                `${book.title} ${book.author} ${book.format} ${(book.tags || []).join(" ")} ${book.notes || ""}`.toLowerCase().includes(normalizedQuery)
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
            deleteCachedBook(user?.uid, getBookCacheKey(book)).catch((err) => {
                console.warn("Could not delete cached book file:", err);
            });
            if (user) deleteCachedBookMetadata(user.uid, book.id);
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
                await deleteCachedBook(user?.uid, getBookCacheKey(book));
                setOfflineByBook((current) => ({ ...current, [book.id]: false }));
            } else {
                if (!user) return;
                const url = await resolveBookUrl(book);
                await cacheBookFromUrl(user.uid, getBookCacheKey(book), url);
                setOfflineByBook((current) => ({ ...current, [book.id]: true }));
            }
        } catch (err) {
            console.error("Offline cache action failed:", err);
            setError("Could not update offline copy. Try again in a moment.");
        } finally {
            setOfflineBusyId(null);
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

    if (loading) return <div className="rounded-lg border border-[var(--card-border)] bg-[var(--surface)] p-4 text-[var(--muted)]">Loading library...</div>;
    if (error && books.length === 0) return <div className="rounded-lg border border-[var(--card-border)] bg-[var(--surface)] p-4 text-[var(--muted)]">{error}</div>;

    return (
        <>
            {error && <div className="mb-4 rounded-lg border border-[var(--card-border)] bg-[var(--surface)] p-4 text-[var(--danger)]">{error}</div>}
            {continueBook && (
                <section className="mb-4 flex flex-col gap-3 rounded-lg border border-[var(--card-border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <span className="text-xs font-black uppercase text-[var(--accent)]">Continue reading</span>
                        <h3 className="mb-1 mt-1 text-base font-extrabold">{continueBook.title}</h3>
                        <p className="m-0 text-sm text-[var(--muted)]">{Math.round(progressByBook[continueBook.id]?.percentage || 0)}% read - {formatLastRead(progressByBook[continueBook.id]?.lastRead)}</p>
                    </div>
                    <Link href={`/read/${continueBook.id}`} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-extrabold text-white hover:bg-[var(--primary-strong)]">
                        Resume
                    </Link>
                </section>
            )}

            <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-extrabold text-[var(--muted)]">
                    <span>Tag</span>
                    <select className={selectClass} value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)}>
                        <option value="all">All</option>
                        {allTags.map((tag) => (
                            <option key={tag} value={tag}>{tag}</option>
                        ))}
                    </select>
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-extrabold text-[var(--muted)]">
                    <span>Sort</span>
                    <select className={selectClass} value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                        <option value="recent">Recent</option>
                        <option value="title">Title</option>
                        <option value="author">Author</option>
                        <option value="progress">Progress</option>
                    </select>
                </label>
                <div className="inline-flex overflow-hidden rounded-lg border border-[var(--card-border)]">
                    <button type="button" className={`min-h-9 px-3 text-sm font-extrabold ${viewMode === "grid" ? "bg-[var(--secondary)] text-[var(--foreground)]" : "text-[var(--muted)]"}`} onClick={() => setViewMode("grid")}>
                        Grid
                    </button>
                    <button type="button" className={`min-h-9 px-3 text-sm font-extrabold ${viewMode === "list" ? "bg-[var(--secondary)] text-[var(--foreground)]" : "text-[var(--muted)]"}`} onClick={() => setViewMode("list")}>
                        List
                    </button>
                </div>
                {syncPending && <span className="rounded-lg bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-3 py-2 text-xs font-extrabold text-[var(--accent)]">Progress pending sync</span>}
            </div>

            <div className={viewMode === "list" ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]"}>
                {filteredBooks.map((book) => (
                    <article key={book.id} className={`overflow-hidden rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] transition hover:border-[rgba(36,92,122,0.32)] hover:shadow-[var(--shadow-md)] ${viewMode === "list" ? "grid grid-cols-[104px_minmax(0,1fr)] sm:grid-cols-[128px_minmax(0,1fr)]" : ""}`}>
                        <Link href={`/read/${book.id}`} className={`relative flex items-center justify-center bg-[linear-gradient(145deg,rgba(36,92,122,0.18),rgba(185,109,64,0.12)),var(--secondary)] text-center text-2xl font-extrabold uppercase text-[var(--muted)] ${viewMode === "list" ? "min-h-full" : "aspect-[3/4]"}`} aria-label={`Read ${book.title}`}>
                            {coverUrls[book.id] && !failedCovers[book.id] ? (
                                <Image
                                    src={coverUrls[book.id]}
                                    alt={book.title}
                                    fill
                                    unoptimized
                                    sizes="(max-width: 640px) 45vw, (max-width: 1100px) 25vw, 220px"
                                    className="object-cover"
                                    onError={() => setFailedCovers((current) => ({ ...current, [book.id]: true }))}
                                />
                            ) : (
                                <span className="max-w-[80%] break-words">{book.format === "pdf" ? "PDF" : "ePub"}</span>
                            )}
                            <span className="absolute bottom-2 right-2 rounded-md border border-[var(--card-border)] bg-[var(--surface)] px-2 py-1 text-[0.68rem] font-extrabold uppercase text-[var(--foreground)]">{book.format}</span>
                            <span className={`absolute bottom-2 left-2 rounded-md border border-[var(--card-border)] bg-[var(--surface)] px-2 py-1 text-[0.68rem] font-extrabold ${offlineByBook[book.id] ? "border-[#b59663] bg-[#ead8b7] text-[var(--primary-strong)]" : "text-[var(--muted)]"}`}>
                                {offlineByBook[book.id] ? "Offline" : "Online"}
                            </span>
                        </Link>
                        <div className="flex min-w-0 flex-col p-4">
                            <h4 className="m-0 truncate text-base font-extrabold leading-snug" title={book.title}>{book.title}</h4>
                            <p className="mb-3 mt-1 min-h-5 truncate text-sm text-[var(--muted)]">{book.author}</p>
                            {book.tags && book.tags.length > 0 && (
                                <div className="mb-3 flex min-h-6 flex-wrap gap-1">
                                    {book.tags.slice(0, 3).map((tag) => (
                                        <span key={tag} className="rounded-md bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-2 py-1 text-xs font-extrabold text-[var(--primary-strong)]">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div className="mb-3 grid gap-2">
                                <div className="flex justify-between gap-2 text-xs font-extrabold text-[var(--muted)]">
                                    <span>{Math.round(progressByBook[book.id]?.percentage || 0)}%</span>
                                    <span>{formatLastRead(progressByBook[book.id]?.lastRead)}</span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--muted)_20%,transparent)]">
                                    <span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.round(progressByBook[book.id]?.percentage || 0)}%` }} />
                                </div>
                            </div>
                            <div className="mt-auto flex flex-wrap items-center gap-2">
                                <Link href={`/read/${book.id}`} className={`${actionButtonClass} bg-[var(--primary)] text-white hover:bg-[var(--primary-strong)]`}>
                                    Read
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => toggleOffline(book)}
                                    className={`${actionButtonClass} min-w-28 border border-[var(--card-border)] bg-[var(--surface-raised)] text-[var(--foreground)] disabled:opacity-60 hover:bg-[var(--secondary)]`}
                                    disabled={offlineBusyId === book.id}
                                >
                                    {offlineBusyId === book.id ? "Saving" : offlineByBook[book.id] ? "Remove offline" : "Save offline"}
                                </button>
                                {user && user.uid === book.uploadedBy && (
                                    <button
                                        type="button"
                                        onClick={() => setDeleteTarget(book)}
                                        className="min-h-10 px-1 text-sm text-[var(--muted)] hover:text-[var(--danger)]"
                                    >
                                        Delete
                                    </button>
                                )}
                            </div>
                        </div>
                    </article>
                ))}
                {filteredBooks.length === 0 && (
                    <p className="rounded-lg border border-[var(--card-border)] bg-[var(--surface)] p-4 text-[var(--muted)]">
                        {books.length === 0 ? "No books yet. Add your first PDF or ePub." : "No books match your search."}
                    </p>
                )}
            </div>

            {deleteTarget && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4" role="presentation" onClick={() => setDeleteTarget(null)}>
                    <div className="w-full max-w-[420px] rounded-lg border border-[var(--card-border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-md)]" role="dialog" aria-modal="true" aria-labelledby="delete-book-title" onClick={(e) => e.stopPropagation()}>
                        <h3 id="delete-book-title" className="m-0 mb-2 text-lg font-extrabold">Delete book?</h3>
                        <p className="mb-5 mt-0 text-[var(--muted)]">{deleteTarget.title}</p>
                        <div className="flex justify-end gap-3">
                            <button type="button" className="min-h-10 rounded-lg border border-[var(--input-border)] px-4 font-bold text-[var(--foreground)]" onClick={() => setDeleteTarget(null)}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="min-h-10 rounded-lg bg-[var(--danger)] px-4 font-bold text-white disabled:opacity-60"
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
