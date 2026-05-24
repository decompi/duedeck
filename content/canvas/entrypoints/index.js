function isLikelyCanvasPage() {
    const hostname = window.location.hostname.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();

    if (hostname.endsWith(".instructure.com")) {
        return true;
    }
    if (hostname.endsWith(".canvaslms.com")) {
        return true;
    }
    if (hostname.startsWith("canvas.")) {
        return true;
    }

    const hasCanvasRoute = pathname.includes("/courses/") || pathname.includes("/assignments/");
    const hasCanvasDom =
        document.querySelector("#application") ||
        document.querySelector(".ic-app") ||
        document.querySelector("#flash_screenreader_holder") ||
        document.querySelector("body[class*='context-course']");

    return Boolean(hasCanvasRoute && hasCanvasDom);
}

async function bootstrap() {
    if (!isLikelyCanvasPage()) {
        return;
    }

    const { startDueDeck } = await import(chrome.runtime.getURL("content/canvas/entrypoints/main.js"));
    startDueDeck();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bootstrap().catch(console.error), { once: true });
} else {
    bootstrap().catch(console.error);
}
