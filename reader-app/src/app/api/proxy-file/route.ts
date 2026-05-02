import { NextRequest, NextResponse } from "next/server";

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : "Unknown proxy error";

const allowedFileHosts = new Set([
    "firebasestorage.googleapis.com",
    "storage.googleapis.com",
]);

const isAllowedFileUrl = (value: string) => {
    try {
        const parsedUrl = new URL(value);
        return parsedUrl.protocol === "https:" && allowedFileHosts.has(parsedUrl.hostname);
    } catch {
        return false;
    }
};

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get("url");

    if (!url) {
        return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    if (!isAllowedFileUrl(url)) {
        return NextResponse.json({ error: "Unsupported file URL" }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`);
        }

        const contentType = response.headers.get("Content-Type") || "application/octet-stream";
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        return new NextResponse(buffer, {
            headers: {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "private, max-age=300"
            },
        });
    } catch (error: unknown) {
        console.error("Proxy error:", error);
        return NextResponse.json({ error: "Failed to fetch file", details: getErrorMessage(error) }, { status: 500 });
    } finally {
        clearTimeout(timeout);
    }
}
