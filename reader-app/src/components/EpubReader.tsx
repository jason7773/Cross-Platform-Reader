"use client";
import { useState, useEffect, useRef } from "react";
import { ReactReader } from "react-reader";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";

export default function EpubReader({ url, bookId, title }: { url: string; bookId: string; title: string }) {
    // Start with null. We'll manually handle the initial display to ensure stability.
    const [location, setLocation] = useState<string | number | null>(null);
    const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isProgressLoaded, setIsProgressLoaded] = useState(false);

    // Custom TOC state
    const [toc, setToc] = useState<any[]>([]);
    const [isTocOpen, setIsTocOpen] = useState(false);

    const { theme } = useTheme();
    const isDarkMode = theme === 'dark';
    const { user } = useAuth();
    const renditionRef = useRef<any>(null);

    // Fetch ePub as ArrayBuffer
    useEffect(() => {
        const fetchEpub = async () => {
            try {
                const proxiedUrl = `/api/proxy-file?url=${encodeURIComponent(url)}`;
                console.log("Fetching ePub from:", proxiedUrl);
                const response = await fetch(proxiedUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch: ${response.status}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                console.log("ePub fetched, size:", arrayBuffer.byteLength);
                setEpubData(arrayBuffer);
            } catch (err: any) {
                console.error("Error fetching ePub:", err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchEpub();
    }, [url]);

    // Load progress
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
                    if (savedLoc && typeof savedLoc === 'string' && savedLoc.startsWith('epubcfi(')) {
                        console.log("Loaded saved location:", savedLoc);
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

    // Save progress
    const handleLocationChanged = (cfi: string | number) => {
        if (!cfi) return;

        setLocation(cfi);

        if (typeof cfi === 'string' && user) {
            setDoc(doc(db, "progress", `${user.uid}_${bookId}`), {
                userId: user.uid,
                bookId,
                location: cfi,
                lastRead: Date.now()
            }, { merge: true });
        }
    };

    // Custom navigation handler with robust path resolution
    const handleNavigate = (href: string) => {
        if (!renditionRef.current) return;

        const book = renditionRef.current.book;
        let targetHref = href;

        // Try to resolve the correct path via spine
        // The TOC usually has simple paths like "chapter1.xhtml", but the internal system might need "OEBPS/Text/chapter1.xhtml"
        if (book && book.spine) {
            const cleanHref = href.split('#')[0]; // Remove hash for matching
            let foundItem: any = null;

            // @ts-ignore
            if (typeof book.spine.each === 'function') {
                // @ts-ignore
                book.spine.each((item: any) => {
                    // Check if one path ends with the other (handles relative vs absolute mismatch)
                    if (item.href && (item.href.endsWith(cleanHref) || cleanHref.endsWith(item.href))) {
                        foundItem = item;
                    }
                });
            } else if (book.spine.length > 0) { // Fallback for some versions
                // @ts-ignore
                for (let i = 0; i < book.spine.length; i++) {
                    // @ts-ignore
                    const item = book.spine.get(i);
                    if (item.href && (item.href.endsWith(cleanHref) || cleanHref.endsWith(item.href))) {
                        foundItem = item;
                        break;
                    }
                }
            }

            if (foundItem) {
                console.log(`Path resolution: TOC "${href}" -> Spine "${foundItem.href}"`);
                targetHref = foundItem.href;
            } else {
                console.warn(`Could not find spine item for "${href}", trying direct navigation.`);
            }
        }

        console.log("Navigating to:", targetHref);
        // Close sidebar first to improve responsiveness perception
        setIsTocOpen(false);

        renditionRef.current.display(targetHref).catch((err: any) => {
            console.error("Navigation failed for href:", targetHref, err);
        });
    };

    useEffect(() => {
        if (renditionRef.current) {
            renditionRef.current.themes.select(isDarkMode ? 'dark' : 'light');
        }
    }, [isDarkMode]);

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
        <div style={{ height: "100%", position: 'relative', overflow: 'hidden' }}>
            {/* Custom TOC Button */}
            <button
                onClick={() => setIsTocOpen(!isTocOpen)}
                style={{
                    position: 'absolute',
                    top: '10px',
                    left: '10px',
                    zIndex: 100,
                    background: isDarkMode ? '#333' : '#fff',
                    color: isDarkMode ? '#fff' : '#000',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    fontWeight: 'bold',
                    fontSize: '14px'
                }}
            >
                ☰ 目錄
            </button>

            {/* Custom TOC Sidebar Overlay */}
            {isTocOpen && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: '300px',
                    maxWidth: '80%',
                    background: isDarkMode ? '#222' : '#fff',
                    color: isDarkMode ? '#fff' : '#000',
                    zIndex: 101,
                    overflowY: 'auto',
                    padding: '60px 20px 20px 20px',
                    boxShadow: '2px 0 10px rgba(0,0,0,0.3)',
                    borderRight: '1px solid #ccc'
                }}>
                    <button
                        onClick={() => setIsTocOpen(false)}
                        style={{
                            position: 'absolute',
                            top: '10px',
                            right: '10px',
                            background: 'none',
                            border: 'none',
                            color: 'inherit',
                            fontSize: '20px',
                            cursor: 'pointer'
                        }}
                    >
                        ✕
                    </button>
                    <h3 style={{ marginBottom: '20px', borderBottom: '1px solid #666', paddingBottom: '10px' }}>目錄</h3>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {toc.map((item, index) => (
                            <li key={index} style={{ marginBottom: '0', borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
                                <button
                                    onClick={() => handleNavigate(item.href)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: 'inherit',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        width: '100%',
                                        padding: '12px 5px',
                                        fontSize: '15px',
                                        lineHeight: '1.4'
                                    }}
                                >
                                    {item.label}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Overlay background to close TOC */}
            {isTocOpen && (
                <div
                    onClick={() => setIsTocOpen(false)}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0,0,0,0.5)',
                        zIndex: 100
                    }}
                />
            )}

            <ReactReader
                url={epubData}
                location={location}
                locationChanged={handleLocationChanged}
                tocChanged={(toc) => setToc(toc)}
                showToc={false} // Hide built-in TOC
                title={title}
                getRendition={(rendition) => {
                    renditionRef.current = rendition;
                    rendition.themes.register('dark', {
                        body: { background: '#222', color: '#fff' },
                        'p, span, div, h1, h2, h3, h4, h5, h6, a': { color: '#fff !important' },
                    });
                    rendition.themes.register('light', {
                        body: { background: '#fff', color: '#000' },
                    });
                    rendition.themes.select(isDarkMode ? 'dark' : 'light');

                    // If we don't have a saved location, we need to manually find the start
                    if (!location) {
                        const book = rendition.book;
                        book.ready.then(() => {
                            // Find the first linear spine item. This is safer than TOC [0].
                            // The spine defines the reading order of the book.
                            const spine = book.spine;
                            if (spine && spine.length > 0) { // Check length properly
                                // The spine is an object, not an array, so we must use .each() or .get()
                                let firstItem: any = null;
                                // @ts-ignore - epubjs types might be incomplete
                                if (typeof spine.each === 'function') {
                                    spine.each((item: any) => {
                                        if (item.linear !== 'no' && !firstItem) {
                                            firstItem = item;
                                        }
                                    });
                                } else if (spine.length > 0) {
                                    firstItem = spine.get(0);
                                }

                                if (!firstItem && spine.length > 0) {
                                    firstItem = spine.get(0);
                                }

                                if (firstItem) {
                                    console.log("Navigating to first spine item:", firstItem.href);
                                    rendition.display(firstItem.href).catch((err: any) => {
                                        console.error("Error displaying first spine item:", err);
                                        // Last resort: try just display() which should go to start
                                        rendition.display().catch((e: any) => console.error("Fatal display error:", e));
                                    });
                                }
                            }
                        });
                    }
                }}
            />
        </div>
    );
}
