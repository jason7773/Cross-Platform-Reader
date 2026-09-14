import { apiError, apiJson, isApiError, requireMutationSession, requireSession, withApiError } from "@/server/api";
import { getLocalDb } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const validKind = (value: unknown): value is "epub" | "pdf" => value === "epub" || value === "pdf";

export async function GET(request: Request) {
    const session = await requireSession();
    if (isApiError(session)) return session;
    const kind = new URL(request.url).searchParams.get("kind");
    if (!validKind(kind)) return apiError("kind must be epub or pdf.");
    const row = getLocalDb().prepare("SELECT data_json FROM reader_settings WHERE user_id = ? AND kind = ?")
        .get(session.user.id, kind) as { data_json: string } | undefined;
    return apiJson({ kind, settings: row ? JSON.parse(row.data_json) : null });
}

export async function PUT(request: Request) {
    const session = await requireMutationSession(request);
    if (isApiError(session)) return session;
    return withApiError(async () => {
        const body = await request.json() as { kind?: unknown; settings?: unknown };
        if (!validKind(body.kind) || !body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) return apiError("A settings object and valid kind are required.");
        const payload = JSON.stringify(body.settings);
        if (payload.length > 10000) return apiError("Settings are too large.");
        getLocalDb().prepare(`
            INSERT INTO reader_settings (user_id, kind, data_json, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, kind) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
        `).run(session.user.id, body.kind, payload, Date.now());
        return apiJson({ kind: body.kind, settings: body.settings });
    });
}
