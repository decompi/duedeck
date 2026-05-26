const KEYS = {
    snapshot: "duedeckLastSyncSnapshot",
    saved: "duedeckSavedAssignments",
};

const CanvasHostPattern = /(njit\.instructure\.com|instructure\.com|canvaslms\.com|canvas)/i;

function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function isCanvasTab(tab) {
    try {
        const url = new URL(tab?.url ?? "");
        return CanvasHostPattern.test(url.hostname) || /\/courses\/\d+/.test(url.pathname);
    } catch {
        return false;
    }
}

function formatLastSync(iso) {
    if (!iso) {
        return "Not synced yet";
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return "Not synced yet";
    }
    return `Synced ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function isStale(iso) {
    if (!iso) {
        return false;
    }
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) && Date.now() - date.getTime() > 3 * 60 * 60 * 1000;
}

function formatClass(event) {
    if (!event?.startAt) {
        return "";
    }
    const start = new Date(event.startAt);
    if (Number.isNaN(start.getTime())) {
        return event.title ?? "";
    }
    return `${event.title ?? "Class"} • ${start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

async function removeSavedAssignment(id) {
    const result = await storageGet([KEYS.saved]);
    const next = { ...(result?.[KEYS.saved] ?? {}) };
    delete next[id];
    await storageSet({ [KEYS.saved]: next });
    chrome.runtime.sendMessage({ type: "DUEDECK_CANCEL_REMINDER", id });
    await render();
}

function renderAssignments(root, assignments, savedMap = {}) {
    if (!root) {
        return;
    }
    const items = (assignments ?? []).slice(0, 2);
    if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "No upcoming NJIT Canvas work yet.";
        root.replaceChildren(empty);
        return;
    }

    root.replaceChildren(...items.map((assignment) => {
        const item = document.createElement("div");
        item.className = "assignment";

        const info = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = assignment.title ?? "Untitled assignment";
        const meta = document.createElement("span");
        meta.textContent = assignment.course ?? "NJIT Canvas";
        info.append(title, meta);

        const time = document.createElement("span");
        time.className = `assignment__time assignment__time--${assignment.timeTone ?? "normal"}`;
        time.textContent = assignment.time ?? "Soon";

        const tail = document.createElement("div");
        tail.className = "assignment__tail";
        if (savedMap[assignment.id] || assignment.saved) {
            const remove = document.createElement("button");
            remove.className = "assignment__remove";
            remove.type = "button";
            remove.textContent = "Unsave";
            remove.addEventListener("click", () => removeSavedAssignment(assignment.id));
            tail.append(remove);
        }
        tail.append(time);

        item.append(info, tail);
        return item;
    }));
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function openCanvas() {
    chrome.runtime.sendMessage({ type: "DUEDECK_OPEN_CANVAS" });
    window.close();
}

async function openPanel() {
    const button = document.querySelector("[data-open-panel]");
    if (button) {
        button.disabled = true;
        button.textContent = "Opening...";
    }
    const result = await chrome.runtime.sendMessage({ type: "DUEDECK_OPEN_PANEL" });
    if (result?.ok) {
        window.close();
        return;
    }
    const status = document.querySelector("[data-status]");
    if (status) {
        status.textContent = result?.reason ?? "Open NJIT Canvas first, then try again.";
    }
    if (button) {
        button.disabled = false;
        button.textContent = "Open DueDeck";
    }
}

async function render() {
    const [tab, result] = await Promise.all([
        getActiveTab(),
        storageGet([KEYS.snapshot, KEYS.saved]),
    ]);

    const snapshot = result?.[KEYS.snapshot] ?? {};
    const isCanvas = isCanvasTab(tab);
    const status = document.querySelector("[data-status]");
    const dashboard = document.querySelector("[data-dashboard]");
    const loading = document.querySelector("[data-loading]");
    const preSync = document.querySelector("[data-pre-sync]");
    const stale = document.querySelector("[data-stale]");
    const syncError = document.querySelector("[data-sync-error]");
    const syncedContent = document.querySelectorAll("[data-synced-content]");
    const hasSynced = Boolean(snapshot.canvasConnected || snapshot.lastSyncedAt);
    const staleData = isStale(snapshot.lastSyncedAt);

    if (status) {
        status.textContent = isCanvas
            ? "NJIT Canvas tab ready"
            : snapshot.canvasConnected
                ? `Connected to ${snapshot.canvasHost ?? "NJIT Canvas"}`
                : "Open NJIT Canvas to sync";
    }

    dashboard.hidden = false;
    loading.hidden = false;
    window.setTimeout(() => {
        loading.hidden = true;
    }, 220);

    preSync.hidden = hasSynced;
    stale.hidden = !hasSynced || !staleData;
    syncError.hidden = !snapshot.syncError;
    syncedContent.forEach(el => {
        el.hidden = !hasSynced;
    });

    const saved = Object.values(result?.[KEYS.saved] ?? {});
    const upNext = snapshot.upNext?.length ? snapshot.upNext : saved;
    document.querySelector("[data-due-today]").textContent = String(snapshot.stats?.dueToday ?? 0);
    document.querySelector("[data-overdue]").textContent = String(snapshot.stats?.overdue ?? 0);
    document.querySelector("[data-last-synced]").textContent = formatLastSync(snapshot.lastSyncedAt);
    const nextClass = document.querySelector(".next-class");
    const nextClassText = formatClass(snapshot.nextClass);
    if (nextClass) {
        nextClass.hidden = !nextClassText;
    }
    document.querySelector("[data-next-class]").textContent = nextClassText;
    if (snapshot.syncError) {
        document.querySelector("[data-sync-error-copy]").textContent = snapshot.syncError;
    }
    if (staleData) {
        document.querySelector("[data-stale-copy]").textContent = `${formatLastSync(snapshot.lastSyncedAt)}. Open NJIT Canvas for a fresh sync.`;
    }
    renderAssignments(document.querySelector("[data-up-next]"), upNext, result?.[KEYS.saved] ?? {});
}

document.querySelector("[data-open-panel]")?.addEventListener("click", openPanel);
document.querySelector("[data-open-canvas-secondary]")?.addEventListener("click", openCanvas);

render().catch((error) => {
    const status = document.querySelector("[data-status]");
    if (status) {
        status.textContent = error.message;
    }
});
