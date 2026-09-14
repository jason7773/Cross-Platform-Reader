import { cookies } from "next/headers";
import { apiJson, isApiError, requireMutationSession, requireSession } from "@/server/api";
import { getSessionCookieName, removeSession, sessionCookieOptions } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const session = request.headers.get("x-csrf-token") ? await requireMutationSession(request) : await requireSession();
    if (isApiError(session)) return session;
    removeSession((await cookies()).get(getSessionCookieName())?.value);
    const response = apiJson({ ok: true });
    response.cookies.set(getSessionCookieName(), "", sessionCookieOptions());
    return response;
}
