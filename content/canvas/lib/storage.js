const STORAGE_KEY = "duedeckCanvasPanelLayout";
const LEGACY_STORAGE_KEY = "duedeckOverlayLayout";

export const DEFAULT_LAYOUT = {
    panelHeight: 688,
    panelWidth: 420,
    panelX: null,
    panelY: null,
};

export function getStoredLayout() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([STORAGE_KEY, LEGACY_STORAGE_KEY], (result) => {
            resolve({
                ...DEFAULT_LAYOUT,
                ...(result?.[LEGACY_STORAGE_KEY] || {}),
                ...(result?.[STORAGE_KEY] || {}),
            });
        });
    });
}

export function setStoredLayout(layout) {
    try {
        chrome.storage?.local?.set({ [STORAGE_KEY]: layout });
    } catch {
        // Extension context was invalidated (e.g. reloaded while tab was open)
    }
}
