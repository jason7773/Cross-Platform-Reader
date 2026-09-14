import { randomUUID } from "node:crypto";
import { apiError, apiJson, isApiError, requireMutationSession, requireSession, withApiError } from "@/server/api";
import { boundedString, getLocalDb, ownedBook } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ bookId: string }> };
const validLocation = (value: unknown): value is string | number => typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

export async function GET(_: Request, context: RouteContext) {
    const session = await requireSession();
    if (isApiError(session)) return session;
    const bookId = (await context.params).bookId;
    if (!ownedBook(session.user.id, bookId)) return apiError("Book not found.", 404);
    const rows = getLocalDb().prepare("SELECT data_json FROM bookmarks WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC")
        .all(session.user.id, bookId) as { data_json: string }[];
    return apiJson({ bookmarks: rows.map((row) => JSON.parse(row.data_json)) });
}

export async function PUT(request: Request, context: RouteContext) {
    const session = await requireMutationSession(request);
    if (isApiError(session)) return session;
    return withApiError(async () => {
        const bookId = (await context.params).bookId;
        if (!ownedBook(session.user.id, bookId)) return apiError("Book not found.", 404);
        const body = await request.json() as Record<string, unknown>;
        if (!validLocation(body.location)) return apiError("A valid bookmark location is required.");
        const id = typeof body.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(body.id) ? body.id : randomUUID();
        const existing = getLocalDb().prepare("SELECT user_id, book_id, created_at FROM bookmarks WHERE id = ?").get(id) as { user_id: string; book_id: string; created_at: number } | undefined;
        if (existing && (existing.user_id !== session.user.id || existing.book_id !== bookId)) return apiError("Bookmark not found.", 404);
        const now = Date.now();
        const bookmark = {
            id, userId: session.user.id, bookId,
            label: boundedString(body.label, "Label", 500),
            note: boundedString(body.note, "Note", 5000),
            location: body.location,
            percentage: typeof body.percentage === "number" && Number.isFinite(body.percentage) ? Math.max(0, Math.min(100, body.percentage)) : undefined,
            createdAt: existing?.created_at || now,
            updatedAt: now,
        };
        if (existing) getLocalDb().prepare("UPDATE bookmarks SET data_json = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(bookmark), now, id, session.user.id);
        else getLocalDb().prepare("INSERT INTO bookmarks (id, user_id, book_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(id, session.user.id, bookId, JSON.stringify(bookmark), now, now);
        return apiJson({ bookmark });
    });
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = await requireMutationSession(request);
    if (isApiError(session)) return session;
    const bookId = (await context.params).bookId;
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !ownedBook(session.user.id, bookId)) return apiError("Bookmark not found.", 404);
    const result = getLocalDb().prepare("DELETE FROM bookmarks WHERE id = ? AND user_id = ? AND book_id = ?").run(id, session.user.id, bookId);
    return result.changes ? apiJson({ ok: true }) : apiError("Bookmark not found.", 404);
}
