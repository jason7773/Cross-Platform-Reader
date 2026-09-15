import { cookies } from "next/headers";
import { apiJson, isApiError, requireMutationSession } from "@/server/api";
import { getSessionCookieName, removeSession, sessionCookieOptions } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const session = await requireMutationSession(request);
    if (isApiError(session)) return session;
    removeSession((await cookies()).get(getSessionCookieName())?.value);
    const response = apiJson({ ok: true });
    response.cookies.set(getSessionCookieName(), "", sessionCookieOptions());
    return response;
}
