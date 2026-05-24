const DUEDECK_HOST_ID = "duedeck-overlay-host";
const OPEN_ATTRIBUTE = "data-open";

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

async function createShadowContent(shadowRoot) {
    const [css, html] = await Promise.all([
        loadExtensionFile("content/overlay.css"),
        loadExtensionFile("content/panel.html"),
    ]);

    const style = document.createElement("style");
    style.textContent = css;

    const template = document.createElement("template");
    template.innerHTML = html;

    shadowRoot.append(style, template.content.cloneNode(true));
}

function bindOverlayControls(host, shadowRoot) {
    const dock = shadowRoot.querySelector("[data-dock]");
    const closeButton = shadowRoot.querySelector("[data-close]");

    dock?.addEventListener("click", () => {
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
}

async function mountDueDeck() {
    if (document.getElementById(DUEDECK_HOST_ID)) return;

    const host = document.createElement("div");
    host.id = DUEDECK_HOST_ID;

    const shadowRoot = host.attachShadow({ mode: "open" });

    await createShadowContent(shadowRoot);
    bindOverlayControls(host, shadowRoot);

    document.documentElement.append(host);
}

function startDueDeck() {
    if (!isLikelyCanvasPage()) return;

    mountDueDeck().catch((error) => {
        console.error("[DueDeck] Failed to mount overlay", error);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startDueDeck, { once: true });
} else {
    startDueDeck();
}
