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
    const rows = getLocalDb().prepare("SELECT data_json FROM highlights WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC")
        .all(session.user.id, bookId) as { data_json: string }[];
    return apiJson({ highlights: rows.map((row) => JSON.parse(row.data_json)) });
}

export async function PUT(request: Request, context: RouteContext) {
    const session = await requireMutationSession(request);
    if (isApiError(session)) return session;
    return withApiError(async () => {
        const bookId = (await context.params).bookId;
        if (!ownedBook(session.user.id, bookId)) return apiError("Book not found.", 404);
        const body = await request.json() as Record<string, unknown>;
        if (!validLocation(body.location)) return apiError("A valid highlight location is required.");
        const id = typeof body.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(body.id) ? body.id : randomUUID();
        const existing = getLocalDb().prepare("SELECT user_id, book_id, created_at FROM highlights WHERE id = ?").get(id) as { user_id: string; book_id: string; created_at: number } | undefined;
        if (existing && (existing.user_id !== session.user.id || existing.book_id !== bookId)) return apiError("Highlight not found.", 404);
        const now = Date.now();
        const highlight = {
            id, userId: session.user.id, bookId,
            label: boundedString(body.label, "Label", 500),
            text: boundedString(body.text, "Selected text", 10000),
            note: boundedString(body.note, "Note", 5000),
            location: body.location,
            paragraphIndex: typeof body.paragraphIndex === "number" && Number.isInteger(body.paragraphIndex) ? body.paragraphIndex : undefined,
            selectedText: typeof body.selectedText === "string" ? boundedString(body.selectedText, "Selected text", 10000) : undefined,
            occurrence: typeof body.occurrence === "number" && Number.isInteger(body.occurrence) ? body.occurrence : undefined,
            rects: Array.isArray(body.rects) ? body.rects.slice(0, 100) : undefined,
            percentage: typeof body.percentage === "number" && Number.isFinite(body.percentage) ? Math.max(0, Math.min(100, body.percentage)) : undefined,
            color: typeof body.color === "string" ? boundedString(body.color, "Color", 32) : "yellow",
            createdAt: existing?.created_at || now,
            updatedAt: now,
        };
        if (existing) getLocalDb().prepare("UPDATE highlights SET data_json = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(highlight), now, id, session.user.id);
        else getLocalDb().prepare("INSERT INTO highlights (id, user_id, book_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(id, session.user.id, bookId, JSON.stringify(highlight), now, now);
        return apiJson({ highlight });
    });
}

export async function DELETE(request: Request, context: RouteContext) {
    const session = await requireMutationSession(request);
    if (isApiError(session)) return session;
    const bookId = (await context.params).bookId;
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !ownedBook(session.user.id, bookId)) return apiError("Highlight not found.", 404);
    const result = getLocalDb().prepare("DELETE FROM highlights WHERE id = ? AND user_id = ? AND book_id = ?").run(id, session.user.id, bookId);
    return result.changes ? apiJson({ ok: true }) : apiError("Highlight not found.", 404);
}
