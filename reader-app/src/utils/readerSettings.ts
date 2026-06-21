import { doc, getDoc, setDoc } from "firebase/firestore";
import { User } from "firebase/auth";
import { db } from "@/firebase/config";
import { EpubReaderSettings, PdfReaderSettings } from "@/types";

const EPUB_SETTINGS_PREFIX = "reader-settings:epub:";
const PDF_SETTINGS_PREFIX = "reader-settings:pdf:";

export const DEFAULT_EPUB_SETTINGS: EpubReaderSettings = {
    fontSize: 100,
    lineHeight: 1.6,
    pageWidth: 720,
};

export const DEFAULT_PDF_SETTINGS: PdfReaderSettings = {
    zoom: 1,
    pageMode: "single",
};

const canUseLocalStorage = () => typeof window !== "undefined" && "localStorage" in window;

const getSettingsKey = (prefix: string, userId?: string) => `${prefix}${userId || "anonymous"}`;

const readSettings = <T>(key: string, defaults: T) => {
    if (!canUseLocalStorage()) return defaults;

    try {
        const raw = localStorage.getItem(key);
        return raw ? { ...defaults, ...JSON.parse(raw) } as T : defaults;
    } catch {
        return defaults;
    }
};

export const getEpubSettings = (userId?: string) => readSettings(getSettingsKey(EPUB_SETTINGS_PREFIX, userId), DEFAULT_EPUB_SETTINGS);
export const getPdfSettings = (userId?: string) => readSettings(getSettingsKey(PDF_SETTINGS_PREFIX, userId), DEFAULT_PDF_SETTINGS);

export const saveEpubSettings = async (user: User | null | undefined, settings: EpubReaderSettings) => {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(getSettingsKey(EPUB_SETTINGS_PREFIX, user?.uid), JSON.stringify(settings));
    if (user) {
        await setDoc(doc(db, "readerSettings", `${user.uid}_epub`), {
            userId: user.uid,
            kind: "epub",
            settings,
            updatedAt: Date.now(),
        }, { merge: true });
    }
};

export const savePdfSettings = async (user: User | null | undefined, settings: PdfReaderSettings) => {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(getSettingsKey(PDF_SETTINGS_PREFIX, user?.uid), JSON.stringify(settings));
    if (user) {
        await setDoc(doc(db, "readerSettings", `${user.uid}_pdf`), {
            userId: user.uid,
            kind: "pdf",
            settings,
            updatedAt: Date.now(),
        }, { merge: true });
    }
};

export const loadEpubSettings = async (user: User | null | undefined) => {
    if (!user) return getEpubSettings();
    try {
        const snap = await getDoc(doc(db, "readerSettings", `${user.uid}_epub`));
        const settings = snap.exists() ? { ...DEFAULT_EPUB_SETTINGS, ...snap.data().settings } as EpubReaderSettings : getEpubSettings(user.uid);
        localStorage.setItem(getSettingsKey(EPUB_SETTINGS_PREFIX, user.uid), JSON.stringify(settings));
        return settings;
    } catch {
        return getEpubSettings(user.uid);
    }
};

export const loadPdfSettings = async (user: User | null | undefined) => {
    if (!user) return getPdfSettings();
    try {
        const snap = await getDoc(doc(db, "readerSettings", `${user.uid}_pdf`));
        const settings = snap.exists() ? { ...DEFAULT_PDF_SETTINGS, ...snap.data().settings } as PdfReaderSettings : getPdfSettings(user.uid);
        localStorage.setItem(getSettingsKey(PDF_SETTINGS_PREFIX, user.uid), JSON.stringify(settings));
        return settings;
    } catch {
        return getPdfSettings(user.uid);
    }
};
