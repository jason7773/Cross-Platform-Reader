import * as pdfjs from "pdfjs-dist";
import JSZip from "jszip";

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
        const zip = await JSZip.loadAsync(arrayBuffer);
        const opfPath = await getOpfPath(zip);
        const opfFile = opfPath ? zip.file(opfPath) : null;
        if (!opfPath || !opfFile) return null;

        const opfText = await opfFile.async("string");
        const opf = new DOMParser().parseFromString(opfText, "application/xml");
        const coverId = opf.querySelector("meta[name='cover']")?.getAttribute("content");
        const coverItem = coverId
            ? opf.querySelector(`manifest item[id="${CSS.escape(coverId)}"]`)
            : opf.querySelector("manifest item[properties~='cover-image']");
        const coverHref = coverItem?.getAttribute("href");
        if (!coverHref) return null;

        const coverFile = zip.file(resolveZipPath(opfPath, coverHref));
        if (!coverFile) return null;

        const blob = await coverFile.async("blob");
        const mediaType = coverItem?.getAttribute("media-type") || blob.type || "image/jpeg";
        return blob.slice(0, blob.size, mediaType);
    } catch (error) {
        console.error("Error extracting ePub cover:", error);
        return null; // Return null on failure
    }
}

const getOpfPath = async (zip: JSZip) => {
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) return null;

    const containerText = await containerFile.async("string");
    const container = new DOMParser().parseFromString(containerText, "application/xml");
    return container.querySelector("rootfile")?.getAttribute("full-path") || null;
};

const resolveZipPath = (fromPath: string, href: string) => {
    const baseParts = fromPath.split("/");
    baseParts.pop();
    const parts = [...baseParts, ...href.split("/")];
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
