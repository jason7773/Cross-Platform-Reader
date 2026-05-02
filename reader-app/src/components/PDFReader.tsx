"use client";
import { useState, useEffect, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { DocumentCallback } from "react-pdf/dist/shared/types.js";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import styles from "./PDFReader.module.css";

// Set worker source
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type PdfOutlineItem = {
    title: string;
    dest: string | unknown[] | null;
    items?: PdfOutlineItem[];
};

export default function PDFReader({ url, bookId }: { url: string; bookId: string }) {
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageNumber, setPageNumber] = useState<number>(1);
    const [pdfDocument, setPdfDocument] = useState<DocumentCallback | null>(null);
    const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
    const [outlineLoading, setOutlineLoading] = useState(false);
    const [isOutlineOpen, setIsOutlineOpen] = useState(false);
    const [pageWidth, setPageWidth] = useState(800);
    const documentContainerRef = useRef<HTMLDivElement | null>(null);
    const { user } = useAuth();
    const { theme } = useTheme();
    const isDarkMode = theme === 'dark';

    // Use proxy to avoid CORS
    const proxiedUrl = `/api/proxy-file?url=${encodeURIComponent(url)}`;

    async function onDocumentLoadSuccess(pdf: DocumentCallback) {
        setPdfDocument(pdf);
        setNumPages(pdf.numPages);
        setOutlineLoading(true);

        try {
            const loadedOutline = await pdf.getOutline();
            setOutline((loadedOutline || []) as PdfOutlineItem[]);
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
            const docRef = doc(db, "progress", `${user.uid}_${bookId}`);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const savedPage = docSnap.data().location;
                if (savedPage) setPageNumber(Number(savedPage));
            }
        };
        loadProgress();
    }, [user, bookId]);

    const changePage = (offset: number) => {
        const newPage = Math.min(Math.max(1, pageNumber + offset), numPages || 1);
        setPageNumber(newPage);
        saveProgress(newPage);
    };

    const saveProgress = async (page: number) => {
        if (user) {
            await setDoc(doc(db, "progress", `${user.uid}_${bookId}`), {
                userId: user.uid,
                bookId,
                location: page,
                lastRead: Date.now()
            }, { merge: true });
        }
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

    const renderOutlineItems = (items: PdfOutlineItem[], depth = 0) => (
        <ul className={depth === 0 ? styles.outlineList : styles.outlineNestedList}>
            {items.map((item, index) => (
                <li key={`${item.title}-${index}`} className={styles.outlineItem}>
                    <button
                        type="button"
                        className={styles.outlineLink}
                        style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
                        onClick={() => goToOutlineItem(item)}
                        disabled={!item.dest}
                    >
                        {item.title || "Untitled section"}
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
    }, []);

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
                        {outline.length > 0 ? renderOutlineItems(outline) : <p className={styles.outlineEmpty}>No contents found.</p>}
                    </aside>
                )}
                <div className={styles.document} ref={documentContainerRef}>
                    <Document
                        file={proxiedUrl}
                        onLoadSuccess={onDocumentLoadSuccess}
                        className={styles.pdfDoc}
                    >
                        <div style={{ filter: isDarkMode ? 'invert(0.9) hue-rotate(180deg)' : 'none' }}>
                            <Page pageNumber={pageNumber} width={pageWidth} />
                        </div>
                    </Document>
                </div>
            </div>
        </div>
    );
}
