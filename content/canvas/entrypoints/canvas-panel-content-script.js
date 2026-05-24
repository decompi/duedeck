const DUEDECK_HOST_ID = "duedeck-canvas-panel-host";
const OPEN_ATTRIBUTE = "data-open";
const LEGACY_STORAGE_KEY = "duedeckOverlayLayout";
const STORAGE_KEY = "duedeckCanvasPanelLayout";

const DEFAULT_LAYOUT = {
    panelHeight: 688,
    panelWidth: 420,
    panelX: null,
    panelY: null,
};

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getStoredLayout() {
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

function setStoredLayout(layout) {
    try {
        chrome.storage?.local?.set({ [STORAGE_KEY]: layout });
    } catch {
        // Extension context was invalidated (e.g. reloaded while tab was open)
    }
}

function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
}

function isLikelyCanvasPage() {
    const hostname = window.location.hostname.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();

    if (hostname.endsWith(".instructure.com")) return true;
    if (hostname.endsWith(".canvaslms.com")) return true;
    if (hostname.startsWith("canvas.")) return true;

    const hasCanvasRoute = pathname.includes("/courses/") || pathname.includes("/assignments/");
    const hasCanvasDom =
        document.querySelector("#application") ||
        document.querySelector(".ic-app") ||
        document.querySelector("#flash_screenreader_holder") ||
        document.querySelector("body[class*='context-course']");

    return Boolean(hasCanvasRoute && hasCanvasDom);
}

async function loadExtensionFile(path) {
    const response = await fetch(chrome.runtime.getURL(path));

    if (!response.ok) {
        throw new Error(`Unable to load ${path}`);
    }

    return response.text();
}

async function createPanelShadowDom(shadowRoot) {
    const [baseCss, launcherCss, panelCss, launcherHtml, panelHtml] = await Promise.all([
        loadExtensionFile("content/canvas/styles/shadow-root.css"),
        loadExtensionFile("content/canvas/components/launcher/launcher.css"),
        loadExtensionFile("content/canvas/components/panel/panel.css"),
        loadExtensionFile("content/canvas/components/launcher/launcher.html"),
        loadExtensionFile("content/canvas/components/panel/panel.html"),
    ]);

    const style = document.createElement("style");
    style.textContent = [baseCss, launcherCss, panelCss].join("\n");

    const template = document.createElement("template");
    template.innerHTML = `${launcherHtml}\n${panelHtml}`;

    shadowRoot.append(style, template.content.cloneNode(true));
}

async function loadPanelComponents() {
    return import(chrome.runtime.getURL("content/canvas/components/up-next/up-next.js"));
}

function applyLayout(host, panel, layout) {
    const maxPanelWidth = Math.max(280, window.innerWidth - 28);
    const maxPanelHeight = Math.max(420, window.innerHeight - 42);
    const panelWidth = clamp(layout.panelWidth, 340, Math.min(460, maxPanelWidth));
    const panelHeight = clamp(layout.panelHeight, 500, Math.min(760, maxPanelHeight));
    const defaultPanelX = window.innerWidth - panelWidth - 16;
    const defaultPanelY = (window.innerHeight - panelHeight) / 2;
    const panelX = clamp(layout.panelX ?? defaultPanelX, 12, window.innerWidth - panelWidth - 12);
    const panelY = clamp(layout.panelY ?? defaultPanelY, 12, window.innerHeight - panelHeight - 12);

    layout.panelHeight = panelHeight;
    layout.panelWidth = panelWidth;
    layout.panelX = panelX;
    layout.panelY = panelY;

    panel.style.left = `${panelX}px`;
    panel.style.top = `${panelY}px`;
    panel.style.width = `${panelWidth}px`;
    panel.style.height = `${panelHeight}px`;
}

function bindPanelDrag(panel, layout) {
    const dragHandle = panel.querySelector("[data-panel-drag]");
    let dragState = null;

    dragHandle?.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button")) return;

        event.preventDefault();
        event.stopPropagation();
        dragHandle.setPointerCapture(event.pointerId);

        dragState = {
            startPointerX: event.clientX,
            startPointerY: event.clientY,
            startX: layout.panelX ?? panel.getBoundingClientRect().left,
            startY: layout.panelY ?? panel.getBoundingClientRect().top,
        };
    });

    dragHandle?.addEventListener("pointermove", (event) => {
        if (!dragState) return;

        const panelWidth = panel.getBoundingClientRect().width;
        const panelHeight = panel.getBoundingClientRect().height;
        const nextX = clamp(
            dragState.startX + event.clientX - dragState.startPointerX,
            12,
            window.innerWidth - panelWidth - 12
        );
        const nextY = clamp(
            dragState.startY + event.clientY - dragState.startPointerY,
            12,
            window.innerHeight - panelHeight - 12
        );

        layout.panelX = nextX;
        layout.panelY = nextY;
        panel.style.left = `${nextX}px`;
        panel.style.top = `${nextY}px`;
    });

    dragHandle?.addEventListener("pointerup", (event) => {
        if (!dragState) return;

        dragHandle.releasePointerCapture(event.pointerId);
        dragState = null;
        setStoredLayout(layout);
    });

    dragHandle?.addEventListener("pointercancel", () => {
        dragState = null;
        setStoredLayout(layout);
    });
}

function bindPanelResize(panel, layout) {
    const resizeHandle = panel.querySelector("[data-resize-handle]");
    let resizeState = null;

    resizeHandle?.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        resizeHandle.setPointerCapture(event.pointerId);

        const panelRect = panel.getBoundingClientRect();
        resizeState = {
            startHeight: panelRect.height,
            startLeft: panelRect.left,
            startPointerX: event.clientX,
            startPointerY: event.clientY,
            startRight: panelRect.right,
            startWidth: panelRect.width,
        };
    });

    resizeHandle?.addEventListener("pointermove", (event) => {
        if (!resizeState) return;

        const maxPanelWidth = Math.min(430, window.innerWidth - 28);
        const maxPanelHeight = Math.min(760, window.innerHeight - 42);
        const nextWidth = clamp(
            resizeState.startWidth + resizeState.startPointerX - event.clientX,
            340,
            Math.min(460, maxPanelWidth)
        );
        const nextHeight = clamp(
            resizeState.startHeight + event.clientY - resizeState.startPointerY,
            500,
            maxPanelHeight
        );
        const nextX = clamp(
            resizeState.startRight - nextWidth,
            12,
            window.innerWidth - nextWidth - 12
        );

        layout.panelWidth = nextWidth;
        layout.panelHeight = nextHeight;
        layout.panelX = nextX;
        panel.style.width = `${nextWidth}px`;
        panel.style.height = `${nextHeight}px`;
        panel.style.left = `${nextX}px`;
    });

    resizeHandle?.addEventListener("pointerup", (event) => {
        if (!resizeState) return;

        resizeHandle.releasePointerCapture(event.pointerId);
        resizeState = null;
        setStoredLayout(layout);
    });

    resizeHandle?.addEventListener("pointercancel", () => {
        resizeState = null;
        setStoredLayout(layout);
    });
}

function bindPanelControls(host, shadowRoot, layout) {
    const launcher = shadowRoot.querySelector("[data-launcher]");
    const closeButton = shadowRoot.querySelector("[data-close]");
    const panel = shadowRoot.querySelector("[data-panel]");

    launcher?.addEventListener("click", () => {
        host.setAttribute(OPEN_ATTRIBUTE, "true");
    });

    closeButton?.addEventListener("click", () => {
        host.removeAttribute(OPEN_ATTRIBUTE);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            host.removeAttribute(OPEN_ATTRIBUTE);
        }
    });

    if (panel) {
        bindPanelDrag(panel, layout);
        bindPanelResize(panel, layout);
        window.addEventListener("resize", () => {
            applyLayout(host, panel, layout);
            setStoredLayout(layout);
        });
    }
}

async function mountDueDeckCanvasPanel() {
    if (document.getElementById(DUEDECK_HOST_ID)) return;

    const host = document.createElement("div");
    host.id = DUEDECK_HOST_ID;

    const shadowRoot = host.attachShadow({ mode: "open" });

    await createPanelShadowDom(shadowRoot);
    const { renderUpNextAssignments } = await loadPanelComponents();
    const layout = await getStoredLayout();
    const panel = shadowRoot.querySelector("[data-panel]");

    if (panel) {
        applyLayout(host, panel, layout);
    }

    const greeting = shadowRoot.querySelector(".duedeck-greeting");
    if (greeting) greeting.textContent = `${getGreeting()}, Matin`;

    renderUpNextAssignments(shadowRoot.querySelector("[data-up-next-list]"));

    bindPanelControls(host, shadowRoot, layout);

    document.documentElement.append(host);
}

function startDueDeck() {
    if (!isLikelyCanvasPage()) return;

    mountDueDeckCanvasPanel().catch((error) => {
        console.error("[DueDeck] Failed to mount Canvas panel", error);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startDueDeck, { once: true });
} else {
    startDueDeck();
}
