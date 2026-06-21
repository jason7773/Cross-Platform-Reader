import JSZip from "jszip";
import * as pdfjs from "pdfjs-dist";

if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
    ).toString();
}

type ExtractedBookMetadata = {
    title?: string;
    author?: string;
};

const getText = (doc: Document, selectors: string[]) => {
    for (const selector of selectors) {
        const value = doc.querySelector(selector)?.textContent?.trim();
        if (value) return value;
    }
    return "";
};

const getOpfPath = async (zip: JSZip) => {
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) return null;

    const containerText = await containerFile.async("string");
    const container = new DOMParser().parseFromString(containerText, "application/xml");
    return container.querySelector("rootfile")?.getAttribute("full-path") || null;
};

export const extractBookMetadata = async (file: File): Promise<ExtractedBookMetadata> => {
    const extension = file.name.split(".").pop()?.toLowerCase();

    if (extension === "pdf") {
        try {
            const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
            const metadata = await pdf.getMetadata();
            const info = metadata.info as { Title?: string; Author?: string } | undefined;
            return {
                title: info?.Title?.trim(),
                author: info?.Author?.trim(),
            };
        } catch (err) {
            console.warn("Could not extract PDF metadata:", err);
            return {};
        }
    }

    if (extension === "epub") {
        try {
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const opfPath = await getOpfPath(zip);
            const opfFile = opfPath ? zip.file(opfPath) : null;
            if (!opfFile) return {};

            const opf = new DOMParser().parseFromString(await opfFile.async("string"), "application/xml");
            return {
                title: getText(opf, ["metadata title", "dc\\:title", "title"]),
                author: getText(opf, ["metadata creator", "dc\\:creator", "creator"]),
            };
        } catch (err) {
            console.warn("Could not extract ePub metadata:", err);
            return {};
        }
    }

    return {};
};
