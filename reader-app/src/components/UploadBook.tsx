"use client";
import { useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, addDoc } from "firebase/firestore";
import { storage, db } from "@/firebase/config";
import { useAuth } from "@/context/AuthContext";
import styles from "./UploadBook.module.css";
import { Book } from "@/types";
import { cacheUploadedBook } from "@/utils/bookCache";

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : "Upload failed";
const MAX_BOOK_SIZE_BYTES = 100 * 1024 * 1024;
const COVER_MAX_WIDTH = 480;
const COVER_MAX_HEIGHT = 640;
const COVER_QUALITY = 0.78;

const immutableFileMetadata = (contentType: string) => ({
    contentType,
    cacheControl: "public, max-age=31536000, immutable",
});

const getBookContentType = (format: "pdf" | "epub", fallback: string) => {
    if (fallback) return fallback;
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
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            setFile(selectedFile);
            const fileName = selectedFile.name.replace(/\.[^/.]+$/, "");
            setTitle(fileName);
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

            // 1. Upload book file to Storage
            const storagePath = `books/${user.uid}/${Date.now()}_${file.name}`;
            const storageRef = ref(storage, storagePath);
            const snapshot = await uploadBytes(
                storageRef,
                file,
                immutableFileMetadata(getBookContentType(format, file.type))
            );
            const url = await getDownloadURL(snapshot.ref);
            cacheUploadedBook(url, file, getBookContentType(format, file.type)).catch((err) => {
                console.warn("Book uploaded, but local offline cache failed:", err);
            });

            // 2. Upload cover image (Manual or Auto-generated)
            let coverUrl = "";
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

            let coverStoragePath = "";
            if (finalCoverBlob) {
                finalCoverBlob = await resizeCoverImage(finalCoverBlob);
                const coverName = `cover_${Date.now()}.jpg`;
                coverStoragePath = `covers/${user.uid}/${Date.now()}_${coverName}`;
                const coverRef = ref(storage, coverStoragePath);
                const coverSnapshot = await uploadBytes(
                    coverRef,
                    finalCoverBlob,
                    immutableFileMetadata("image/jpeg")
                );
                coverUrl = await getDownloadURL(coverSnapshot.ref);
            }

            // 3. Save metadata to Firestore
            const newBook: Omit<Book, "id"> = {
                title,
                author: author || "Unknown",
                format,
                url,
                coverUrl,
                storagePath,
                coverStoragePath,
                fileSize: file.size,
                mimeType: getBookContentType(format, file.type),
                ...(finalCoverBlob ? {
                    coverSize: finalCoverBlob.size,
                    coverMimeType: "image/jpeg",
                } : {}),
                uploadedBy: user.uid,
                createdAt: Date.now(),
            };

            await addDoc(collection(db, "books"), newBook);

            setFile(null);
            setCoverFile(null);
            setTitle("");
            setAuthor("");
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
        <div className={styles.container}>
            <h3>Upload New Book</h3>
            {error && <p className={styles.error}>{error}</p>}
            {success && <p className={styles.success}>{success}</p>}
            <form onSubmit={handleUpload} className={styles.form}>
                <div className={styles.dropZone}>
                    <input
                        type="file"
                        accept=".pdf,.epub"
                        onChange={handleFileChange}
                        className={styles.fileInput}
                        id="book-upload"
                    />
                    <label htmlFor="book-upload" className={styles.fileLabel}>
                        {file ? file.name : "Click to select PDF or ePub"}
                    </label>
                </div>

                <div className={styles.dropZone} style={{ marginTop: '10px' }}>
                    <input
                        type="file"
                        accept="image/*"
                        onChange={handleCoverChange}
                        className={styles.fileInput}
                        id="cover-upload"
                    />
                    <label htmlFor="cover-upload" className={styles.fileLabel}>
                        {coverFile ? coverFile.name : "Click to select Cover Image (Optional)"}
                    </label>
                </div>

                {file && (
                    <>
                        <input
                            type="text"
                            placeholder="Title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className={styles.input}
                            required
                        />
                        <input
                            type="text"
                            placeholder="Author"
                            value={author}
                            onChange={(e) => setAuthor(e.target.value)}
                            className={styles.input}
                        />
                        <button type="submit" disabled={uploading} className={styles.button}>
                            {uploading ? "Uploading..." : "Upload Book"}
                        </button>
                    </>
                )}
            </form>
        </div>
    );
}
