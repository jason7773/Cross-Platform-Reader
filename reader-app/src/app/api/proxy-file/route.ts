import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get("url");

    if (!url) {
        return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    try {
        console.log(`Proxying ePub from: ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`Proxy fetch failed: ${response.status} ${response.statusText}`);
            throw new Error(`Failed to fetch: ${response.statusText}`);
        }

        const contentType = response.headers.get("Content-Type") || "application/octet-stream";
        console.log(`Fetched successfully. Content-Type: ${contentType}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        return new NextResponse(buffer, {
            headers: {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=3600" // Cache for 1 hour
            },
        });
    } catch (error: any) {
        console.error("Proxy error:", error);
        return NextResponse.json({ error: "Failed to fetch file", details: error.message }, { status: 500 });
    }
}
