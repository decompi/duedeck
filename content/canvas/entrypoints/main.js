import { getStoredLayout } from "../lib/storage.js";
import { applyLayout, bindPanelControls, bindDrawer } from "../components/panel/panel.js";

const DUEDECK_HOST_ID = "duedeck-canvas-panel-host";

function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) {
        return "Good morning";
    }
    if (hour < 17) {
        return "Good afternoon";
    }
    return "Good evening";
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
    const [upNext, api] = await Promise.all([
        import(chrome.runtime.getURL("content/canvas/components/up-next/up-next.js")),
        import(chrome.runtime.getURL("content/canvas/api/planner.js")),
    ]);
    return { ...upNext, ...api };
}

async function mountDueDeckCanvasPanel() {
    if (document.getElementById(DUEDECK_HOST_ID)) {
        return;
    }

    const host = document.createElement("div");
    host.id = DUEDECK_HOST_ID;

    const shadowRoot = host.attachShadow({ mode: "open" });

    await createPanelShadowDom(shadowRoot);
    const {
        renderUpNextAssignments,
        renderUpNextLoading,
        renderUpNextError,
        renderDrawerItems,
        fetchUpcomingAssignments,
        fetchCurrentUser,
        fetchAssignmentStats,
    } = await loadPanelComponents();
    const layout = await getStoredLayout();
    const panel = shadowRoot.querySelector("[data-panel]");

    if (panel) {
        applyLayout(host, panel, layout);
    }

    const listEl = shadowRoot.querySelector("[data-up-next-list]");
    renderUpNextLoading(listEl);

    const [name] = await Promise.allSettled([fetchCurrentUser()]);
    const firstName = name.status === "fulfilled" ? name.value : null;
    const greeting = shadowRoot.querySelector(".duedeck-greeting");
    if (greeting) {
        greeting.textContent = `${getGreeting()}, ${firstName ?? "there"}`;
    }

    fetchUpcomingAssignments()
        .then(assignments => renderUpNextAssignments(listEl, assignments))
        .catch(() => renderUpNextError(listEl));

    fetchAssignmentStats().then(stats => {
        const todayEl = shadowRoot.querySelector("[data-stat='today'] strong");
        const overdueEl = shadowRoot.querySelector("[data-stat='overdue'] strong");
        if (todayEl) {
            todayEl.textContent = stats.dueToday;
        }
        if (overdueEl) {
            overdueEl.textContent = stats.overdue;
        }
        if (panel) {
            bindDrawer(shadowRoot, panel, layout, stats, renderDrawerItems);
        }
    }).catch(() => {});

    bindPanelControls(host, shadowRoot, layout);

    document.documentElement.append(host);
}

export function startDueDeck() {
    mountDueDeckCanvasPanel().catch((error) => {
        console.error("[DueDeck] Failed to mount Canvas panel", error);
    });
}
