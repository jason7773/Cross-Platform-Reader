import { apiJson, isApiError, requireSession } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const session = await requireSession();
    if (isApiError(session)) return session;
    return apiJson({ user: { uid: session.user.id, email: session.user.email }, csrfToken: session.csrfToken });
}
