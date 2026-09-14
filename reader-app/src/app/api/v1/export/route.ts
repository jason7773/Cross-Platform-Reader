import { apiError, isApiError, requireSession } from "@/server/api";
import { getLocalDb, publicBook, type LocalBookRow } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const session = await requireSession();
    if (isApiError(session)) return session;
    const db = getLocalDb();
    const userId = session.user.id;
    const parseRows = (table: "bookmarks" | "highlights") => db.prepare(`SELECT data_json FROM ${table} WHERE user_id = ?`).all(userId) as { data_json: string }[];
    try {
        const books = db.prepare("SELECT * FROM books WHERE owner_id = ? ORDER BY created_at DESC").all(userId) as LocalBookRow[];
        const progressRows = db.prepare("SELECT book_id, location_json, percentage, last_read FROM progress WHERE user_id = ?").all(userId) as { book_id: string; location_json: string; percentage: number | null; last_read: number }[];
        const settingsRows = db.prepare("SELECT kind, data_json, updated_at FROM reader_settings WHERE user_id = ?").all(userId) as { kind: string; data_json: string; updated_at: number }[];
        const payload = {
            exportedAt: new Date().toISOString(),
            user: { uid: userId, email: session.user.email },
            books: books.map(publicBook),
            progress: progressRows.map((row) => ({ userId, bookId: row.book_id, location: JSON.parse(row.location_json), percentage: row.percentage ?? undefined, lastRead: row.last_read })),
            bookmarks: parseRows("bookmarks").map((row) => JSON.parse(row.data_json)),
            highlights: parseRows("highlights").map((row) => JSON.parse(row.data_json)),
            readerSettings: settingsRows.map((row) => ({ userId, kind: row.kind, settings: JSON.parse(row.data_json), updatedAt: row.updated_at })),
            note: "This export contains library metadata and reading data. It does not contain book or cover files.",
        };
        return new Response(JSON.stringify(payload, null, 2), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Disposition": `attachment; filename=reader-export-${userId}-${Date.now()}.json`,
                "Cache-Control": "private, no-store",
            },
        });
    } catch {
        return apiError("Could not export library data.", 500);
    }
}
