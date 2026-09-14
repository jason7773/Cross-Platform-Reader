"use client";

import { useEffect, useState } from "react";
import type { Book } from "@/types";

export default function LocalLibrary() {
    const [books, setBooks] = useState<Book[]>([]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [csrf, setCsrf] = useState("");
    const load = async () => {
        const session = await fetch("/api/v1/auth/session", { cache: "no-store" });
        const sessionPayload = await session.json() as { csrfToken?: string };
        if (sessionPayload.csrfToken) setCsrf(sessionPayload.csrfToken);
        const response = await fetch("/api/v1/books", { cache: "no-store" });
        const payload = await response.json() as { books?: Book[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load books.");
        setBooks(payload.books || []);
    };
    useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load books.")); }, []);
    const upload = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setBusy(true); setError("");
        try {
            const response = await fetch("/api/v1/books", { method: "POST", headers: csrf ? { "x-csrf-token": csrf } : undefined, body: data });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error || "Upload failed.");
            form.reset(); await load();
        } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
        finally { setBusy(false); }
    };
    const remove = async (id: string) => { if (!window.confirm("Delete this book?")) return; await fetch(`/api/v1/books/${encodeURIComponent(id)}`, { method: "DELETE", headers: csrf ? { "x-csrf-token": csrf } : undefined }); await load(); };
    return <section className="mx-auto grid max-w-6xl gap-4 px-4 py-5">
        <form onSubmit={upload} className="grid gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--surface)] p-4">
            <strong>Upload a book</strong><input name="file" type="file" accept=".pdf,.epub" required />
            <input name="title" placeholder="Title" required /><input name="author" placeholder="Author" />
            <input name="tags" placeholder="Tags, comma separated" /><textarea name="notes" placeholder="Notes" />
            <button disabled={busy} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-white">{busy ? "Uploading…" : "Upload"}</button>
        </form>
        {error && <p className="rounded bg-red-500/10 p-3 text-[var(--danger)]">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{books.map((book) => <article key={book.id} className="rounded-lg border border-[var(--card-border)] bg-[var(--surface)] p-4">
            <h2 className="m-0 font-bold">{book.title}</h2><p className="text-sm text-[var(--muted)]">{book.author || "Unknown"} · {book.format.toUpperCase()}</p>
            <div className="mt-3 flex gap-2"><a className="rounded bg-[var(--primary)] px-3 py-2 text-sm text-white" href={book.url} target="_blank" rel="noreferrer">Open</a><button className="rounded border px-3 py-2 text-sm" onClick={() => void remove(book.id)}>Delete</button></div>
        </article>)}</div>
    </section>;
}
