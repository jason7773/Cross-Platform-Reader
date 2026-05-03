"use client";
import { useState, useEffect, useRef } from "react";
import { ReactReader } from "react-reader";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { getCachedBookBlob } from "@/utils/bookCache";
import { addBookmark, deleteBookmark, getBookmarks, updateBookmarkNote } from "@/utils/bookmarks";
import { searchEpub, EpubSearchResult } from "@/utils/epubSearch";
import { getEpubSettings, saveEpubSettings } from "@/utils/readerSettings";
import { getLocalProgress, saveReadingProgress, syncPendingProgress } from "@/utils/readingProgress";
import { EpubReaderSettings, ReaderBookmark } from "@/types";
import styles from "./EpubReader.module.css";

type EpubTocItem = {
    id?: string;
    href?: string;
    label?: string;
    subitems?: EpubTocItem[];
    items?: EpubTocItem[];
};

type EpubSpineItem = {
    href: string;
    linear?: string;
};

type EpubSpine = {
    length: number;
    each?: (callback: (item: EpubSpineItem) => void) => void;
    get: (index: number) => EpubSpineItem | null;
};

type EpubRendition = {
    book: {
        ready: Promise<void>;
        spine?: EpubSpine;
        locations?: {
            generate: (chars?: number) => Promise<unknown>;
            percentageFromCfi: (cfi: string) => number;
        };
    };
    display: (target?: string) => Promise<unknown>;
    currentLocation?: () => EpubCurrentLocation | null;
    themes: {
        register: (name: string, rules: Record<string, Record<string, string>>) => void;
        select: (name: string) => void;
    };
};

type EpubCurrentLocation = {
    start?: {
        cfi?: string;
        href?: string;
        percentage?: number;
    };
};

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : "Unknown error";

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

const formatProgress = (percentage: number | null) => {
    if (percentage === null) return "Calculating";
    return `${percentage}%`;
};

const createThemeRules = (settings: EpubReaderSettings, isDarkMode: boolean) => ({
    body: {
        background: isDarkMode ? "#222" : settings.background,
        color: isDarkMode ? "#fff" : "#1f2933",
        "font-size": `${settings.fontSize}%`,
        "line-height": String(settings.lineHeight),
        "max-width": `${settings.pageWidth}px`,
        margin: "0 auto !important",
    },
    "p, span, div, h1, h2, h3, h4, h5, h6, a": {
        color: isDarkMode ? "#fff !important" : "inherit",
    },
});

export default function EpubReader({ url, bookId, title, mimeType }: { url: string; bookId: string; title: string; mimeType?: string }) {
    const [location, setLocation] = useState<string | number | null>(null);
    const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isProgressLoaded, setIsProgressLoaded] = useState(false);
    const [toc, setToc] = useState<EpubTocItem[]>([]);
    const [isTocOpen, setIsTocOpen] = useState(false);
    const [progressPercent, setProgressPercent] = useState<number | null>(null);
    const [activeHref, setActiveHref] = useState("");
    const [cacheStatus, setCacheStatus] = useState("Loading file");
    const [settings, setSettings] = useState<EpubReaderSettings>(() => getEpubSettings());
    const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
    const [bookmarkNote, setBookmarkNote] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<EpubSearchResult[]>([]);
    const [searching, setSearching] = useState(false);

    const { theme } = useTheme();
    const isDarkMode = theme === "dark";
    const { user } = useAuth();
    const renditionRef = useRef<EpubRendition | null>(null);

    useEffect(() => {
        const fetchEpub = async () => {
            try {
                const { blob, source } = await getCachedBookBlob(url);
                const bookBlob = mimeType && blob.type !== mimeType
                    ? blob.slice(0, blob.size, mimeType)
                    : blob;

                setCacheStatus(source === "cache" ? "Offline ready" : "Saved offline");
                setEpubData(await bookBlob.arrayBuffer());
            } catch (err: unknown) {
                console.error("Error fetching ePub:", err);
                setError(`${getErrorMessage(err)}. Check Firebase Storage CORS if this only happens after deployment.`);
            } finally {
                setLoading(false);
            }
        };

        fetchEpub();
    }, [url, mimeType]);

    useEffect(() => {
        if (!user) {
            setIsProgressLoaded(true);
            return;
        }

        const loadProgress = async () => {
            try {
                try {
                    const docRef = doc(db, "progress", `${user.uid}_${bookId}`);
                    const docSnap = await getDoc(docRef);

                    if (docSnap.exists()) {
                        const savedData = docSnap.data();
                        const savedLoc = savedData.location;
                        const savedPercentage = savedData.percentage;
                        if (savedLoc && typeof savedLoc === "string" && savedLoc.startsWith("epubcfi(")) {
                            setLocation(savedLoc);
                        }
                        if (typeof savedPercentage === "number") {
                            setProgressPercent(clampPercent(savedPercentage));
                        }
                        return;
                    }
                } catch (err) {
                    console.warn("Could not load remote progress, checking local progress:", err);
                }

                const localProgress = getLocalProgress(user.uid, bookId);
                if (typeof localProgress?.location === "string" && localProgress.location.startsWith("epubcfi(")) {
                    setLocation(localProgress.location);
                    if (typeof localProgress.percentage === "number") {
                        setProgressPercent(clampPercent(localProgress.percentage));
                    }
                }
            } catch (err) {
                console.error("Error loading progress:", err);
            } finally {
                setIsProgressLoaded(true);
            }
        };

        loadProgress();
    }, [user, bookId]);

    useEffect(() => {
        if (renditionRef.current) {
            const themeName = isDarkMode ? "dark" : "light";
            renditionRef.current.themes.register(themeName, createThemeRules(settings, isDarkMode));
            renditionRef.current.themes.select(themeName);
        }
    }, [isDarkMode, settings]);

    useEffect(() => {
        setBookmarks(getBookmarks(bookId));
    }, [bookId]);

    useEffect(() => {
        saveEpubSettings(settings);
    }, [settings]);

    useEffect(() => {
        syncPendingProgress(user);
        const sync = () => syncPendingProgress(user);
        window.addEventListener("online", sync);

        return () => window.removeEventListener("online", sync);
    }, [user]);

    const updateEpubProgress = (cfi?: string | number) => {
        const rendition = renditionRef.current;
        const currentLocation = rendition?.currentLocation?.();
        const currentHref = currentLocation?.start?.href || "";
        const locationPercentage = currentLocation?.start?.percentage;
        let percentage: number | null = null;

        if (currentHref) {
            setActiveHref(currentHref);
        }

        if (typeof locationPercentage === "number" && Number.isFinite(locationPercentage)) {
            percentage = locationPercentage <= 1 ? locationPercentage * 100 : locationPercentage;
        } else if (typeof cfi === "string" && rendition?.book.locations) {
            try {
                const cfiPercentage = rendition.book.locations.percentageFromCfi(cfi);
                if (Number.isFinite(cfiPercentage)) {
                    percentage = cfiPercentage <= 1 ? cfiPercentage * 100 : cfiPercentage;
                }
            } catch (err) {
                console.warn("Could not calculate ePub percentage:", err);
            }
        }

        if (percentage !== null) {
            const nextPercentage = clampPercent(percentage);
            setProgressPercent(nextPercentage);
            return nextPercentage;
        }

        return null;
    };

    const handleLocationChanged = (cfi: string | number) => {
        if (!cfi) return;

        setLocation(cfi);

        if (typeof cfi === "string" && user) {
            window.setTimeout(() => {
                const nextPercentage = updateEpubProgress(cfi);

                saveReadingProgress(user, {
                    bookId,
                    location: cfi,
                    percentage: nextPercentage ?? progressPercent ?? undefined,
                    lastRead: Date.now()
                });
            }, 0);
        } else {
            window.setTimeout(() => updateEpubProgress(cfi), 0);
        }
    };

    const splitHref = (href: string) => {
        const hashIndex = href.indexOf("#");

        if (hashIndex === -1) {
            return { path: href, hash: "" };
        }

        return {
            path: href.slice(0, hashIndex),
            hash: href.slice(hashIndex),
        };
    };

    const normalizeHrefPath = (href: string) => {
        try {
            return decodeURIComponent(splitHref(href).path)
                .replace(/^\/+/, "")
                .toLowerCase();
        } catch {
            return splitHref(href).path.replace(/^\/+/, "").toLowerCase();
        }
    };

    const normalizeHrefForActive = (href: string) => {
        try {
            return decodeURIComponent(href).replace(/^\/+/, "").toLowerCase();
        } catch {
            return href.replace(/^\/+/, "").toLowerCase();
        }
    };

    const getTocItemKey = (item: EpubTocItem, parentKey: string) => {
        const ownKey = item.href
            ? normalizeHrefForActive(item.href)
            : (item.id || item.label || "section").trim().toLowerCase();

        return `${parentKey}/${ownKey}`;
    };

    const handleNavigate = async (href: string) => {
        if (!renditionRef.current) return;

        const book = renditionRef.current.book;
        let targetHref = href;
        const { hash } = splitHref(href);

        if (book && book.spine) {
            const cleanHref = normalizeHrefPath(href);
            let foundItem: EpubSpineItem | null = null;

            if (typeof book.spine.each === "function") {
                book.spine.each((item) => {
                    const itemHref = normalizeHrefPath(item.href || "");

                    if (itemHref && (itemHref.endsWith(cleanHref) || cleanHref.endsWith(itemHref))) {
                        foundItem = item;
                    }
                });
            } else if (book.spine.length > 0) {
                for (let i = 0; i < book.spine.length; i++) {
                    const item = book.spine.get(i);
                    if (!item) continue;
                    const itemHref = normalizeHrefPath(item.href || "");

                    if (itemHref && (itemHref.endsWith(cleanHref) || cleanHref.endsWith(itemHref))) {
                        foundItem = item;
                        break;
                    }
                }
            }

            if (foundItem?.href) {
                targetHref = `${foundItem.href}${hash}`;
            }
        }

        setIsTocOpen(false);

        const targets = Array.from(new Set([targetHref, href]));

        for (const target of targets) {
            try {
                await renditionRef.current.display(target);
                return;
            } catch (err) {
                console.error("Navigation failed for href:", target, err);
            }
        }
    };

    const isTocItemActive = (href?: string) => {
        if (!href || !activeHref) return false;
        if (href.includes("#")) return normalizeHrefForActive(href) === normalizeHrefForActive(activeHref);

        const itemHref = normalizeHrefForActive(href);
        const currentHref = normalizeHrefForActive(activeHref);
        const itemBaseName = itemHref.split("/").at(-1);
        const currentBaseName = currentHref.split("/").at(-1);

        return Boolean(itemHref && currentHref && (
            itemHref === currentHref ||
            (!itemHref.includes("/") && itemBaseName === currentBaseName)
        ));
    };

    const handleAddBookmark = () => {
        if (!location) return;

        const bookmark = addBookmark({
            bookId,
            label: progressPercent === null ? "Saved place" : `${progressPercent}%`,
            note: bookmarkNote.trim(),
            location,
            percentage: progressPercent ?? undefined,
        });

        setBookmarks((current) => [bookmark, ...current]);
        setBookmarkNote("");
    };

    const handleBookmarkNote = (bookmarkId: string, note: string) => {
        setBookmarks(updateBookmarkNote(bookId, bookmarkId, note));
    };

    const handleDeleteBookmark = (bookmarkId: string) => {
        setBookmarks(deleteBookmark(bookId, bookmarkId));
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

    const renderTocItems = (items: EpubTocItem[], depth = 0, parentKey = "toc") => (
        <ul className={styles.tocList}>
            {items.map((item) => {
                const children = item.subitems || item.items || [];
                const itemKey = getTocItemKey(item, parentKey);
                const isActive = isTocItemActive(item.href);

                return (
                    <li key={itemKey} className={styles.tocItem}>
                        <button
                            onClick={() => item.href && handleNavigate(item.href)}
                            disabled={!item.href}
                            className={`${styles.tocItemButton} ${isActive ? styles.tocItemButtonActive : ""}`}
                            aria-current={isActive ? "location" : undefined}
                            style={{
                                paddingLeft: `${0.7 + depth * 1}rem`,
                                opacity: item.href ? 1 : 0.6
                            }}
                        >
                            {item.label || "Untitled section"}
                        </button>
                        {children.length > 0 && renderTocItems(children, depth + 1, itemKey)}
                    </li>
                );
            })}
        </ul>
    );

    if (loading || !isProgressLoaded) {
        return <div className={styles.status}>Loading ePub...</div>;
    }

    if (error) {
        return <div className={styles.error}>Error: {error}</div>;
    }

    if (!epubData) {
        return <div className={styles.status}>No data available</div>;
    }

    return (
        <div className={styles.container}>
            <div className={styles.readerControls}>
                <button
                    type="button"
                    onClick={() => setIsTocOpen(!isTocOpen)}
                    className={styles.readerControlButton}
                >
                    Contents
                </button>
            </div>

            {isTocOpen && (
                <div className={styles.tocPanel}>
                    <button
                        onClick={() => setIsTocOpen(false)}
                        className={styles.closeButton}
                    >
                        Close
                    </button>
                    <h3 className={styles.tocTitle}>Contents</h3>
                    <div className={styles.progressHud} aria-label={`Reading progress ${formatProgress(progressPercent)}`}>
                        <div className={styles.progressMeta}>
                            <span>{formatProgress(progressPercent)}</span>
                            <span>{cacheStatus}</span>
                        </div>
                        <div className={styles.progressTrack}>
                            <span
                                className={styles.progressFill}
                                style={{ width: `${progressPercent ?? 0}%` }}
                            />
                        </div>
                    </div>
                    <section className={styles.panelSection}>
                        <h3>Settings</h3>
                        <label className={styles.settingRow}>
                            <span>Text</span>
                            <input
                                type="range"
                                min="80"
                                max="150"
                                step="5"
                                value={settings.fontSize}
                                onChange={(event) => setSettings((current) => ({ ...current, fontSize: Number(event.target.value) }))}
                            />
                            <strong>{settings.fontSize}%</strong>
                        </label>
                        <label className={styles.settingRow}>
                            <span>Lines</span>
                            <input
                                type="range"
                                min="1.2"
                                max="2"
                                step="0.1"
                                value={settings.lineHeight}
                                onChange={(event) => setSettings((current) => ({ ...current, lineHeight: Number(event.target.value) }))}
                            />
                            <strong>{settings.lineHeight.toFixed(1)}</strong>
                        </label>
                        <label className={styles.settingRow}>
                            <span>Width</span>
                            <input
                                type="range"
                                min="520"
                                max="920"
                                step="40"
                                value={settings.pageWidth}
                                onChange={(event) => setSettings((current) => ({ ...current, pageWidth: Number(event.target.value) }))}
                            />
                            <strong>{settings.pageWidth}px</strong>
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
                                placeholder="Search this ePub"
                            />
                            <button type="button" onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
                                {searching ? "Searching" : "Find"}
                            </button>
                        </div>
                        <div className={styles.resultList}>
                            {searchResults.map((result) => (
                                <button key={result.href} type="button" onClick={() => handleNavigate(result.href)}>
                                    <strong>{result.label}</strong>
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
                            <button type="button" onClick={handleAddBookmark} disabled={!location}>Add</button>
                        </div>
                        <div className={styles.bookmarkList}>
                            {bookmarks.map((bookmark) => (
                                <div key={bookmark.id} className={styles.bookmarkItem}>
                                    <button type="button" onClick={() => {
                                        if (typeof bookmark.location === "string") {
                                            renditionRef.current?.display(bookmark.location);
                                            setIsTocOpen(false);
                                        }
                                    }}>
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
                    {toc.length > 0 ? renderTocItems(toc) : <p className={styles.emptyToc}>No contents found.</p>}
                </div>
            )}

            {isTocOpen && (
                <div
                    onClick={() => setIsTocOpen(false)}
                    className={styles.scrim}
                />
            )}

            <ReactReader
                url={epubData}
                location={location}
                locationChanged={handleLocationChanged}
                tocChanged={(items) => setToc(items as EpubTocItem[])}
                showToc={false}
                title={title}
                getRendition={(rendition: EpubRendition) => {
                    renditionRef.current = rendition;
                    const themeName = isDarkMode ? "dark" : "light";
                    rendition.themes.register(themeName, createThemeRules(settings, isDarkMode));
                    rendition.themes.select(themeName);
                    rendition.book.ready.then(() => {
                        rendition.book.locations?.generate(1200)
                            .then(() => updateEpubProgress(location || undefined))
                            .catch((err: unknown) => console.warn("Could not generate ePub locations:", err));
                    }).catch((err: unknown) => console.error("Error preparing ePub locations:", err));

                    if (!location) {
                        const book = rendition.book;
                        book.ready.then(() => {
                            const spine = book.spine;

                            if (spine && spine.length > 0) {
                                let firstItem: EpubSpineItem | null = null;

                                if (typeof spine.each === "function") {
                                    spine.each((item) => {
                                        if (item.linear !== "no" && !firstItem) {
                                            firstItem = item;
                                        }
                                    });
                                } else {
                                    firstItem = spine.get(0);
                                }

                                if (!firstItem) {
                                    firstItem = spine.get(0);
                                }

                                if (firstItem) {
                                    rendition.display(firstItem.href).catch((err: unknown) => {
                                        console.error("Error displaying first spine item:", err);
                                        rendition.display().catch((e: unknown) => console.error("Fatal display error:", e));
                                    });
                                }
                            }
                        }).catch((err: unknown) => console.error("Error preparing ePub spine:", err));
                    }
                }}
            />
        </div>
    );
}
