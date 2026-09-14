import { apiError, apiJson, isApiError, requireMutationSession, requireSession, withApiError } from "@/server/api";
import { getLocalDb, ownedBook } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ bookId: string }> };

const validLocation = (value: unknown): value is string | number => typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

export async function GET(_: Request, context: RouteContext) {
    const session = await requireSession();
    if (isApiError(session)) return session;
    const bookId = (await context.params).bookId;
    if (!ownedBook(session.user.id, bookId)) return apiError("Book not found.", 404);
    const row = getLocalDb().prepare("SELECT location_json, percentage, last_read FROM progress WHERE user_id = ? AND book_id = ?")
        .get(session.user.id, bookId) as { location_json: string; percentage: number | null; last_read: number } | undefined;
    return apiJson({ progress: row && { userId: session.user.id, bookId, location: JSON.parse(row.location_json), percentage: row.percentage ?? undefined, lastRead: row.last_read } });
}

export async function PUT(request: Request, context: RouteContext) {
    const session = await requireMutationSession(request);
    if (isApiError(session)) return session;
    return withApiError(async () => {
        const bookId = (await context.params).bookId;
        if (!ownedBook(session.user.id, bookId)) return apiError("Book not found.", 404);
        const body = await request.json() as { location?: unknown; percentage?: unknown; lastRead?: unknown };
        if (!validLocation(body.location)) return apiError("A valid reading location is required.");
        const percentage = typeof body.percentage === "number" && Number.isFinite(body.percentage) ? Math.max(0, Math.min(100, body.percentage)) : null;
        const lastRead = typeof body.lastRead === "number" && Number.isSafeInteger(body.lastRead) ? body.lastRead : Date.now();
        getLocalDb().prepare(`
            INSERT INTO progress (user_id, book_id, location_json, percentage, last_read) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, book_id) DO UPDATE SET location_json = excluded.location_json, percentage = excluded.percentage, last_read = excluded.last_read
        `).run(session.user.id, bookId, JSON.stringify(body.location), percentage, lastRead);
        return apiJson({ progress: { userId: session.user.id, bookId, location: body.location, percentage: percentage ?? undefined, lastRead } });
    });
}
