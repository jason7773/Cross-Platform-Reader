"use client";
import { useState, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "@/firebase/config";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import styles from "./PDFReader.module.css";

// Set worker source
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function PDFReader({ url, bookId }: { url: string; bookId: string }) {
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageNumber, setPageNumber] = useState<number>(1);
    const { user } = useAuth();
    const { theme } = useTheme();
    const isDarkMode = theme === 'dark';

    // Use proxy to avoid CORS
    const proxiedUrl = `/api/proxy-file?url=${encodeURIComponent(url)}`;

    function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
        setNumPages(numPages);
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

    return (
        <div className={styles.container} style={{ backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5', color: isDarkMode ? '#fff' : 'inherit' }}>
            <div className={styles.controls} style={{ color: isDarkMode ? '#fff' : 'inherit' }}>
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
            <div className={styles.document}>
                <Document
                    file={proxiedUrl}
                    onLoadSuccess={onDocumentLoadSuccess}
                    className={styles.pdfDoc}
                >
                    <div style={{ filter: isDarkMode ? 'invert(0.9) hue-rotate(180deg)' : 'none' }}>
                        <Page pageNumber={pageNumber} width={window.innerWidth > 800 ? 800 : window.innerWidth} />
                    </div>
                </Document>
            </div>
        </div>
    );
}
