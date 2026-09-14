import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { apiError, isApiError, requireSession } from "@/server/api";
import { getStorageFilePath, ownedBook, storageStream } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ bookId: string }> };

export async function GET(_: Request, context: RouteContext) {
    const session = await requireSession();
    if (isApiError(session)) return session;
    const book = ownedBook(session.user.id, (await context.params).bookId);
    if (!book || !book.cover_storage_path || !book.cover_mime_type) return apiError("Cover not found.", 404);
    try {
        const size = (await stat(getStorageFilePath(book.cover_storage_path))).size;
        const stream = Readable.toWeb(storageStream(book.cover_storage_path)) as unknown as ReadableStream<Uint8Array>;
        return new Response(stream, {
            headers: {
                "Content-Type": book.cover_mime_type,
                "Content-Length": String(size),
                "Cache-Control": "private, no-store",
                "Content-Disposition": "inline",
            },
        });
    } catch {
        return apiError("Cover file is unavailable.", 404);
    }
}
