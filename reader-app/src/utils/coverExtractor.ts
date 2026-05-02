import * as pdfjs from "pdfjs-dist";
import ePub from "epubjs";

// Initialize PDF.js worker
if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

export async function extractCover(file: File): Promise<Blob | null> {
    const fileExt = file.name.split(".").pop()?.toLowerCase();

    if (fileExt === "pdf") {
        return extractPdfCover(file);
    } else if (fileExt === "epub") {
        return extractEpubCover(file);
    }
    return null;
}

async function extractPdfCover(file: File): Promise<Blob | null> {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        const viewport = page.getViewport({ scale: 1.5 }); // Scale up for better quality
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) return null;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport: viewport,
        };

        // @ts-expect-error - mismatch in type definition for pdfjs-dist v5
        await page.render(renderContext).promise;

        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                resolve(blob);
            }, "image/jpeg", 0.8);
        });
    } catch (error) {
        console.error("Error extracting PDF cover:", error);
        return null;
    }
}

async function extractEpubCover(file: File): Promise<Blob | null> {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const book = ePub(arrayBuffer);

        // Wait for book to be ready
        await book.ready;

        const coverUrl = await book.coverUrl();
        if (!coverUrl) return null;

        // Fetch the cover image and convert to Blob
        const response = await fetch(coverUrl);
        const blob = await response.blob();
        return blob;
    } catch (error) {
        console.error("Error extracting ePub cover:", error);
        return null; // Return null on failure
    }
}
