import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
    RulesTestEnvironment,
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
    doc,
    getDoc,
    setDoc,
} from "firebase/firestore";
import {
    getBytes,
    ref,
    uploadBytes,
} from "firebase/storage";

let testEnv: RulesTestEnvironment;

const validBook = (uid: string) => ({
    title: "Book",
    author: "Author",
    format: "pdf",
    url: "",
    coverUrl: "",
    storagePath: `books/${uid}/book.pdf`,
    coverStoragePath: "",
    fileSize: 100,
    mimeType: "application/pdf",
    uploadedBy: uid,
    createdAt: Date.now(),
    tags: ["research"],
    notes: "private note",
});

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: "reader-rules-test",
        firestore: {
            rules: readFileSync("firestore.rules", "utf8"),
            host: "127.0.0.1",
            port: 8080,
        },
        storage: {
            rules: readFileSync("storage.rules", "utf8"),
            host: "127.0.0.1",
            port: 9199,
        },
    });
});

beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearStorage();
});

afterAll(async () => {
    await testEnv?.cleanup();
});

describe("Firestore rules", () => {
    it("allows owners to create and read valid book metadata", async () => {
        const db = testEnv.authenticatedContext("alice").firestore();
        const bookRef = doc(db, "books/book1");

        await assertSucceeds(setDoc(bookRef, validBook("alice")));
        await assertSucceeds(getDoc(bookRef));
    });

    it("blocks non-owners from reading book metadata", async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), "books/book1"), validBook("alice"));
        });

        const bobDb = testEnv.authenticatedContext("bob").firestore();
        await assertFails(getDoc(doc(bobDb, "books/book1")));
    });

    it("rejects book metadata with another user's storage path", async () => {
        const db = testEnv.authenticatedContext("alice").firestore();
        await assertFails(setDoc(doc(db, "books/book1"), {
            ...validBook("alice"),
            storagePath: "books/bob/book.pdf",
        }));
    });

    it("allows owner-scoped progress, bookmarks, highlights, and reader settings", async () => {
        const db = testEnv.authenticatedContext("alice").firestore();

        await assertSucceeds(setDoc(doc(db, "progress/alice_book1"), {
            userId: "alice",
            bookId: "book1",
            location: 1,
            percentage: 10,
            lastRead: Date.now(),
        }));
        await assertSucceeds(setDoc(doc(db, "bookmarks/alice_mark1"), {
            id: "mark1",
            userId: "alice",
            bookId: "book1",
            label: "Page 1",
            note: "",
            location: 1,
            percentage: 10,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }));
        await assertSucceeds(setDoc(doc(db, "highlights/alice_high1"), {
            id: "high1",
            userId: "alice",
            bookId: "book1",
            label: "Page 1",
            text: "Page 1",
            note: "",
            location: 1,
            paragraphIndex: 0,
            selectedText: "Page 1",
            occurrence: 0,
            rects: [{ page: 1, x: 10, y: 10, width: 20, height: 5 }],
            percentage: 10,
            color: "#ead8b7",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }));
        await assertSucceeds(setDoc(doc(db, "readerSettings/alice_pdf"), {
            userId: "alice",
            kind: "pdf",
            settings: { zoom: 1, pageMode: "single" },
            updatedAt: Date.now(),
        }));
    });

    it("blocks cross-owner writes", async () => {
        const db = testEnv.authenticatedContext("alice").firestore();
        await assertFails(setDoc(doc(db, "progress/bob_book1"), {
            userId: "bob",
            bookId: "book1",
            location: 1,
            lastRead: Date.now(),
        }));
    });
});

describe("Storage rules", () => {
    it("allows owner PDF uploads and reads", async () => {
        const storage = testEnv.authenticatedContext("alice").storage();
        const fileRef = ref(storage, "books/alice/book.pdf");

        await assertSucceeds(uploadBytes(fileRef, new Blob(["pdf"]), { contentType: "application/pdf" }));
        await assertSucceeds(getBytes(fileRef));
    });

    it("blocks cross-owner uploads", async () => {
        const storage = testEnv.authenticatedContext("alice").storage();
        await assertFails(uploadBytes(ref(storage, "books/bob/book.pdf"), new Blob(["pdf"]), { contentType: "application/pdf" }));
    });

    it("rejects octet-stream book uploads", async () => {
        const storage = testEnv.authenticatedContext("alice").storage();
        await assertFails(uploadBytes(ref(storage, "books/alice/book.bin"), new Blob(["data"]), { contentType: "application/octet-stream" }));
    });

    it("blocks non-owner reads", async () => {
        const aliceStorage = testEnv.authenticatedContext("alice").storage();
        const bobStorage = testEnv.authenticatedContext("bob").storage();
        await uploadBytes(ref(aliceStorage, "books/alice/book.pdf"), new Blob(["pdf"]), { contentType: "application/pdf" });

        await assertFails(getBytes(ref(bobStorage, "books/alice/book.pdf")));
    });
});
