import { setStoredLayout, saveTriageState } from "../../lib/storage.js";
import { renderOverdueDrawer } from "./triage.js";

export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function applyLayout(host, panel, layout) {
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

export function bindPanelDrag(panel, layout) {
    const dragHandle = panel.querySelector("[data-panel-drag]");
    let dragState = null;

    dragHandle?.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button")) {
            return;
        }

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
        if (!dragState) {
            return;
        }

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
        if (!dragState) {
            return;
        }

        dragHandle.releasePointerCapture(event.pointerId);
        dragState = null;
        setStoredLayout(layout);
    });

    dragHandle?.addEventListener("pointercancel", () => {
        dragState = null;
        setStoredLayout(layout);
    });
}

export function bindPanelResize(panel, layout) {
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
        if (!resizeState) {
            return;
        }

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
        if (!resizeState) {
            return;
        }

        resizeHandle.releasePointerCapture(event.pointerId);
        resizeState = null;
        setStoredLayout(layout);
    });

    resizeHandle?.addEventListener("pointercancel", () => {
        resizeState = null;
        setStoredLayout(layout);
    });
}

const DRAWER_GAP = 10;

const DRAWER_ICONS = {
    overdue: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
    today: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
};

export function bindDrawer(shadowRoot, panel, layout, stats, initialTriageState, renderDrawerItems) {
    const drawer = shadowRoot.querySelector("[data-drawer]");
    if (!drawer) {
        return;
    }

    const drawerList = drawer.querySelector("[data-drawer-list]");
    const drawerLabel = drawer.querySelector("[data-drawer-label]");
    const drawerBadge = drawer.querySelector("[data-drawer-badge]");
    const drawerIcon = drawer.querySelector("[data-drawer-icon]");
    const drawerClose = drawer.querySelector("[data-drawer-close]");

    const triage = { ...initialTriageState };
    let activeType = null;
    let savedPanelX = null;

    function getUnresolvedCount() {
        return stats.overdueItems.filter(a => !triage[a.id]).length;
    }

    function updateOverdueStatCard() {
        const count = getUnresolvedCount();
        const overdueEl = shadowRoot.querySelector("[data-stat='overdue'] strong");
        const statEl = shadowRoot.querySelector("[data-stat='overdue']");

        if (overdueEl) {
            overdueEl.textContent = count;
        }
        if (statEl) {
            if (count > 0) {
                statEl.removeAttribute("data-resolved");
            } else {
                statEl.setAttribute("data-resolved", "");
            }
        }
    }

    function isResolvedExpanded() {
        const list = drawerList.querySelector(".duedeck-resolved__list");
        return list ? !list.hidden : false;
    }

    function onTriage(id, status) {
        const wasExpanded = isResolvedExpanded();
        triage[id] = status;
        saveTriageState(triage);
        updateOverdueStatCard();
        drawerBadge.textContent = getUnresolvedCount();
        renderOverdueDrawer(drawerList, stats.overdueItems, triage, onTriage, onUndo, wasExpanded);
    }

    function onUndo(id) {
        const wasExpanded = isResolvedExpanded();
        delete triage[id];
        saveTriageState(triage);
        updateOverdueStatCard();
        drawerBadge.textContent = getUnresolvedCount();
        renderOverdueDrawer(drawerList, stats.overdueItems, triage, onTriage, onUndo, wasExpanded);
    }

    function positionDrawer() {
        const panelRect = panel.getBoundingClientRect();
        const drawerWidth = drawer.offsetWidth || 196;
        const neededRight = panelRect.right + DRAWER_GAP + drawerWidth;
        const maxRight = window.innerWidth - 12;

        if (neededRight > maxRight) {
            const shift = neededRight - maxRight;
            const newX = Math.max(12, panelRect.left - shift);
            panel.style.left = `${newX}px`;
            layout.panelX = newX;
        }

        const updatedRect = panel.getBoundingClientRect();
        drawer.style.left = `${updatedRect.right + DRAWER_GAP}px`;
        drawer.style.top = panel.style.top;
    }

    function openDrawer(type) {
        if (activeType === type) {
            closeDrawer();
            return;
        }

        activeType = type;
        savedPanelX = layout.panelX;

        drawerLabel.textContent = type === "overdue" ? "Overdue" : "Due Today";
        drawerIcon.innerHTML = DRAWER_ICONS[type];
        drawer.setAttribute("data-type", type);

        if (type === "overdue") {
            drawerBadge.textContent = getUnresolvedCount();
            renderOverdueDrawer(drawerList, stats.overdueItems, triage, onTriage, onUndo);
        } else {
            drawerBadge.textContent = stats.dueToday;
            renderDrawerItems(drawerList, stats.dueTodayItems, type);
        }

        positionDrawer();

        drawer.removeAttribute("aria-hidden");
        drawer.setAttribute("data-open", "");

        shadowRoot.querySelectorAll("[data-stat]").forEach(el => el.removeAttribute("data-active"));
        shadowRoot.querySelector(`[data-stat="${type === "overdue" ? "overdue" : "today"}"]`)
            ?.setAttribute("data-active", "");
    }

    function closeDrawer() {
        if (!activeType) {
            return;
        }
        activeType = null;

        drawer.removeAttribute("data-open");
        drawer.removeAttribute("data-type");
        drawer.setAttribute("aria-hidden", "true");

        if (savedPanelX !== null) {
            panel.style.left = `${savedPanelX}px`;
            layout.panelX = savedPanelX;
            savedPanelX = null;
        }

        shadowRoot.querySelectorAll("[data-stat]").forEach(el => el.removeAttribute("data-active"));
    }

    updateOverdueStatCard();

    shadowRoot.querySelector("[data-stat='overdue']")?.addEventListener("click", () => openDrawer("overdue"));
    shadowRoot.querySelector("[data-stat='today']")?.addEventListener("click", () => openDrawer("today"));
    drawerClose?.addEventListener("click", closeDrawer);

    shadowRoot.querySelector("[data-panel-drag]")?.addEventListener("pointerdown", closeDrawer, { passive: true });
}

export function bindPanelControls(host, shadowRoot, layout) {
    const launcher = shadowRoot.querySelector("[data-launcher]");
    const closeButton = shadowRoot.querySelector("[data-close]");
    const panel = shadowRoot.querySelector("[data-panel]");

    launcher?.addEventListener("click", () => {
        host.setAttribute("data-open", "true");
    });

    closeButton?.addEventListener("click", () => {
        host.removeAttribute("data-open");
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            host.removeAttribute("data-open");
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
