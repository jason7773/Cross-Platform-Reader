import { loadBackendServices } from "@/backend";
import { EpubReaderSettings, PdfReaderSettings, SessionUser } from "@/types";

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

export const saveEpubSettings = async (user: SessionUser | null | undefined, settings: EpubReaderSettings) => {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(getSettingsKey(EPUB_SETTINGS_PREFIX, user?.uid), JSON.stringify(settings));
    if (user) {
        const { readerData } = await loadBackendServices();
        await readerData.saveEpubSettings(user.uid, settings);
    }
};

export const savePdfSettings = async (user: SessionUser | null | undefined, settings: PdfReaderSettings) => {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(getSettingsKey(PDF_SETTINGS_PREFIX, user?.uid), JSON.stringify(settings));
    if (user) {
        const { readerData } = await loadBackendServices();
        await readerData.savePdfSettings(user.uid, settings);
    }
};

export const loadEpubSettings = async (user: SessionUser | null | undefined) => {
    if (!user) return getEpubSettings();
    try {
        const { readerData } = await loadBackendServices();
        const stored = await readerData.getEpubSettings(user.uid);
        const settings = stored ? { ...DEFAULT_EPUB_SETTINGS, ...stored } as EpubReaderSettings : getEpubSettings(user.uid);
        localStorage.setItem(getSettingsKey(EPUB_SETTINGS_PREFIX, user.uid), JSON.stringify(settings));
        return settings;
    } catch {
        return getEpubSettings(user.uid);
    }
};

export const loadPdfSettings = async (user: SessionUser | null | undefined) => {
    if (!user) return getPdfSettings();
    try {
        const { readerData } = await loadBackendServices();
        const stored = await readerData.getPdfSettings(user.uid);
        const settings = stored ? { ...DEFAULT_PDF_SETTINGS, ...stored } as PdfReaderSettings : getPdfSettings(user.uid);
        localStorage.setItem(getSettingsKey(PDF_SETTINGS_PREFIX, user.uid), JSON.stringify(settings));
        return settings;
    } catch {
        return getPdfSettings(user.uid);
    }
};
