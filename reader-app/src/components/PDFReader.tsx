"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { DocumentCallback } from "react-pdf/dist/shared/types.js";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { loadBackendServices } from "@/backend";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { getCachedBookBlob } from "@/utils/bookCache";
import { addBookmark, deleteBookmark, getBookmarks, loadBookmarks, updateBookmarkNote } from "@/utils/bookmarks";
import { getPdfSettings, loadPdfSettings, savePdfSettings } from "@/utils/readerSettings";
import { addHighlight, deleteHighlight, loadHighlights } from "@/utils/highlights";
import { getLocalProgress, saveReadingProgress, syncPendingProgress } from "@/utils/readingProgress";
import { HighlightRect, PdfReaderSettings, ReaderBookmark, ReaderHighlight } from "@/types";
import styles from "./PDFReader.module.css";

// Set worker source
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
).toString();

type PdfOutlineItem = {
    title: string;
    dest: string | unknown[] | null;
    items?: PdfOutlineItem[];
    pageNumber?: number;
    key?: string;
};

type PdfSearchResult = {
    page: number;
    snippet: string;
};

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : "Unknown PDF error";

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
const HIGHLIGHT_COLOR = "#ffe08a";

const flattenOutline = (items: PdfOutlineItem[]): PdfOutlineItem[] => (
    items.flatMap((item) => [item, ...flattenOutline(item.items || [])])
);

export default function PDFReader({ url, cacheKey, bookId, mimeType }: { url: string; cacheKey: string; bookId: string; mimeType?: string }) {
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageNumber, setPageNumber] = useState<number>(1);
    const [pdfDocument, setPdfDocument] = useState<DocumentCallback | null>(null);
    const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
    const [outlineLoading, setOutlineLoading] = useState(false);
    const [isOutlineOpen, setIsOutlineOpen] = useState(false);
    const [pageWidth, setPageWidth] = useState(800);
    const [pdfError, setPdfError] = useState<string | null>(null);
    const [pdfFileUrl, setPdfFileUrl] = useState<string | null>(null);
    const [cacheStatus, setCacheStatus] = useState("Loading file");
    const [settings, setSettings] = useState<PdfReaderSettings>(() => getPdfSettings());
    const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
    const [highlights, setHighlights] = useState<ReaderHighlight[]>([]);
    const [bookmarkNote, setBookmarkNote] = useState("");
    const [highlightNote, setHighlightNote] = useState("");
    const [selectionDraft, setSelectionDraft] = useState<{
        selectedText: string;
        rects: HighlightRect[];
        page: number;
        x: number;
        y: number;
    } | null>(null);
    const [selectionNote, setSelectionNote] = useState("");
    const [expandedHighlightId, setExpandedHighlightId] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<PdfSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const documentContainerRef = useRef<HTMLDivElement | null>(null);
    const { user } = useAuth();
    const { theme } = useTheme();
    const isDarkMode = theme === 'dark';
    const progressPercent = numPages ? clampPercent((pageNumber / numPages) * 100) : 0;
    const activeOutlineKey = useMemo(() => {
        const flattenedItems = flattenOutline(outline).filter((item) => item.pageNumber && item.key);
        const samePageItem = flattenedItems.find((item) => item.pageNumber === pageNumber);

        if (samePageItem) {
            return samePageItem.key || "";
        }

        const candidates = flattenedItems
            .filter((item) => item.pageNumber && item.pageNumber < pageNumber)
            .sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));

        return candidates.at(-1)?.key || "";
    }, [outline, pageNumber]);

    useEffect(() => {
        if (!user) return;
        setBookmarks(getBookmarks(user.uid, bookId));
        loadBookmarks(user, bookId).then(setBookmarks);
        loadHighlights(user, bookId).then(setHighlights);
    }, [bookId, user]);

    useEffect(() => {
        if (!user) return;
        loadPdfSettings(user).then(setSettings);
    }, [user]);

    useEffect(() => {
        savePdfSettings(user, settings).catch((err) => {
            console.warn("Could not save PDF settings:", err);
        });
    }, [settings, user]);

    useEffect(() => {
        syncPendingProgress(user);
        const sync = () => syncPendingProgress(user);
        window.addEventListener("online", sync);

        return () => window.removeEventListener("online", sync);
    }, [user]);

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;

        const loadPdfFile = async () => {
            try {
                setPdfError(null);
                setPdfFileUrl(null);
                setCacheStatus("Loading file");

                if (!user) return;
                const { blob, source } = await getCachedBookBlob(user.uid, cacheKey, url);
                const pdfBlob = mimeType && blob.type !== mimeType
                    ? blob.slice(0, blob.size, mimeType)
                    : blob;
                objectUrl = URL.createObjectURL(pdfBlob);

                if (cancelled) {
                    URL.revokeObjectURL(objectUrl);
                    return;
                }

                setCacheStatus(source === "cache" ? "Offline ready" : "Saved offline");
                setPdfFileUrl(objectUrl);
            } catch (err) {
                console.error("Failed to load PDF file:", err);
                if (!cancelled) {
                    setPdfError(`${getErrorMessage(err)}. Check that the library file service is reachable.`);
                }
            }
        };

        loadPdfFile();

        return () => {
            cancelled = true;
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [cacheKey, mimeType, url, user]);

    const resolveOutlinePage = async (pdf: DocumentCallback, item: PdfOutlineItem) => {
        if (!item.dest) return undefined;

        const explicitDest = typeof item.dest === "string"
            ? await pdf.getDestination(item.dest)
            : item.dest;

        if (!Array.isArray(explicitDest) || !explicitDest[0]) return undefined;

        const pageRef = explicitDest[0];

        if (typeof pageRef === "number") {
            return pageRef >= 0 && pageRef < pdf.numPages ? pageRef + 1 : pageRef;
        }

        const pageIndex = await pdf.getPageIndex(pageRef);
        return pageIndex + 1;
    };

    const getOutlineDestKey = (dest: PdfOutlineItem["dest"]) => {
        if (!dest) return "no-dest";
        if (typeof dest === "string") return dest;
        return dest.map((part) => {
            if (part && typeof part === "object" && "num" in part && "gen" in part) {
                const ref = part as { num: number; gen: number };
                return `${ref.num}r${ref.gen}`;
            }

            return typeof part === "object" ? JSON.stringify(part) : String(part);
        }).join(":");
    };

    const getOutlineKey = (item: PdfOutlineItem, parentKey: string, pageNumber?: number) => {
        const titleKey = (item.title || "untitled").trim().toLowerCase();
        return `${parentKey}/${titleKey}/${getOutlineDestKey(item.dest)}/${pageNumber || "unknown"}`;
    };

    const enrichOutlineItems = async (
        pdf: DocumentCallback,
        items: PdfOutlineItem[],
        parentKey = "outline"
    ): Promise<PdfOutlineItem[]> => Promise.all(items.map(async (item) => {
        let targetPage: number | undefined;

        try {
            targetPage = await resolveOutlinePage(pdf, item);
        } catch (err) {
            console.warn("Failed to resolve PDF outline page:", err);
        }

        const key = getOutlineKey(item, parentKey, targetPage);

        return {
            ...item,
            key,
            pageNumber: targetPage,
            items: item.items ? await enrichOutlineItems(pdf, item.items, key) : undefined,
        };
    }));

    async function onDocumentLoadSuccess(pdf: DocumentCallback) {
        setPdfError(null);
        setPdfDocument(pdf);
        setNumPages(pdf.numPages);
        setOutlineLoading(true);

        try {
            const loadedOutline = await pdf.getOutline();
            setOutline(await enrichOutlineItems(pdf, (loadedOutline || []) as PdfOutlineItem[]));
        } catch (err) {
            console.error("Failed to load PDF outline:", err);
            setOutline([]);
        } finally {
            setOutlineLoading(false);
        }
    }

    // Load progress
    useEffect(() => {
        if (!user) return;
        const loadProgress = async () => {
            try {
                const { readerData } = await loadBackendServices();
                const savedProgress = await readerData.getProgress(user.uid, bookId);
                if (savedProgress?.location) {
                    setPageNumber(Number(savedProgress.location));
                    return;
                }
            } catch (err) {
                console.warn("Could not load remote progress, checking local progress:", err);
            }

            const localProgress = getLocalProgress(user.uid, bookId);
            if (localProgress?.location) setPageNumber(Number(localProgress.location));
        };
        loadProgress();
    }, [user, bookId]);

    const changePage = (offset: number) => {
        const newPage = Math.min(Math.max(1, pageNumber + offset), numPages || 1);
        setPageNumber(newPage);
        saveProgress(newPage);
    };

    const saveProgress = async (page: number) => {
        await saveReadingProgress(user, {
            bookId,
            location: page,
            percentage: numPages ? clampPercent((page / numPages) * 100) : undefined,
            lastRead: Date.now(),
        });
    };

    const goToPage = (page: number) => {
        const safePage = Math.min(Math.max(1, page), numPages || 1);
        setPageNumber(safePage);
        saveProgress(safePage);
        setIsOutlineOpen(false);
    };

    const goToOutlineItem = async (item: PdfOutlineItem) => {
        if (!pdfDocument || !item.dest) return;

        try {
            const explicitDest = typeof item.dest === "string"
                ? await pdfDocument.getDestination(item.dest)
                : item.dest;

            if (!Array.isArray(explicitDest) || !explicitDest[0]) return;

            const pageRef = explicitDest[0];
            let targetPage: number | null = null;

            if (typeof pageRef === "number") {
                targetPage = pageRef >= 0 && pageRef < (numPages || 0) ? pageRef + 1 : pageRef;
            } else {
                const pageIndex = await pdfDocument.getPageIndex(pageRef);
                targetPage = pageIndex + 1;
            }

            if (targetPage) {
                goToPage(targetPage);
            }
        } catch (err) {
            console.error("Failed to navigate PDF outline item:", err);
        }
    };

    const handleAddBookmark = async () => {
        const bookmark = await addBookmark(user, {
            bookId,
            label: `Page ${pageNumber}`,
            note: bookmarkNote.trim(),
            location: pageNumber,
            percentage: progressPercent,
        });

        setBookmarks((current) => [bookmark, ...current]);
        setBookmarkNote("");
    };

    const handleBookmarkNote = async (bookmarkId: string, note: string) => {
        setBookmarks(await updateBookmarkNote(user, bookId, bookmarkId, note));
    };

    const handleDeleteBookmark = async (bookmarkId: string) => {
        setBookmarks(await deleteBookmark(user, bookId, bookmarkId));
    };

    const handleAddHighlight = async () => {
        const highlight = await addHighlight(user, {
            bookId,
            label: `Page ${pageNumber}`,
            text: `Page ${pageNumber}`,
            note: highlightNote.trim(),
            location: pageNumber,
            selectedText: `Page ${pageNumber}`,
            percentage: progressPercent,
            color: HIGHLIGHT_COLOR,
        });

        setHighlights((current) => [highlight, ...current]);
        setHighlightNote("");
    };

    const handleDeleteHighlight = async (highlightId: string) => {
        setHighlights(await deleteHighlight(user, bookId, highlightId));
    };

    const getSelectionRects = (range: Range) => {
        const container = documentContainerRef.current;
        if (!container) return [] as HighlightRect[];

        const pageFrames = Array.from(container.querySelectorAll<HTMLElement>("[data-pdf-page]"));
        const rects: HighlightRect[] = [];

        Array.from(range.getClientRects()).forEach((rect) => {
            if (rect.width < 2 || rect.height < 2) return;

            const pageFrame = pageFrames.find((frame) => {
                const pageRect = frame.getBoundingClientRect();
                return rect.right > pageRect.left &&
                    rect.left < pageRect.right &&
                    rect.bottom > pageRect.top &&
                    rect.top < pageRect.bottom;
            });
            if (!pageFrame) return;

            const pageRect = pageFrame.getBoundingClientRect();
            const page = Number(pageFrame.dataset.pdfPage);
            const left = Math.max(rect.left, pageRect.left) - pageRect.left;
            const top = Math.max(rect.top, pageRect.top) - pageRect.top;
            const right = Math.min(rect.right, pageRect.right) - pageRect.left;
            const bottom = Math.min(rect.bottom, pageRect.bottom) - pageRect.top;

            rects.push({
                page,
                x: (left / pageRect.width) * 100,
                y: (top / pageRect.height) * 100,
                width: ((right - left) / pageRect.width) * 100,
                height: ((bottom - top) / pageRect.height) * 100,
            });
        });

        return rects;
    };

    const handlePdfSelectionMouseUp = () => {
        const container = documentContainerRef.current;
        const selection = window.getSelection();
        const selectedText = selection?.toString().replace(/\s+/g, " ").trim();

        if (!container || !selection || !selectedText || selection.rangeCount === 0) {
            setSelectionDraft(null);
            return;
        }

        const range = selection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) {
            setSelectionDraft(null);
            return;
        }

        const rects = getSelectionRects(range);
        if (rects.length === 0) {
            setSelectionDraft(null);
            return;
        }

        const firstRect = range.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const composerMaxLeft = Math.max(12, container.clientWidth - 340);

        setSelectionDraft({
            selectedText,
            rects,
            page: rects[0].page,
            x: Math.min(composerMaxLeft, Math.max(12, firstRect.left - containerRect.left + container.scrollLeft)),
            y: Math.max(12, firstRect.bottom - containerRect.top + container.scrollTop),
        });
        setSelectionNote("");
    };

    const handleSaveSelectionHighlight = async () => {
        if (!selectionDraft) return;

        const highlight = await addHighlight(user, {
            bookId,
            label: `Page ${selectionDraft.page}`,
            text: selectionDraft.selectedText,
            note: selectionNote.trim(),
            location: selectionDraft.page,
            selectedText: selectionDraft.selectedText,
            rects: selectionDraft.rects,
            percentage: numPages ? clampPercent((selectionDraft.page / numPages) * 100) : progressPercent,
            color: HIGHLIGHT_COLOR,
        });

        setHighlights((current) => [highlight, ...current]);
        setSelectionDraft(null);
        setSelectionNote("");
        window.getSelection()?.removeAllRanges();
    };

    const handleSearch = async () => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        if (!pdfDocument || !normalizedQuery || !numPages) return;

        setSearching(true);
        setSearchResults([]);

        try {
            const results: PdfSearchResult[] = [];

            for (let page = 1; page <= numPages && results.length < 30; page++) {
                const pdfPage = await pdfDocument.getPage(page);
                const content = await pdfPage.getTextContent();
                const text = (content.items as Array<{ str?: string }>)
                    .map((item) => item.str || "")
                    .join(" ")
                    .replace(/\s+/g, " ");
                const index = text.toLowerCase().indexOf(normalizedQuery);

                if (index >= 0) {
                    const start = Math.max(0, index - 60);
                    const end = Math.min(text.length, index + normalizedQuery.length + 90);
                    results.push({
                        page,
                        snippet: `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`,
                    });
                }
            }

            setSearchResults(results);
        } catch (err) {
            console.error("PDF search failed:", err);
        } finally {
            setSearching(false);
        }
    };

    const renderOutlineItems = (items: PdfOutlineItem[], depth = 0) => (
        <ul className={depth === 0 ? styles.outlineList : styles.outlineNestedList}>
            {items.map((item) => (
                <li key={item.key || item.title} className={styles.outlineItem}>
                    <button
                        type="button"
                        className={`${styles.outlineLink} ${item.key === activeOutlineKey ? styles.outlineLinkActive : ""}`}
                        aria-current={item.key === activeOutlineKey ? "location" : undefined}
                        style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
                        onClick={() => goToOutlineItem(item)}
                        disabled={!item.dest}
                    >
                        <span>{item.title || "Untitled section"}</span>
                    </button>
                    {item.items && item.items.length > 0 && renderOutlineItems(item.items, depth + 1)}
                </li>
            ))}
        </ul>
    );

    useEffect(() => {
        const updatePageWidth = () => {
            const containerWidth = documentContainerRef.current?.clientWidth || window.innerWidth;
            setPageWidth(Math.max(280, Math.min(800, containerWidth - 32)));
        };

        updatePageWidth();
        window.addEventListener("resize", updatePageWidth);

        return () => window.removeEventListener("resize", updatePageWidth);
    }, [settings.zoom]);

    const renderedPageWidth = Math.round(pageWidth * settings.zoom);

    const renderPdfHighlights = (page: number) => (
        <div className={styles.highlightOverlay}>
            {highlights
                .filter((highlight) => (highlight.rects || []).some((rect) => rect.page === page))
                .map((highlight) => {
                    const pageRects = (highlight.rects || []).filter((rect) => rect.page === page);
                    return (
                        <div key={highlight.id} className={styles.pdfHighlightGroup}>
                            {pageRects.map((rect, index) => (
                                <button
                                    key={`${highlight.id}-${index}`}
                                    type="button"
                                    className={styles.pdfHighlightRect}
                                    style={{
                                        left: `${rect.x}%`,
                                        top: `${rect.y}%`,
                                        width: `${rect.width}%`,
                                        height: `${rect.height}%`,
                                        backgroundColor: highlight.color || HIGHLIGHT_COLOR,
                                    }}
                                    onClick={() => setExpandedHighlightId((current) => current === highlight.id ? "" : highlight.id)}
                                    aria-label={highlight.note || highlight.text}
                                />
                            ))}
                            {expandedHighlightId === highlight.id && pageRects[0] && (
                                <div
                                    className={styles.pdfComment}
                                    style={{
                                        left: `${Math.min(pageRects[0].x, 72)}%`,
                                        top: `${Math.min(pageRects[0].y + pageRects[0].height + 1, 88)}%`,
                                    }}
                                >
                                    <strong>{highlight.label}</strong>
                                    {highlight.selectedText && <blockquote>{highlight.selectedText}</blockquote>}
                                    {highlight.note && <p>{highlight.note}</p>}
                                    <button type="button" onClick={() => handleDeleteHighlight(highlight.id)}>Delete</button>
                                </div>
                            )}
                        </div>
                    );
                })}
        </div>
    );

    const renderPdfPage = (page: number) => (
        <div key={page} className={styles.pageFrame} data-pdf-page={page}>
            <div
                className={styles.pageCanvas}
                style={{ filter: isDarkMode ? 'invert(0.9) hue-rotate(180deg)' : 'none' }}
            >
                <Page pageNumber={page} width={renderedPageWidth} />
            </div>
            {renderPdfHighlights(page)}
        </div>
    );

    return (
        <div className={styles.container} style={{ backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5', color: isDarkMode ? '#fff' : 'inherit' }}>
            <div className={styles.controls} style={{ color: isDarkMode ? '#fff' : 'inherit' }}>
                <button
                    type="button"
                    onClick={() => setIsOutlineOpen((open) => !open)}
                    disabled={outlineLoading || outline.length === 0}
                >
                    Contents
                </button>
                <button disabled={pageNumber <= 1} onClick={() => changePage(-1)}>
                    Previous
                </button>
                <span style={{ margin: '0 10px', color: isDarkMode ? '#fff' : 'inherit' }}>
                    Page {pageNumber} of {numPages}
                </span>
                <button disabled={pageNumber >= (numPages || 0)} onClick={() => changePage(1)}>
                    Next
                </button>
            </div>
            <div className={styles.readerBody}>
                {isOutlineOpen && (
                    <aside className={styles.outlinePanel} aria-label="PDF contents">
                        <div className={styles.outlineHeader}>
                            <h2>Contents</h2>
                            <button type="button" onClick={() => setIsOutlineOpen(false)}>
                                Close
                            </button>
                        </div>
                        <div className={styles.progressGroup} aria-label={`Reading progress ${progressPercent}%`}>
                            <div className={styles.progressMeta}>
                                <span>{progressPercent}%</span>
                                <span>{cacheStatus}</span>
                            </div>
                            <div className={styles.progressTrack}>
                                <span
                                    className={styles.progressFill}
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                        </div>
                        <section className={styles.panelSection}>
                            <h3>Settings</h3>
                            <label className={styles.settingRow}>
                                <span>Zoom</span>
                                <input
                                    type="range"
                                    min="0.7"
                                    max="1.6"
                                    step="0.1"
                                    value={settings.zoom}
                                    onChange={(event) => setSettings((current) => ({ ...current, zoom: Number(event.target.value) }))}
                                />
                                <strong>{Math.round(settings.zoom * 100)}%</strong>
                            </label>
                            <label className={styles.settingRow}>
                                <span>Pages</span>
                                <select
                                    value={settings.pageMode}
                                    onChange={(event) => setSettings((current) => ({ ...current, pageMode: event.target.value as PdfReaderSettings["pageMode"] }))}
                                >
                                    <option value="single">Single</option>
                                    <option value="continuous">Continuous</option>
                                </select>
                            </label>
                        </section>
                        <section className={styles.panelSection}>
                            <h3>Search</h3>
                            <div className={styles.searchRow}>
                                <input
                                    type="search"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") handleSearch();
                                    }}
                                    placeholder="Search this PDF"
                                />
                                <button type="button" onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
                                    {searching ? "Searching" : "Find"}
                                </button>
                            </div>
                            <div className={styles.resultList}>
                                {searchResults.map((result) => (
                                    <button key={`${result.page}-${result.snippet}`} type="button" onClick={() => goToPage(result.page)}>
                                        <strong>Page {result.page}</strong>
                                        <span>{result.snippet}</span>
                                    </button>
                                ))}
                                {!searching && searchQuery && searchResults.length === 0 && <p>No matches yet.</p>}
                            </div>
                        </section>
                        <section className={styles.panelSection}>
                            <h3>Bookmarks</h3>
                            <div className={styles.searchRow}>
                                <input
                                    type="text"
                                    value={bookmarkNote}
                                    onChange={(event) => setBookmarkNote(event.target.value)}
                                    placeholder="Optional note"
                                />
                                <button type="button" onClick={handleAddBookmark}>Add</button>
                            </div>
                            <div className={styles.bookmarkList}>
                                {bookmarks.map((bookmark) => (
                                    <div key={bookmark.id} className={styles.bookmarkItem}>
                                        <button type="button" onClick={() => goToPage(Number(bookmark.location))}>
                                            {bookmark.label}
                                        </button>
                                        <input
                                            type="text"
                                            value={bookmark.note}
                                            onChange={(event) => handleBookmarkNote(bookmark.id, event.target.value)}
                                            placeholder="Note"
                                        />
                                        <button type="button" onClick={() => handleDeleteBookmark(bookmark.id)}>Delete</button>
                                    </div>
                                ))}
                                {bookmarks.length === 0 && <p>No bookmarks yet.</p>}
                            </div>
                        </section>
                        <section className={styles.panelSection}>
                            <h3>Highlights</h3>
                            <div className={styles.searchRow}>
                                <input
                                    type="text"
                                    value={highlightNote}
                                    onChange={(event) => setHighlightNote(event.target.value)}
                                    placeholder="Note for this page"
                                />
                                <button type="button" onClick={handleAddHighlight}>Add</button>
                            </div>
                            <div className={styles.bookmarkList}>
                                {highlights.map((highlight) => (
                                    <div key={highlight.id} className={styles.bookmarkItem}>
                                        <button type="button" onClick={() => goToPage(Number(highlight.location))}>
                                            {highlight.label}
                                        </button>
                                        <span>{highlight.note || highlight.text}</span>
                                        <button type="button" onClick={() => handleDeleteHighlight(highlight.id)}>Delete</button>
                                    </div>
                                ))}
                                {highlights.length === 0 && <p>No highlights yet.</p>}
                            </div>
                        </section>
                        {outline.length > 0 ? renderOutlineItems(outline) : <p className={styles.outlineEmpty}>No contents found.</p>}
                    </aside>
                )}
                <div className={styles.document} ref={documentContainerRef} onMouseUp={handlePdfSelectionMouseUp}>
                    {pdfError && (
                        <p className={styles.errorMessage}>
                            {pdfError}
                        </p>
                    )}
                    {pdfFileUrl ? (
                        <>
                        {selectionDraft && (
                            <div
                                className={styles.selectionComposer}
                                style={{ left: selectionDraft.x, top: selectionDraft.y }}
                                onMouseUp={(event) => event.stopPropagation()}
                            >
                                <strong>Highlight</strong>
                                <span>{selectionDraft.selectedText}</span>
                                <textarea
                                    value={selectionNote}
                                    onChange={(event) => setSelectionNote(event.target.value)}
                                    placeholder="Comment on this passage"
                                />
                                <div>
                                    <button type="button" onClick={() => setSelectionDraft(null)}>Cancel</button>
                                    <button type="button" onClick={handleSaveSelectionHighlight}>Save</button>
                                </div>
                            </div>
                        )}
                        <Document
                            file={pdfFileUrl}
                            onLoadSuccess={onDocumentLoadSuccess}
                            onLoadError={(err) => {
                                console.error("Failed to load PDF:", err);
                                setPdfError(`${getErrorMessage(err)}. Check Firebase Storage CORS if this only happens after deployment.`);
                            }}
                            className={styles.pdfDoc}
                        >
                            {settings.pageMode === "continuous" && numPages ? (
                                Array.from({ length: numPages }, (_, index) => renderPdfPage(index + 1))
                            ) : (
                                renderPdfPage(pageNumber)
                            )}
                        </Document>
                        </>
                    ) : !pdfError && (
                        <p className={styles.loadingMessage}>Loading PDF file...</p>
                    )}
                </div>
            </div>
        </div>
    );
}
