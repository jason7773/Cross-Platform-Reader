import JSZip from "jszip";

export type EpubSearchResult = {
    href: string;
    label: string;
    snippet: string;
};

const stripHtml = (value: string) => value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getSnippet = (text: string, index: number, length: number) => {
    const start = Math.max(0, index - 60);
    const end = Math.min(text.length, index + length + 90);
    return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
};

export const searchEpub = async (data: ArrayBuffer, query: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [] as EpubSearchResult[];

    const zip = await JSZip.loadAsync(data);
    const files = Object.values(zip.files)
        .filter((file) => !file.dir && /\.(xhtml|html|htm)$/i.test(file.name));
    const results: EpubSearchResult[] = [];

    for (const file of files) {
        if (results.length >= 30) break;

        const html = await file.async("string");
        const text = stripHtml(html);
        const index = text.toLowerCase().indexOf(normalizedQuery);

        if (index >= 0) {
            results.push({
                href: file.name,
                label: file.name.split("/").at(-1) || file.name,
                snippet: getSnippet(text, index, normalizedQuery.length),
            });
        }
    }

    return results;
};
