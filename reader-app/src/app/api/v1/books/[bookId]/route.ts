import { apiError, apiJson, isApiError, requireMutationSession, requireSession, withApiError } from "@/server/api";
import { boundedString, getLocalDb, ownedBook, parseTags, publicBook, removeStorageFile } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ bookId: string }> };

export async function GET(_: Request, context: RouteContext) {
    const session = await requireSession();
    if (isApiError(session)) return session;
    const book = ownedBook(session.user.id, (await context.params).bookId);
    return book ? apiJson({ book: publicBook(book) }) : apiError("Book not found.", 404);
}

export async function PATCH(request: Request, context: RouteContext) {
    const session = await requireMutationSession(request);
    if (isApiError(session)) return session;
    return withApiError(async () => {
        const bookId = (await context.params).bookId;
        const existing = ownedBook(session.user.id, bookId);
        if (!existing) return apiError("Book not found.", 404);
        const body = await request.json() as Record<string, unknown>;
        const title = Object.hasOwn(body, "title") ? boundedString(body.title, "Title", 500, true) : existing.title;
        const author = Object.hasOwn(body, "author") ? boundedString(body.author, "Author", 500) : existing.author;
        const notes = Object.hasOwn(body, "notes") ? boundedString(body.notes, "Notes", 10000) : existing.notes;
        const tags = Object.hasOwn(body, "tags") ? parseTags(body.tags) : JSON.parse(existing.tags_json);
        getLocalDb().prepare("UPDATE books SET title = ?, author = ?, notes = ?, tags_json = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
            .run(title, author, notes, JSON.stringify(tags), Date.now(), bookId, session.user.id);
        return apiJson({ book: publicBook(ownedBook(session.user.id, bookId)!) });
    });
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = await requireMutationSession(request);
    if (isApiError(session)) return session;
    return withApiError(async () => {
        const book = ownedBook(session.user.id, (await context.params).bookId);
        if (!book) return apiError("Book not found.", 404);
        getLocalDb().prepare("DELETE FROM books WHERE id = ? AND owner_id = ?").run(book.id, session.user.id);
        // Database ownership is removed first. A failed file cleanup leaves no route
        // that can serve the object and is safe to retry manually from the data volume.
        await Promise.allSettled([removeStorageFile(book.storage_path), removeStorageFile(book.cover_storage_path)]);
        return apiJson({ ok: true });
    });
}
