import { loadBackendServices } from "@/backend";
import { SessionUser } from "@/types";
import { clearUserLocalData } from "@/utils/localUserData";

const downloadJson = (userId: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reader-export-${userId}-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
};

/** This browser export is metadata only. Docker backup is the complete
 * library backup mechanism because book and cover bytes stay private. */
export const exportUserData = async (user: SessionUser) => {
    const { library, readerData } = await loadBackendServices();
    const books = await library.list(user.uid);
    const [progress, bookmarks, highlights, epubSettings, pdfSettings] = await Promise.all([
        readerData.listProgress(user.uid),
        Promise.all(books.map((book) => readerData.listBookmarks(user.uid, book.id))).then((records) => records.flat()),
        Promise.all(books.map((book) => readerData.listHighlights(user.uid, book.id))).then((records) => records.flat()),
        readerData.getEpubSettings(user.uid),
        readerData.getPdfSettings(user.uid),
    ]);
    downloadJson(user.uid, {
        exportedAt: new Date().toISOString(),
        user: { uid: user.uid, email: user.email },
        books,
        progress,
        bookmarks,
        highlights,
        readerSettings: [
            ...(epubSettings ? [{ userId: user.uid, kind: "epub", settings: epubSettings }] : []),
            ...(pdfSettings ? [{ userId: user.uid, kind: "pdf", settings: pdfSettings }] : []),
        ],
        note: "This export contains library metadata and reading data. It does not contain book or cover files.",
    });
};

/** The common repository exposes deletion of book-scoped records and files.
 * Reader settings are not deleted because the contract currently has no
 * settings-delete operation; local browser data is still removed. */
export const deleteUserData = async (user: SessionUser) => {
    const { library, readerData } = await loadBackendServices();
    const books = await library.list(user.uid);
    await Promise.all(books.map(async (book) => {
        const [bookmarks, highlights] = await Promise.all([
            readerData.listBookmarks(user.uid, book.id),
            readerData.listHighlights(user.uid, book.id),
        ]);
        await Promise.all([
            ...bookmarks.map((bookmark) => readerData.removeBookmark(user.uid, book.id, bookmark.id)),
            ...highlights.map((highlight) => readerData.removeHighlight(user.uid, book.id, highlight.id)),
        ]);
        await library.remove(user.uid, book.id);
    }));
    await clearUserLocalData(user.uid);
};
