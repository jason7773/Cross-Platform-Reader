import { EpubReaderSettings, PdfReaderSettings } from "@/types";

const EPUB_SETTINGS_KEY = "reader-settings:epub";
const PDF_SETTINGS_KEY = "reader-settings:pdf";

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

const readSettings = <T>(key: string, defaults: T) => {
    if (!canUseLocalStorage()) return defaults;

    try {
        const raw = localStorage.getItem(key);
        return raw ? { ...defaults, ...JSON.parse(raw) } as T : defaults;
    } catch {
        return defaults;
    }
};

export const getEpubSettings = () => readSettings(EPUB_SETTINGS_KEY, DEFAULT_EPUB_SETTINGS);
export const getPdfSettings = () => readSettings(PDF_SETTINGS_KEY, DEFAULT_PDF_SETTINGS);

export const saveEpubSettings = (settings: EpubReaderSettings) => {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(EPUB_SETTINGS_KEY, JSON.stringify(settings));
};

export const savePdfSettings = (settings: PdfReaderSettings) => {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(PDF_SETTINGS_KEY, JSON.stringify(settings));
};
