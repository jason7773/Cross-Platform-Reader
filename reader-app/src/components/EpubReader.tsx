"use client";
import { useState, useEffect, useRef } from "react";
import { ReactReader } from "react-reader";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

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
    };
    display: (target?: string) => Promise<unknown>;
    themes: {
        register: (name: string, rules: Record<string, Record<string, string>>) => void;
        select: (name: string) => void;
    };
};

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : "Unknown error";

export default function EpubReader({ url, bookId, title }: { url: string; bookId: string; title: string }) {
    const [location, setLocation] = useState<string | number | null>(null);
    const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isProgressLoaded, setIsProgressLoaded] = useState(false);
    const [toc, setToc] = useState<EpubTocItem[]>([]);
    const [isTocOpen, setIsTocOpen] = useState(false);

    const { theme } = useTheme();
    const isDarkMode = theme === "dark";
    const { user } = useAuth();
    const renditionRef = useRef<EpubRendition | null>(null);

    useEffect(() => {
        const fetchEpub = async () => {
            try {
                const proxiedUrl = `/api/proxy-file?url=${encodeURIComponent(url)}`;
                const response = await fetch(proxiedUrl);

                if (!response.ok) {
                    throw new Error(`Failed to fetch: ${response.status}`);
                }

                setEpubData(await response.arrayBuffer());
            } catch (err: unknown) {
                console.error("Error fetching ePub:", err);
                setError(getErrorMessage(err));
            } finally {
                setLoading(false);
            }
        };

        fetchEpub();
    }, [url]);

    useEffect(() => {
        if (!user) {
            setIsProgressLoaded(true);
            return;
        }

        const loadProgress = async () => {
            try {
                const docRef = doc(db, "progress", `${user.uid}_${bookId}`);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const savedLoc = docSnap.data().location;
                    if (savedLoc && typeof savedLoc === "string" && savedLoc.startsWith("epubcfi(")) {
                        setLocation(savedLoc);
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
            renditionRef.current.themes.select(isDarkMode ? "dark" : "light");
        }
    }, [isDarkMode]);

    const handleLocationChanged = (cfi: string | number) => {
        if (!cfi) return;

        setLocation(cfi);

        if (typeof cfi === "string" && user) {
            setDoc(doc(db, "progress", `${user.uid}_${bookId}`), {
                userId: user.uid,
                bookId,
                location: cfi,
                lastRead: Date.now()
            }, { merge: true });
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

    const renderTocItems = (items: EpubTocItem[], depth = 0) => (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((item, index) => {
                const children = item.subitems || item.items || [];
                const key = item.id || item.href || `${item.label}-${index}`;

                return (
                    <li key={key} style={{ marginBottom: 0, borderBottom: "1px solid rgba(128,128,128,0.2)" }}>
                        <button
                            onClick={() => item.href && handleNavigate(item.href)}
                            disabled={!item.href}
                            style={{
                                background: "none",
                                border: "none",
                                color: "inherit",
                                cursor: item.href ? "pointer" : "default",
                                textAlign: "left",
                                width: "100%",
                                padding: "12px 5px",
                                paddingLeft: `${5 + depth * 16}px`,
                                fontSize: "15px",
                                lineHeight: "1.4",
                                opacity: item.href ? 1 : 0.6
                            }}
                        >
                            {item.label || "Untitled section"}
                        </button>
                        {children.length > 0 && renderTocItems(children, depth + 1)}
                    </li>
                );
            })}
        </ul>
    );

    if (loading || !isProgressLoaded) {
        return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>Loading ePub...</div>;
    }

    if (error) {
        return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "red" }}>Error: {error}</div>;
    }

    if (!epubData) {
        return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>No data available</div>;
    }

    return (
        <div style={{ height: "100%", position: "relative", overflow: "hidden" }}>
            <button
                onClick={() => setIsTocOpen(!isTocOpen)}
                style={{
                    position: "absolute",
                    top: "10px",
                    left: "10px",
                    zIndex: 100,
                    background: isDarkMode ? "#333" : "#fff",
                    color: isDarkMode ? "#fff" : "#000",
                    border: "1px solid #ccc",
                    borderRadius: "4px",
                    padding: "8px 12px",
                    cursor: "pointer",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                    fontWeight: "bold",
                    fontSize: "14px"
                }}
            >
                Contents
            </button>

            {isTocOpen && (
                <div style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: "300px",
                    maxWidth: "80%",
                    background: isDarkMode ? "#222" : "#fff",
                    color: isDarkMode ? "#fff" : "#000",
                    zIndex: 102,
                    overflowY: "auto",
                    padding: "60px 20px 20px 20px",
                    boxShadow: "2px 0 10px rgba(0,0,0,0.3)",
                    borderRight: "1px solid #ccc"
                }}>
                    <button
                        onClick={() => setIsTocOpen(false)}
                        style={{
                            position: "absolute",
                            top: "10px",
                            right: "10px",
                            background: "none",
                            border: "none",
                            color: "inherit",
                            fontSize: "14px",
                            cursor: "pointer"
                        }}
                    >
                        Close
                    </button>
                    <h3 style={{ marginBottom: "20px", borderBottom: "1px solid #666", paddingBottom: "10px" }}>Contents</h3>
                    {toc.length > 0 ? renderTocItems(toc) : <p style={{ color: isDarkMode ? "#bbb" : "#666" }}>No contents found.</p>}
                </div>
            )}

            {isTocOpen && (
                <div
                    onClick={() => setIsTocOpen(false)}
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: "rgba(0,0,0,0.5)",
                        zIndex: 100
                    }}
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
                    rendition.themes.register("dark", {
                        body: { background: "#222", color: "#fff" },
                        "p, span, div, h1, h2, h3, h4, h5, h6, a": { color: "#fff !important" },
                    });
                    rendition.themes.register("light", {
                        body: { background: "#fff", color: "#000" },
                    });
                    rendition.themes.select(isDarkMode ? "dark" : "light");

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
