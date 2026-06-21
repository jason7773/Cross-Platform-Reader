import { User } from "firebase/auth";
import { collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { listAll, ref, deleteObject } from "firebase/storage";
import { db, storage } from "@/firebase/config";
import { clearUserLocalData } from "@/utils/localUserData";

const getUserDocs = async (collectionName: string, field: "userId" | "uploadedBy", userId: string) => {
    const snapshot = await getDocs(query(collection(db, collectionName), where(field, "==", userId)));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
};

export const exportUserData = async (user: User) => {
    const payload = {
        exportedAt: new Date().toISOString(),
        user: {
            uid: user.uid,
            email: user.email,
        },
        books: await getUserDocs("books", "uploadedBy", user.uid),
        progress: await getUserDocs("progress", "userId", user.uid),
        bookmarks: await getUserDocs("bookmarks", "userId", user.uid),
        highlights: await getUserDocs("highlights", "userId", user.uid),
        readerSettings: await getUserDocs("readerSettings", "userId", user.uid),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reader-export-${user.uid}-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
};

const deleteCollectionDocs = async (collectionName: string, field: "userId" | "uploadedBy", userId: string) => {
    const snapshot = await getDocs(query(collection(db, collectionName), where(field, "==", userId)));
    await Promise.all(snapshot.docs.map((item) => deleteDoc(doc(db, collectionName, item.id))));
};

const deleteStoragePrefix = async (path: string) => {
    const result = await listAll(ref(storage, path));
    await Promise.all(result.items.map((item) => deleteObject(item)));
};

export const deleteUserData = async (user: User) => {
    await Promise.all([
        deleteCollectionDocs("bookmarks", "userId", user.uid),
        deleteCollectionDocs("highlights", "userId", user.uid),
        deleteCollectionDocs("readerSettings", "userId", user.uid),
        deleteCollectionDocs("progress", "userId", user.uid),
        deleteCollectionDocs("books", "uploadedBy", user.uid),
        deleteStoragePrefix(`books/${user.uid}`),
        deleteStoragePrefix(`covers/${user.uid}`),
    ]);
    await clearUserLocalData(user.uid);
};
