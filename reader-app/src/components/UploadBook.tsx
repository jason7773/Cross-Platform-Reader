"use client";
import { useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, addDoc } from "firebase/firestore";
import { storage, db } from "@/firebase/config";
import { useAuth } from "@/context/AuthContext";
import styles from "./UploadBook.module.css";
import { Book } from "@/types";

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : "Upload failed";

export default function UploadBook({ onUploadSuccess }: { onUploadSuccess?: () => void }) {
    const { user } = useAuth();
    const [file, setFile] = useState<File | null>(null);
    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [title, setTitle] = useState("");
    const [author, setAuthor] = useState("");
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState("");

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

        try {
            const fileExt = file.name.split(".").pop()?.toLowerCase();
            let format: 'pdf' | 'epub' = 'pdf';
            if (fileExt === 'epub') format = 'epub';
            else if (fileExt !== 'pdf') {
                throw new Error("Only PDF and ePub formats are supported.");
            }

            // 1. Upload book file to Storage
            const storageRef = ref(storage, `books/${user.uid}/${Date.now()}_${file.name}`);
            const snapshot = await uploadBytes(storageRef, file);
            const url = await getDownloadURL(snapshot.ref);

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

            if (finalCoverBlob) {
                const coverName = coverFile ? coverFile.name : `auto_cover_${Date.now()}.jpg`;
                const coverRef = ref(storage, `covers/${user.uid}/${Date.now()}_${coverName}`);
                const coverSnapshot = await uploadBytes(coverRef, finalCoverBlob);
                coverUrl = await getDownloadURL(coverSnapshot.ref);
            }

            // 3. Save metadata to Firestore
            const newBook: Omit<Book, "id"> = {
                title,
                author: author || "Unknown",
                format,
                url,
                coverUrl,
                uploadedBy: user.uid,
                createdAt: Date.now(),
            };

            await addDoc(collection(db, "books"), newBook);

            setFile(null);
            setCoverFile(null);
            setTitle("");
            setAuthor("");
            if (onUploadSuccess) onUploadSuccess();
            alert("Book uploaded successfully!");
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
