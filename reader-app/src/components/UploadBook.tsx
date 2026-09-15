"use client";
import { useState } from "react";
import { loadBackendServices } from "@/backend";
import { useAuth } from "@/context/AuthContext";
import { cacheUploadedBook } from "@/utils/bookCache";
import { getBookCacheKey } from "@/utils/bookFiles";
import { extractBookMetadata } from "@/utils/bookMetadata";

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : "Upload failed";
const MAX_BOOK_SIZE_BYTES = 100 * 1024 * 1024;
const COVER_MAX_WIDTH = 480;
const COVER_MAX_HEIGHT = 640;
const COVER_QUALITY = 0.78;

const getBookContentType = (format: "pdf" | "epub", fallback: string) => {
    if (format === "pdf" && fallback === "application/pdf") return fallback;
    if (format === "epub" && fallback === "application/epub+zip") return fallback;
    return format === "pdf" ? "application/pdf" : "application/epub+zip";
};

const loadImageFromBlob = (blob: Blob) => new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
    };

    image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read cover image."));
    };

    image.src = objectUrl;
});

const resizeCoverImage = async (blob: Blob) => {
    if (!blob.type.startsWith("image/")) return blob;

    try {
        const image = await loadImageFromBlob(blob);
        const scale = Math.min(
            1,
            COVER_MAX_WIDTH / image.naturalWidth,
            COVER_MAX_HEIGHT / image.naturalHeight
        );
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) return blob;

        canvas.width = width;
        canvas.height = height;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        return await new Promise<Blob>((resolve) => {
            canvas.toBlob((resizedBlob) => {
                resolve(resizedBlob || blob);
            }, "image/jpeg", COVER_QUALITY);
        });
    } catch (err) {
        console.error("Cover resize failed:", err);
        return blob;
    }
};

export default function UploadBook({ onUploadSuccess }: { onUploadSuccess?: () => void }) {
    const { user } = useAuth();
    const [file, setFile] = useState<File | null>(null);
    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [title, setTitle] = useState("");
    const [author, setAuthor] = useState("");
    const [tags, setTags] = useState("");
    const [notes, setNotes] = useState("");
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            setFile(selectedFile);
            const fileName = selectedFile.name.replace(/\.[^/.]+$/, "");
            setTitle(fileName);
            extractBookMetadata(selectedFile).then((metadata) => {
                if (metadata.title) setTitle(metadata.title);
                if (metadata.author) setAuthor(metadata.author);
            });
        }
    };

    const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setCoverFile(e.target.files[0]);
        }
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file || !user) return;
        setUploading(true);
        setError("");
        setSuccess("");

        try {
            const fileExt = file.name.split(".").pop()?.toLowerCase();
            let format: 'pdf' | 'epub' = 'pdf';
            if (fileExt === 'epub') format = 'epub';
            else if (fileExt !== 'pdf') {
                throw new Error("Only PDF and ePub formats are supported.");
            }

            if (file.size > MAX_BOOK_SIZE_BYTES) {
                throw new Error("Books must be smaller than 100 MB.");
            }

            // The selected adapter owns file storage and metadata creation so
            // the UI behaves the same in Firebase and local deployments.
            let finalCoverBlob: Blob | null = coverFile;

            if (!finalCoverBlob) {
                // Attempt to auto-generate cover
                try {
                    // Dynamically import to avoid SSR issues if any, ensuring client-side execution
                    const { extractCover } = await import("@/utils/coverExtractor");
                    finalCoverBlob = await extractCover(file);
                } catch (e) {
                    console.error("Auto-cover extraction failed:", e);
                }
            }

            if (finalCoverBlob) {
                finalCoverBlob = await resizeCoverImage(finalCoverBlob);
            }

            const { library } = await loadBackendServices();
            const createdBook = await library.upload(user, {
                file,
                title,
                author: author || "Unknown",
                tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
                notes: notes.trim(),
                cover: finalCoverBlob,
            });
            cacheUploadedBook(user.uid, getBookCacheKey(createdBook), file, getBookContentType(format, file.type)).catch((cacheError) => {
                console.warn("Book uploaded, but local offline cache failed:", cacheError);
            });

            setFile(null);
            setCoverFile(null);
            setTitle("");
            setAuthor("");
            setTags("");
            setNotes("");
            setSuccess("Book uploaded.");
            if (onUploadSuccess) onUploadSuccess();
        } catch (err: unknown) {
            console.error(err);
            setError(getErrorMessage(err));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="rounded-lg border border-[var(--card-border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)]">
            <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="m-0 text-sm font-extrabold">Upload book</h3>
                <span className="text-xs text-[var(--muted)]">PDF or ePub, up to 100 MB</span>
            </div>
            {error && <p className="mb-2 mt-0 rounded-lg bg-red-500/10 p-2 text-sm text-[var(--danger)]">{error}</p>}
            {success && <p className="mb-2 mt-0 rounded-lg bg-[rgba(36,92,122,0.1)] p-2 text-sm text-[var(--primary-strong)]">{success}</p>}
            <form onSubmit={handleUpload} className="grid gap-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                    <label
                        htmlFor="book-upload"
                        className="relative flex min-h-12 flex-1 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[var(--input-border)] bg-[var(--surface-raised)] px-3 text-sm hover:border-[var(--primary)] hover:bg-[var(--secondary)]"
                    >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--card-border)] bg-[var(--surface)] text-base font-bold text-[var(--primary-strong)]">+</span>
                        <span className="min-w-0">
                            <span className="block truncate font-bold text-[var(--foreground)]">{file ? file.name : "Attach PDF or ePub"}</span>
                            <span className="block text-xs text-[var(--muted)]">Choose the book file</span>
                        </span>
                        <input
                            type="file"
                            accept=".pdf,.epub"
                            onChange={handleFileChange}
                            className="absolute inset-0 cursor-pointer opacity-0"
                            id="book-upload"
                        />
                    </label>

                    <label
                        htmlFor="cover-upload"
                        className="relative flex min-h-12 cursor-pointer items-center justify-center rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm font-bold text-[var(--muted)] hover:bg-[var(--secondary)] sm:w-48"
                    >
                        <span className="block max-w-full truncate">{coverFile ? coverFile.name : "Cover optional"}</span>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleCoverChange}
                            className="absolute inset-0 cursor-pointer opacity-0"
                            id="cover-upload"
                        />
                    </label>
                </div>

                {file && (
                    <>
                        <input
                            type="text"
                            placeholder="Title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[rgba(36,92,122,0.14)]"
                            required
                        />
                        <input
                            type="text"
                            placeholder="Author"
                            value={author}
                            onChange={(e) => setAuthor(e.target.value)}
                            className="min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[rgba(36,92,122,0.14)]"
                        />
                        <input
                            type="text"
                            placeholder="Tags, comma separated"
                            value={tags}
                            onChange={(e) => setTags(e.target.value)}
                            className="min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[rgba(36,92,122,0.14)]"
                        />
                        <textarea
                            placeholder="Notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="min-h-20 resize-y rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[rgba(36,92,122,0.14)]"
                        />
                        <button
                            type="submit"
                            disabled={uploading}
                            className="min-h-11 rounded-lg bg-[var(--primary)] px-4 text-sm font-extrabold text-white disabled:opacity-[0.65] hover:bg-[var(--primary-strong)]"
                        >
                            {uploading ? "Uploading..." : "Upload book"}
                        </button>
                    </>
                )}
            </form>
        </div>
    );
}
