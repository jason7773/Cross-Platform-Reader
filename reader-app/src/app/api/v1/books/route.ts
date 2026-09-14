import { apiError, apiJson, isApiError, requireMutationSession, requireSession, withApiError } from "@/server/api";
import {
    boundedString,
    contentTypeForBook,
    fileExtensionForBook,
    getLocalDb,
    parseTags,
    publicBook,
    removeStorageFile,
    verifyBookFile,
    writeUploadedFile,
    type LocalBookRow,
} from "@/server/local";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BOOK_BYTES = 100 * 1024 * 1024;
const MAX_COVER_BYTES = 2 * 1024 * 1024;
const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const formFile = (form: FormData, name: string) => {
    const value = form.get(name);
    return value && typeof value !== "string" ? value as File : null;
};

export async function GET() {
    const session = await requireSession();
    if (isApiError(session)) return session;
    const books = getLocalDb().prepare("SELECT * FROM books WHERE owner_id = ? ORDER BY created_at DESC")
        .all(session.user.id) as LocalBookRow[];
    return apiJson({ books: books.map(publicBook) });
}

export async function POST(request: Request) {
    const session = await requireMutationSession(request);
    if (isApiError(session)) return session;
    return withApiError(async () => {
        const form = await request.formData();
        const file = formFile(form, "file");
        if (!file) return apiError("A PDF or ePub file is required.");
        if (file.size <= 0 || file.size > MAX_BOOK_BYTES) return apiError("Books must be between 1 byte and 100 MiB.");
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (extension !== "pdf" && extension !== "epub") return apiError("Only PDF and ePub files are supported.");
        const format = extension;
        await verifyBookFile(format, file);

        const title = boundedString(form.get("title"), "Title", 500, true);
        const author = boundedString(form.get("author"), "Author", 500);
        const notes = boundedString(form.get("notes"), "Notes", 10000);
        const tags = parseTags(form.get("tags"));
        const cover = formFile(form, "cover");
        if (cover && (cover.size <= 0 || cover.size > MAX_COVER_BYTES || !COVER_TYPES.has(cover.type))) {
            return apiError("Covers must be JPEG, PNG, or WebP images up to 2 MiB.");
        }

        const now = Date.now();
        const id = randomUUID();
        let storagePath: string | undefined;
        let coverStoragePath: string | undefined;
        try {
            storagePath = await writeUploadedFile("books", session.user.id, file, fileExtensionForBook(format, file.type));
            if (cover) {
                const coverExtension = cover.type === "image/png" ? "png" : cover.type === "image/webp" ? "webp" : "jpg";
                coverStoragePath = await writeUploadedFile("covers", session.user.id, cover, coverExtension);
            }
            getLocalDb().prepare(`
                INSERT INTO books (id, owner_id, title, author, format, storage_path, cover_storage_path, file_size, mime_type, cover_size, cover_mime_type, tags_json, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id, session.user.id, title, author, format, storagePath, coverStoragePath || null, file.size, contentTypeForBook(format),
                cover?.size || null, cover?.type || null, JSON.stringify(tags), notes, now, now
            );
        } catch (error) {
            await Promise.all([removeStorageFile(storagePath), removeStorageFile(coverStoragePath)]);
            throw error;
        }
        const book = getLocalDb().prepare("SELECT * FROM books WHERE id = ?").get(id) as LocalBookRow;
        return apiJson({ book: publicBook(book) }, 201);
    });
}
