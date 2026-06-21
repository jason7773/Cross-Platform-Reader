"use client";
import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { getCachedBookBlob } from "@/utils/bookCache";
import { addBookmark, deleteBookmark, getBookmarks, loadBookmarks, updateBookmarkNote } from "@/utils/bookmarks";
import { addHighlight, deleteHighlight, loadHighlights } from "@/utils/highlights";
import { searchEpub, EpubSearchResult } from "@/utils/epubSearch";
import { getEpubSettings, loadEpubSettings, saveEpubSettings } from "@/utils/readerSettings";
import { getLocalProgress, saveReadingProgress, syncPendingProgress } from "@/utils/readingProgress";
import { EpubReaderSettings, ReaderBookmark, ReaderHighlight } from "@/types";
import styles from "./EpubReader.module.css";

type EpubPanelMode = "toc" | "settings" | "search" | "bookmarks" | "highlights";

type EpubChapter = {
    href: string;
    label: string;
    paragraphs: string[];
};

type ManifestItem = {
    href: string;
    mediaType: string;
    properties: string;
};

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : "Unknown error";
const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
const formatProgress = (percentage: number | null) => percentage === null ? "Calculating" : `${percentage}%`;
const HIGHLIGHT_COLOR = "#ffe08a";

const resolveZipPath = (fromPath: string, href: string) => {
    const baseParts = fromPath.split("/");
    baseParts.pop();
    const hrefWithoutHash = href.split("#")[0];
    const parts = [...baseParts, ...hrefWithoutHash.split("/")];
    const resolved: string[] = [];

    parts.forEach((part) => {
        if (!part || part === ".") return;
        if (part === "..") {
            resolved.pop();
            return;
        }
        resolved.push(part);
    });

    return resolved.join("/");
};

const normalizePath = (href: string) => {
    try {
        return decodeURIComponent(href.split("#")[0]).replace(/^\/+/, "").toLowerCase();
    } catch {
        return href.split("#")[0].replace(/^\/+/, "").toLowerCase();
    }
};

const getOpfPath = async (zip: JSZip) => {
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) throw new Error("Invalid ePub: missing container.xml.");

    const containerText = await containerFile.async("string");
    const container = new DOMParser().parseFromString(containerText, "application/xml");
    const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
    if (!opfPath) throw new Error("Invalid ePub: missing package document.");
    return opfPath;
};

const getElementText = (element: Element | null | undefined) => (
    element?.textContent?.replace(/\s+/g, " ").trim() || ""
);

const extractReadableParagraphs = (html: string) => {
    const document = new DOMParser().parseFromString(html, "text/html");
    document.querySelectorAll("script, style, svg, iframe, object, embed").forEach((node) => node.remove());
    const blocks = Array.from(document.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre"))
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim())
        .filter(Boolean);

    if (blocks.length > 0) return blocks as string[];
    const fallback = document.body.textContent?.replace(/\s+/g, " ").trim();
    return fallback ? [fallback] : [];
};

const extractDocumentTitle = (html: string) => {
    const document = new DOMParser().parseFromString(html, "text/html");
    return getElementText(document.querySelector("h1,h2,h3,title"));
};

const prettyFileLabel = (href: string) => {
    const fileName = href.split("/").at(-1)?.replace(/\.(xhtml|html|htm)$/i, "") || "Chapter";
    return fileName
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([0-9])/gi, "$1 $2")
        .replace(/\bch\s*([0-9]+)/i, "Chapter $1")
        .trim() || "Chapter";
};

const parseNavLabels = async (zip: JSZip, opfPath: string, navHref?: string) => {
    if (!navHref) return new Map<string, string>();

    const navPath = resolveZipPath(opfPath, navHref);
    const navFile = zip.file(navPath);
    if (!navFile) return new Map<string, string>();

    const nav = new DOMParser().parseFromString(await navFile.async("string"), "text/html");
    const labels = new Map<string, string>();
    nav.querySelectorAll("a[href]").forEach((link) => {
        const href = link.getAttribute("href");
        const label = link.textContent?.replace(/\s+/g, " ").trim();
        if (href && label) {
            labels.set(normalizePath(resolveZipPath(navPath, href)), label);
        }
    });
    return labels;
};

const parseNcxLabels = async (zip: JSZip, opfPath: string, ncxHref?: string) => {
    if (!ncxHref) return new Map<string, string>();

    const ncxPath = resolveZipPath(opfPath, ncxHref);
    const ncxFile = zip.file(ncxPath);
    if (!ncxFile) return new Map<string, string>();

    const ncx = new DOMParser().parseFromString(await ncxFile.async("string"), "application/xml");
    const labels = new Map<string, string>();
    ncx.querySelectorAll("navPoint").forEach((point) => {
        const src = point.querySelector("content")?.getAttribute("src");
        const label = getElementText(point.querySelector("navLabel text"));
        if (src && label) {
            labels.set(normalizePath(resolveZipPath(ncxPath, src)), label);
        }
    });
    return labels;
};

const mergeLabels = (...maps: Array<Map<string, string>>) => {
    const labels = new Map<string, string>();
    maps.forEach((map) => {
        map.forEach((label, href) => labels.set(href, label));
    });
    return labels;
};

const findLabel = (labels: Map<string, string>, href: string) => {
    const normalized = normalizePath(href);
    const exact = labels.get(normalized);
    if (exact) return exact;

    for (const [labelHref, label] of labels.entries()) {
        if (labelHref === normalized || labelHref.endsWith(normalized) || normalized.endsWith(labelHref)) {
            return label;
        }
    }

    return "";
};

const isLikelyCoverOrUtilityPage = (href: string, item: ManifestItem, text: string) => {
    const normalized = normalizePath(href);
    const properties = item.properties.split(/\s+/);

    if (properties.includes("nav")) return true;
    if (text.length >= 40) return false;
    return /(^|\/)(cover|titlepage|toc|nav|contents?)(\.|\/|$)/i.test(normalized);
};

const loadChapters = async (data: ArrayBuffer) => {
    const zip = await JSZip.loadAsync(data);
    const opfPath = await getOpfPath(zip);
    const opfFile = zip.file(opfPath);
    if (!opfFile) throw new Error("Invalid ePub: package document not found.");

    const opf = new DOMParser().parseFromString(await opfFile.async("string"), "application/xml");
    const manifest = new Map<string, ManifestItem>();
    opf.querySelectorAll("manifest item").forEach((item) => {
        const id = item.getAttribute("id");
        const href = item.getAttribute("href");
        if (!id || !href) return;
        manifest.set(id, {
            href,
            mediaType: item.getAttribute("media-type") || "",
            properties: item.getAttribute("properties") || "",
        });
    });

    const navItem = Array.from(manifest.values()).find((item) => item.properties.split(/\s+/).includes("nav"));
    const ncxId = opf.querySelector("spine")?.getAttribute("toc");
    const ncxItem = ncxId ? manifest.get(ncxId) : Array.from(manifest.values()).find((item) => /ncx/i.test(item.mediaType));
    const labels = mergeLabels(
        await parseNcxLabels(zip, opfPath, ncxItem?.href),
        await parseNavLabels(zip, opfPath, navItem?.href)
    );
    const chapterRefs = Array.from(opf.querySelectorAll("spine itemref"))
        .filter((item) => item.getAttribute("linear") !== "no")
        .map((item) => item.getAttribute("idref"))
        .filter((idref): idref is string => Boolean(idref));

    const chapters: EpubChapter[] = [];
    for (const idref of chapterRefs) {
        const item = manifest.get(idref);
        if (!item || !/(xhtml|html)/i.test(item.mediaType)) continue;

        const href = resolveZipPath(opfPath, item.href);
        const chapterFile = zip.file(href);
        if (!chapterFile) continue;
        const html = await chapterFile.async("string");
        const paragraphs = extractReadableParagraphs(html);
        const text = paragraphs.join("\n\n");
        if (!text || isLikelyCoverOrUtilityPage(href, item, text)) continue;

        chapters.push({
            href,
            label: findLabel(labels, href) || extractDocumentTitle(html) || prettyFileLabel(href),
            paragraphs,
        });
    }

    if (chapters.length === 0) throw new Error("This ePub has no readable chapters.");
    return chapters;
};

const findChapterIndex = (chapters: EpubChapter[], href: string | number | null) => {
    if (typeof href !== "string") return 0;
    const normalized = normalizePath(href);
    const index = chapters.findIndex((chapter) => {
        const chapterPath = normalizePath(chapter.href);
        return chapterPath === normalized || chapterPath.endsWith(normalized) || normalized.endsWith(chapterPath);
    });
    return index >= 0 ? index : 0;
};

const getOccurrenceIndex = (text: string, selectedText: string, selectedOffset: number) => {
    if (!selectedText) return 0;

    let index = -1;
    let occurrence = 0;
    while (true) {
        index = text.indexOf(selectedText, index + 1);
        if (index < 0 || index >= selectedOffset) return occurrence;
        occurrence += 1;
    }
};

const findOccurrenceOffset = (text: string, selectedText: string, occurrence = 0) => {
    if (!selectedText) return -1;

    let index = -1;
    for (let i = 0; i <= occurrence; i++) {
        index = text.indexOf(selectedText, index + 1);
        if (index < 0) return -1;
    }
    return index;
};

const renderParagraphWithHighlights = (
    paragraph: string,
    highlights: ReaderHighlight[],
    onToggleComment: (id: string) => void,
    expandedId: string
) => {
    const ranges = highlights
        .map((highlight) => {
            const selectedText = highlight.selectedText || highlight.text;
            const start = findOccurrenceOffset(paragraph, selectedText, highlight.occurrence || 0);
            return start >= 0 ? {
                highlight,
                start,
                end: start + selectedText.length,
            } : null;
        })
        .filter((range): range is { highlight: ReaderHighlight; start: number; end: number } => Boolean(range))
        .sort((a, b) => a.start - b.start);

    if (ranges.length === 0) return paragraph;

    const nodes: React.ReactNode[] = [];
    let cursor = 0;

    ranges.forEach((range) => {
        if (range.start < cursor) return;
        if (range.start > cursor) {
            nodes.push(paragraph.slice(cursor, range.start));
        }

        nodes.push(
            <mark
                key={range.highlight.id}
                className={styles.inlineHighlight}
                style={{ backgroundColor: range.highlight.color || HIGHLIGHT_COLOR }}
                onClick={(event) => {
                    event.stopPropagation();
                    onToggleComment(range.highlight.id);
                }}
                title={range.highlight.note || "Highlight"}
            >
                {paragraph.slice(range.start, range.end)}
                <button type="button" className={styles.commentPin} aria-label="Open annotation">●</button>
                {expandedId === range.highlight.id && (
                    <span className={styles.inlineComment}>
                        {range.highlight.note || "No comment"}
                    </span>
                )}
            </mark>
        );
        cursor = range.end;
    });

    if (cursor < paragraph.length) {
        nodes.push(paragraph.slice(cursor));
    }

    return nodes;
};

export default function EpubReader({ url, cacheKey, bookId, mimeType }: { url: string; cacheKey: string; bookId: string; mimeType?: string }) {
    const [chapters, setChapters] = useState<EpubChapter[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isTocOpen, setIsTocOpen] = useState(false);
    const [panelMode, setPanelMode] = useState<EpubPanelMode>("toc");
    const [progressPercent, setProgressPercent] = useState<number | null>(null);
    const [cacheStatus, setCacheStatus] = useState("Loading file");
    const [settings, setSettings] = useState<EpubReaderSettings>(() => getEpubSettings());
    const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
    const [highlights, setHighlights] = useState<ReaderHighlight[]>([]);
    const [bookmarkNote, setBookmarkNote] = useState("");
    const [highlightNote, setHighlightNote] = useState("");
    const [selectionDraft, setSelectionDraft] = useState<{
        paragraphIndex: number;
        selectedText: string;
        occurrence: number;
        x: number;
        y: number;
    } | null>(null);
    const [selectionNote, setSelectionNote] = useState("");
    const [expandedHighlightId, setExpandedHighlightId] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<EpubSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);
    const { theme } = useTheme();
    const { user } = useAuth();
    const isDarkMode = theme === "dark";
    const currentChapter = chapters[currentIndex];
    const bookPageRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const fetchEpub = async () => {
            if (!user) return;

            try {
                const { blob, source } = await getCachedBookBlob(user.uid, cacheKey, url);
                const bookBlob = mimeType && blob.type !== mimeType ? blob.slice(0, blob.size, mimeType) : blob;
                const data = await bookBlob.arrayBuffer();
                const loadedChapters = await loadChapters(data);
                let savedLocation: string | number | null = null;

                try {
                    const docSnap = await getDoc(doc(db, "progress", `${user.uid}_${bookId}`));
                    savedLocation = docSnap.exists() ? docSnap.data().location : getLocalProgress(user.uid, bookId)?.location || null;
                    const savedPercentage = docSnap.exists() ? docSnap.data().percentage : getLocalProgress(user.uid, bookId)?.percentage;
                    if (typeof savedPercentage === "number") setProgressPercent(clampPercent(savedPercentage));
                } catch {
                    savedLocation = getLocalProgress(user.uid, bookId)?.location || null;
                }

                setCacheStatus(source === "cache" ? "Offline ready" : "Saved offline");
                setEpubData(data);
                setChapters(loadedChapters);
                setCurrentIndex(findChapterIndex(loadedChapters, savedLocation));
            } catch (err: unknown) {
                console.error("Error fetching ePub:", err);
                setError(`${getErrorMessage(err)}. Check Firebase Storage CORS if this only happens after deployment.`);
            } finally {
                setLoading(false);
            }
        };

        fetchEpub();
    }, [bookId, cacheKey, mimeType, url, user]);

    useEffect(() => {
        if (!user) return;
        loadEpubSettings(user).then(setSettings);
        setBookmarks(getBookmarks(user.uid, bookId));
        loadBookmarks(user, bookId).then(setBookmarks);
        loadHighlights(user, bookId).then(setHighlights);
    }, [bookId, user]);

    useEffect(() => {
        saveEpubSettings(user, settings).catch((err) => {
            console.warn("Could not save ePub settings:", err);
        });
    }, [settings, user]);

    useEffect(() => {
        syncPendingProgress(user);
        const sync = () => syncPendingProgress(user);
        window.addEventListener("online", sync);

        return () => window.removeEventListener("online", sync);
    }, [user]);

    const saveProgress = async (index: number) => {
        const chapter = chapters[index];
        if (!chapter) return;

        const nextPercentage = clampPercent(((index + 1) / chapters.length) * 100);
        setProgressPercent(nextPercentage);
        await saveReadingProgress(user, {
            bookId,
            location: chapter.href,
            percentage: nextPercentage,
            lastRead: Date.now(),
        });
    };

    const goToIndex = (index: number) => {
        const safeIndex = Math.min(Math.max(0, index), chapters.length - 1);
        setCurrentIndex(safeIndex);
        setIsTocOpen(false);
        saveProgress(safeIndex);
    };

    const handleSearch = async () => {
        if (!epubData || !searchQuery.trim()) return;

        setSearching(true);
        setSearchResults([]);

        try {
            setSearchResults(await searchEpub(epubData, searchQuery));
        } catch (err) {
            console.error("ePub search failed:", err);
        } finally {
            setSearching(false);
        }
    };

    const handleNavigate = (href: string) => {
        goToIndex(findChapterIndex(chapters, href));
    };

    const handleAddBookmark = async () => {
        if (!currentChapter) return;

        const bookmark = await addBookmark(user, {
            bookId,
            label: currentChapter.label,
            note: bookmarkNote.trim(),
            location: currentChapter.href,
            percentage: progressPercent ?? undefined,
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

    const handleAddChapterHighlight = async () => {
        if (!currentChapter) return;

        const highlight = await addHighlight(user, {
            bookId,
            label: currentChapter.label,
            text: currentChapter.label,
            note: highlightNote.trim(),
            location: currentChapter.href,
            selectedText: currentChapter.label,
            occurrence: 0,
            percentage: progressPercent ?? undefined,
            color: HIGHLIGHT_COLOR,
        });

        setHighlights((current) => [highlight, ...current]);
        setHighlightNote("");
    };

    const handleParagraphMouseUp = (event: MouseEvent<HTMLParagraphElement>, paragraphIndex: number, paragraph: string) => {
        const selection = window.getSelection();
        const selectedText = selection?.toString().replace(/\s+/g, " ").trim();
        if (!selection || !selectedText || !currentChapter) {
            setSelectionDraft(null);
            return;
        }

        const paragraphElement = event.currentTarget;
        if (!selection.anchorNode || !paragraphElement.contains(selection.anchorNode)) return;

        const range = selection.getRangeAt(0);
        const beforeRange = range.cloneRange();
        beforeRange.selectNodeContents(paragraphElement);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        const selectedOffset = beforeRange.toString().replace(/\s+/g, " ").length;
        const rect = range.getBoundingClientRect();
        const hostRect = bookPageRef.current?.getBoundingClientRect();

        setSelectionDraft({
            paragraphIndex,
            selectedText,
            occurrence: getOccurrenceIndex(paragraph, selectedText, selectedOffset),
            x: Math.max(12, rect.left - (hostRect?.left || 0)),
            y: Math.max(12, rect.bottom - (hostRect?.top || 0) + (bookPageRef.current?.scrollTop || 0)),
        });
        setSelectionNote("");
    };

    const handleSaveSelectionHighlight = async () => {
        if (!selectionDraft || !currentChapter) return;

        const highlight = await addHighlight(user, {
            bookId,
            label: currentChapter.label,
            text: selectionDraft.selectedText,
            note: selectionNote.trim(),
            location: currentChapter.href,
            paragraphIndex: selectionDraft.paragraphIndex,
            selectedText: selectionDraft.selectedText,
            occurrence: selectionDraft.occurrence,
            percentage: progressPercent ?? undefined,
            color: HIGHLIGHT_COLOR,
        });

        setHighlights((current) => [highlight, ...current]);
        setSelectionDraft(null);
        setSelectionNote("");
        window.getSelection()?.removeAllRanges();
    };

    const handleDeleteHighlight = async (highlightId: string) => {
        setHighlights(await deleteHighlight(user, bookId, highlightId));
    };

    const readerStyle = useMemo(() => ({
        fontSize: `${settings.fontSize}%`,
        lineHeight: settings.lineHeight,
        maxWidth: `${settings.pageWidth}px`,
        color: isDarkMode ? "#fff" : "#1f2933",
    }), [isDarkMode, settings]);

    if (loading) return <div className={styles.status}>Loading ePub...</div>;
    if (error) return <div className={styles.error}>Error: {error}</div>;
    if (!currentChapter) return <div className={styles.status}>No readable chapter available</div>;

    return (
        <div className={styles.container}>
            <div className={styles.readerControls}>
                <button
                    type="button"
                    onClick={() => {
                        setPanelMode("toc");
                        setIsTocOpen(!isTocOpen);
                    }}
                    className={styles.readerControlButton}
                >
                    Contents
                </button>
                <button type="button" className={styles.readerControlButton} disabled={currentIndex <= 0} onClick={() => goToIndex(currentIndex - 1)}>
                    Previous
                </button>
                <button type="button" className={styles.readerControlButton} disabled={currentIndex >= chapters.length - 1} onClick={() => goToIndex(currentIndex + 1)}>
                    Next
                </button>
            </div>

            {isTocOpen && (
                <div className={styles.tocPanel}>
                    <div className={styles.panelHeader}>
                        <h3 className={styles.tocTitle}>
                            {panelMode === "toc" && "Contents"}
                            {panelMode === "settings" && "Settings"}
                            {panelMode === "search" && "Search"}
                            {panelMode === "bookmarks" && "Bookmarks"}
                            {panelMode === "highlights" && "Highlights"}
                        </h3>
                        <div className={styles.panelTools}>
                            <button type="button" className={panelMode === "toc" ? styles.activeTool : ""} onClick={() => setPanelMode("toc")}>List</button>
                            <button type="button" className={panelMode === "settings" ? styles.activeTool : ""} onClick={() => setPanelMode("settings")}>Aa</button>
                            <button type="button" className={panelMode === "search" ? styles.activeTool : ""} onClick={() => setPanelMode("search")}>Find</button>
                            <button type="button" className={panelMode === "bookmarks" ? styles.activeTool : ""} onClick={() => setPanelMode("bookmarks")}>Mark</button>
                            <button type="button" className={panelMode === "highlights" ? styles.activeTool : ""} onClick={() => setPanelMode("highlights")}>Note</button>
                            <button type="button" onClick={() => setIsTocOpen(false)}>Close</button>
                        </div>
                    </div>
                    <div className={styles.progressHud} aria-label={`Reading progress ${formatProgress(progressPercent)}`}>
                        <div className={styles.progressMeta}>
                            <span>{formatProgress(progressPercent)}</span>
                            <span>{cacheStatus}</span>
                        </div>
                        <div className={styles.progressTrack}>
                            <span className={styles.progressFill} style={{ width: `${progressPercent ?? 0}%` }} />
                        </div>
                    </div>

                    {panelMode === "toc" && (
                        <ul className={styles.tocList}>
                            {chapters.map((chapter, index) => (
                                <li key={chapter.href} className={styles.tocItem}>
                                    <button
                                        type="button"
                                        onClick={() => goToIndex(index)}
                                        className={`${styles.tocItemButton} ${index === currentIndex ? styles.tocItemButtonActive : ""}`}
                                    >
                                        {chapter.label}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {panelMode === "settings" && (
                        <section className={styles.panelSection}>
                            <h3>Settings</h3>
                            <label className={styles.settingRow}>
                                <span>Text</span>
                                <input type="range" min="80" max="150" step="5" value={settings.fontSize} onChange={(event) => setSettings((current) => ({ ...current, fontSize: Number(event.target.value) }))} />
                                <strong>{settings.fontSize}%</strong>
                            </label>
                            <label className={styles.settingRow}>
                                <span>Lines</span>
                                <input type="range" min="1.2" max="2" step="0.1" value={settings.lineHeight} onChange={(event) => setSettings((current) => ({ ...current, lineHeight: Number(event.target.value) }))} />
                                <strong>{settings.lineHeight.toFixed(1)}</strong>
                            </label>
                            <label className={styles.settingRow}>
                                <span>Width</span>
                                <input type="range" min="520" max="920" step="40" value={settings.pageWidth} onChange={(event) => setSettings((current) => ({ ...current, pageWidth: Number(event.target.value) }))} />
                                <strong>{settings.pageWidth}px</strong>
                            </label>
                        </section>
                    )}
                    {panelMode === "search" && (
                        <section className={styles.panelSection}>
                            <h3>Search</h3>
                            <div className={styles.searchRow}>
                                <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleSearch(); }} placeholder="Search this ePub" />
                                <button type="button" onClick={handleSearch} disabled={searching || !searchQuery.trim()}>{searching ? "Searching" : "Find"}</button>
                            </div>
                            <div className={styles.resultList}>
                                {searchResults.map((result) => (
                                    <button key={`${result.href}-${result.snippet}`} type="button" onClick={() => handleNavigate(result.href)}>
                                        <strong>{result.label}</strong>
                                        <span>{result.snippet}</span>
                                    </button>
                                ))}
                                {!searching && searchQuery && searchResults.length === 0 && <p>No matches yet.</p>}
                            </div>
                        </section>
                    )}
                    {panelMode === "bookmarks" && (
                        <section className={styles.panelSection}>
                            <h3>Bookmarks</h3>
                            <div className={styles.searchRow}>
                                <input type="text" value={bookmarkNote} onChange={(event) => setBookmarkNote(event.target.value)} placeholder="Optional note" />
                                <button type="button" onClick={handleAddBookmark}>Add</button>
                            </div>
                            <div className={styles.bookmarkList}>
                                {bookmarks.map((bookmark) => (
                                    <div key={bookmark.id} className={styles.bookmarkItem}>
                                        <button type="button" onClick={() => handleNavigate(String(bookmark.location))}>{bookmark.label}</button>
                                        <input type="text" value={bookmark.note} onChange={(event) => handleBookmarkNote(bookmark.id, event.target.value)} placeholder="Note" />
                                        <button type="button" onClick={() => handleDeleteBookmark(bookmark.id)}>Delete</button>
                                    </div>
                                ))}
                                {bookmarks.length === 0 && <p>No bookmarks yet.</p>}
                            </div>
                        </section>
                    )}
                    {panelMode === "highlights" && (
                        <section className={styles.panelSection}>
                            <h3>Highlights</h3>
                            <div className={styles.searchRow}>
                                <input type="text" value={highlightNote} onChange={(event) => setHighlightNote(event.target.value)} placeholder="Note for this chapter" />
                                <button type="button" onClick={handleAddChapterHighlight}>Add</button>
                            </div>
                            <div className={styles.bookmarkList}>
                                {highlights.map((highlight) => (
                                    <div key={highlight.id} className={styles.bookmarkItem}>
                                        <button type="button" onClick={() => handleNavigate(String(highlight.location))}>{highlight.label}</button>
                                        <span>{highlight.note || highlight.text}</span>
                                        <button type="button" onClick={() => handleDeleteHighlight(highlight.id)}>Delete</button>
                                    </div>
                                ))}
                                {highlights.length === 0 && <p>No highlights yet.</p>}
                            </div>
                        </section>
                    )}
                </div>
            )}

            {isTocOpen && <div onClick={() => setIsTocOpen(false)} className={styles.scrim} />}

            <article className={styles.bookPage} style={readerStyle} ref={bookPageRef}>
                <h2>{currentChapter.label}</h2>
                {selectionDraft && (
                    <div
                        className={styles.selectionComposer}
                        style={{ left: selectionDraft.x, top: selectionDraft.y }}
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
                {currentChapter.paragraphs.map((paragraph, index) => (
                    <p
                        key={`${currentChapter.href}-${index}`}
                        data-paragraph-index={index}
                        onMouseUp={(event) => handleParagraphMouseUp(event, index, paragraph)}
                    >
                        {renderParagraphWithHighlights(
                            paragraph,
                            highlights.filter((highlight) => (
                                highlight.location === currentChapter.href && highlight.paragraphIndex === index
                            )),
                            (highlightId) => setExpandedHighlightId((current) => current === highlightId ? "" : highlightId),
                            expandedHighlightId
                        )}
                    </p>
                ))}
            </article>
        </div>
    );
}
