import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { apiError, isApiError, requireSession } from "@/server/api";
import { getStorageFilePath, ownedBook, storageStream } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ bookId: string }> };

const byteRange = (value: string | null, length: number) => {
    if (!value) return null;
    const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
    if (!match) return "invalid" as const;
    const [, startValue, endValue] = match;
    if (!startValue && !endValue) return "invalid" as const;
    if (!startValue) {
        const suffix = Number(endValue);
        if (!Number.isInteger(suffix) || suffix <= 0) return "invalid" as const;
        return { start: Math.max(0, length - suffix), end: length - 1 };
    }
    const start = Number(startValue);
    const end = endValue ? Number(endValue) : length - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= length) return "invalid" as const;
    return { start, end: Math.min(end, length - 1) };
};

export async function GET(request: Request, context: RouteContext) {
    const session = await requireSession();
    if (isApiError(session)) return session;
    const book = ownedBook(session.user.id, (await context.params).bookId);
    if (!book) return apiError("Book not found.", 404);
    let size: number;
    try {
        size = (await stat(getStorageFilePath(book.storage_path))).size;
    } catch {
        return apiError("Book file is unavailable.", 404);
    }
    const range = byteRange(request.headers.get("range"), size);
    if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Cache-Control": "private, no-store" } });
    const selected = range || { start: 0, end: size - 1 };
    const stream = Readable.toWeb(storageStream(book.storage_path, range || undefined)) as unknown as ReadableStream<Uint8Array>;
    const length = selected.end - selected.start + 1;
    return new Response(stream, {
        status: range ? 206 : 200,
        headers: {
            "Content-Type": book.mime_type,
            "Content-Length": String(length),
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, no-store",
            "Content-Disposition": "inline",
            ...(range ? { "Content-Range": `bytes ${selected.start}-${selected.end}/${size}` } : {}),
        },
    });
}
