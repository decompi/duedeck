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

    shadowRoot.querySelectorAll("[data-stat]").forEach((stat) => {
        const clone = stat.cloneNode(true);
        stat.replaceWith(clone);
    });

    drawer.querySelector("[data-drawer-close]")?.replaceWith(
        drawer.querySelector("[data-drawer-close]").cloneNode(true)
    );

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
        const fitsRight = neededRight <= window.innerWidth - 12;
        const fitsLeft = panelRect.left - DRAWER_GAP - drawerWidth >= 12;

        let drawerLeft;
        if (fitsRight) {
            drawerLeft = panelRect.right + DRAWER_GAP;
        } else if (fitsLeft) {
            drawerLeft = panelRect.left - DRAWER_GAP - drawerWidth;
        } else if (layout) {
            const shift = neededRight - (window.innerWidth - 12);
            const newX = Math.max(12, panelRect.left - shift);
            panel.style.left = `${newX}px`;
            layout.panelX = newX;
            const updatedRect = panel.getBoundingClientRect();
            drawerLeft = updatedRect.right + DRAWER_GAP;
        } else {
            drawerLeft = panelRect.right + DRAWER_GAP;
        }

        drawer.style.left = `${drawerLeft}px`;
        drawer.style.top = `${panelRect.top}px`;
    }

    function openDrawer(type) {
        if (activeType === type) {
            closeDrawer();
            return;
        }

        activeType = type;
        if (layout) {
            savedPanelX = layout.panelX;
        }

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

        if (!layout) {
            window.addEventListener("scroll", positionDrawer);
        }

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

        window.removeEventListener("scroll", positionDrawer);

        drawer.removeAttribute("data-open");
        drawer.removeAttribute("data-type");
        drawer.setAttribute("aria-hidden", "true");

        if (savedPanelX !== null && layout) {
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

export function setPanelView(shadowRoot, view) {
    shadowRoot.querySelectorAll("[data-view]").forEach((el) => {
        el.hidden = el.dataset.view !== view;
    });
    shadowRoot.querySelectorAll(".duedeck-mode-tabs button").forEach((button) => {
        const target =
            button.hasAttribute("data-view-week") ? "week" :
            button.hasAttribute("data-view-saved") ? "saved" :
            button.hasAttribute("data-view-settings") ? "settings" :
            "dashboard";
        if (target === view) {
            button.setAttribute("data-active", "");
        } else {
            button.removeAttribute("data-active");
        }
    });
}

const REMINDER_OPTIONS = [
    { value: "0", label: "No reminder" },
    { value: "1", label: "1 hour before" },
    { value: "3", label: "3 hours before" },
    { value: "24", label: "1 day before" },
    { value: "48", label: "2 days before" },
];

function createDetailMetric(label, value) {
    const metric = document.createElement("span");
    metric.className = "duedeck-detection-metric";
    const labelEl = document.createElement("small");
    labelEl.textContent = label;
    const valueEl = document.createElement("strong");
    valueEl.textContent = value || "Not listed";
    metric.append(labelEl, valueEl);
    return metric;
}

function getChecklistItems(assignment, checklist) {
    const saved = checklist?.items;
    if (Array.isArray(saved) && saved.length) {
        return saved;
    }
    return [
        { text: "Read the assignment instructions", done: false },
        { text: "Gather files, notes, or submission requirements", done: false },
        { text: "Submit or mark complete before the due time", done: false },
    ].map((item, index) => ({ ...item, id: `${assignment.id}:step:${index}` }));
}

export function renderDetectedAssignment(root, assignment, { onSave, onRemove, onDismiss, onChecklistChange, checklist, onManualCapture, showManualCapture = false } = {}) {
    if (!root) {
        return;
    }
    if (!assignment) {
        root.replaceChildren();
        if (!showManualCapture) {
            root.hidden = true;
            return;
        }
        root.hidden = false;
        const empty = document.createElement("div");
        empty.className = "duedeck-manual-capture";
        empty.innerHTML = `<strong>Found a deadline here?</strong><span>Add it manually from this NJIT Canvas page.</span>`;
        const button = document.createElement("button");
        button.className = "duedeck-action-button duedeck-action-button--primary";
        button.type = "button";
        button.textContent = "Capture deadline";
        button.addEventListener("click", () => onManualCapture?.());
        empty.append(button);
        root.append(empty);
        return;
    }

    root.hidden = false;
    root.replaceChildren();

    const top = document.createElement("div");
    top.className = "duedeck-detection__top";

    const icon = document.createElement("span");
    icon.className = "duedeck-detection__icon";
    icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4"></path><circle cx="12" cy="12" r="10"></circle></svg>`;

    const info = document.createElement("div");
    info.className = "duedeck-detection__info";

    const label = document.createElement("p");
    label.className = "duedeck-detection__label";
    label.textContent = "Assignment detected";

    const title = document.createElement("p");
    title.className = "duedeck-detection__title";
    title.textContent = assignment.title;

    const meta = document.createElement("p");
    meta.className = "duedeck-detection__meta";
    meta.textContent = `${assignment.course} • ${assignment.platform ?? "NJIT Canvas"}`;

    info.append(label, title, meta);
    top.append(icon, info);

    const metrics = document.createElement("div");
    metrics.className = "duedeck-detection__metrics";
    const type = assignment.type ? `${assignment.type[0].toUpperCase()}${assignment.type.slice(1)}` : "Assignment";
    const points = Number.isFinite(Number(assignment.points)) ? `${assignment.points} pts` : "Not listed";
    metrics.append(
        createDetailMetric("Due", assignment.time),
        createDetailMetric("Points", points),
        createDetailMetric("Type", type)
    );

    const checklistWrap = document.createElement("div");
    checklistWrap.className = "duedeck-detection-checklist";
    const checklistTitle = document.createElement("p");
    checklistTitle.className = "duedeck-detection-checklist__title";
    checklistTitle.textContent = "What you need to do";
    const checklistItems = getChecklistItems(assignment, checklist);
    const checklistList = document.createElement("div");
    checklistList.className = "duedeck-detection-checklist__items";
    checklistItems.forEach((step, index) => {
        const row = document.createElement("label");
        row.className = "duedeck-check-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(step.done);
        checkbox.addEventListener("change", () => {
            checklistItems[index] = { ...step, done: checkbox.checked };
            onChecklistChange?.(assignment.id, { items: checklistItems });
        });
        const span = document.createElement("span");
        span.textContent = step.text;
        row.append(checkbox, span);
        checklistList.append(row);
    });
    checklistWrap.append(checklistTitle, checklistList);

    const actions = document.createElement("div");
    actions.className = "duedeck-detection__actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "duedeck-action-button duedeck-action-button--primary";
    save.textContent = assignment.saved ? "Unsave" : "Save";
    save.addEventListener("click", () => {
        if (assignment.saved) {
            onRemove?.(assignment.id);
            return;
        }
        onSave?.(assignment);
    });

    const reminder = document.createElement("button");
    reminder.type = "button";
    reminder.className = "duedeck-action-button";
    reminder.textContent = "Remind";
    reminder.addEventListener("click", () => onSave?.(assignment));

    const open = document.createElement("button");
    open.type = "button";
    open.className = "duedeck-action-button";
    open.textContent = "Open";
    open.addEventListener("click", () => {
        if (assignment.url) {
            window.open(assignment.url, "_blank", "noopener");
        }
    });

    const done = document.createElement("button");
    done.type = "button";
    done.className = "duedeck-action-button";
    done.textContent = "Mark done";
    done.addEventListener("click", () => {
        root.hidden = true;
        onDismiss?.();
    });

    const manual = document.createElement("button");
    manual.type = "button";
    manual.className = "duedeck-action-button";
    manual.textContent = "Quick add";
    manual.addEventListener("click", () => onManualCapture?.(assignment));

    actions.append(save, reminder, open, done, manual);
    root.append(top, metrics, checklistWrap, actions);
}

export function renderAssignmentDetail(root, assignment, { checklist, reminder, onSave, onRemove, onReminderChange, onChecklistChange, onDone, onDeleteManual } = {}) {
    if (!root) {
        return;
    }
    if (!assignment) {
        root.replaceChildren();
        return;
    }

    const title = document.createElement("h2");
    title.className = "duedeck-detail__title";
    title.textContent = assignment.title ?? "Untitled";

    const meta = document.createElement("p");
    meta.className = "duedeck-detail__meta";
    meta.textContent = `${assignment.course ?? "NJIT Canvas"} • ${assignment.platform ?? "NJIT Canvas"}`;

    const metrics = document.createElement("div");
    metrics.className = "duedeck-detection__metrics";
    const type = assignment.type ? `${assignment.type[0].toUpperCase()}${assignment.type.slice(1)}` : "Assignment";
    const points = Number.isFinite(Number(assignment.points)) ? `${assignment.points} pts` : "Not listed";
    metrics.append(
        createDetailMetric("Due", assignment.time),
        createDetailMetric("Points", points),
        createDetailMetric("Type", type)
    );

    const reminderRow = document.createElement("label");
    reminderRow.className = "duedeck-detail-reminder";
    const reminderText = document.createElement("span");
    reminderText.textContent = "Reminder";
    const reminderSelect = document.createElement("select");
    reminderSelect.className = "duedeck-select";
    REMINDER_OPTIONS.forEach((option) => {
        const el = document.createElement("option");
        el.value = option.value;
        el.textContent = option.label;
        reminderSelect.append(el);
    });
    reminderSelect.value = reminder?.enabled ? String(reminder.offsetHours ?? 24) : "0";
    reminderSelect.addEventListener("change", () => {
        const offsetHours = Number(reminderSelect.value);
        onReminderChange?.(assignment, {
            enabled: offsetHours > 0,
            offsetHours,
        });
    });
    reminderRow.append(reminderText, reminderSelect);

    const checklistWrap = document.createElement("div");
    checklistWrap.className = "duedeck-detection-checklist";
    const checklistTitle = document.createElement("p");
    checklistTitle.className = "duedeck-detection-checklist__title";
    checklistTitle.textContent = "Checklist";
    const checklistItems = getChecklistItems(assignment, checklist);
    const checklistList = document.createElement("div");
    checklistList.className = "duedeck-detection-checklist__items";
    checklistItems.forEach((step, index) => {
        const row = document.createElement("label");
        row.className = "duedeck-check-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(step.done);
        checkbox.addEventListener("change", () => {
            checklistItems[index] = { ...step, done: checkbox.checked };
            onChecklistChange?.(assignment.id, { items: checklistItems });
        });
        const span = document.createElement("span");
        span.textContent = step.text;
        row.append(checkbox, span);
        checklistList.append(row);
    });
    checklistWrap.append(checklistTitle, checklistList);

    const actions = document.createElement("div");
    actions.className = "duedeck-detection__actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "duedeck-action-button duedeck-action-button--primary";
    save.textContent = assignment.saved ? "Unsave" : "Save";
    save.addEventListener("click", () => assignment.saved ? onRemove?.(assignment.id) : onSave?.(assignment));

    const open = document.createElement("button");
    open.type = "button";
    open.className = "duedeck-action-button";
    open.textContent = "Open in NJIT Canvas";
    open.disabled = !assignment.url;
    open.addEventListener("click", () => assignment.url && window.open(assignment.url, "_blank", "noopener"));

    const done = document.createElement("button");
    done.type = "button";
    done.className = "duedeck-action-button";
    done.textContent = "Mark done";
    done.addEventListener("click", () => onDone?.(assignment.id));
    actions.append(save, open, done);

    if (assignment.platformType === "manual") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "duedeck-action-button";
        remove.textContent = "Delete";
        remove.addEventListener("click", () => onDeleteManual?.(assignment.id));
        actions.append(remove);
    }

    root.replaceChildren(title, meta, metrics, reminderRow, checklistWrap, actions);
}

export function renderSettings(shadowRoot, { syncPreferences, reminderSettings, courseVisibility, courses } = {}, callbacks = {}) {
    shadowRoot.querySelectorAll("[data-sync-pref]").forEach((input) => {
        input.checked = Boolean(syncPreferences?.[input.dataset.syncPref]);
        input.onchange = () => {
            callbacks.onSyncPreferencesChange?.({
                ...syncPreferences,
                [input.dataset.syncPref]: input.checked,
            });
        };
    });

    const reminderSelect = shadowRoot.querySelector("[data-reminder-offset]");
    if (reminderSelect) {
        reminderSelect.value = String(reminderSettings?.defaultOffsetHours ?? 24);
        reminderSelect.onchange = () => {
            callbacks.onReminderSettingsChange?.({
                ...reminderSettings,
                defaultOffsetHours: Number(reminderSelect.value),
            });
        };
    }

    const courseList = shadowRoot.querySelector("[data-course-visibility]");
    if (courseList) {
        const uniqueCourses = Array.from(new Map((courses ?? []).map(course => [course.id ?? course.name, course])).values());
        if (!uniqueCourses.length) {
            const empty = document.createElement("p");
            empty.className = "duedeck-settings-empty";
            empty.textContent = "Courses will appear after the next NJIT Canvas sync.";
            courseList.replaceChildren(empty);
        } else {
            courseList.replaceChildren(...uniqueCourses.map((course) => {
                const key = String(course.id ?? course.name);
                const row = document.createElement("label");
                row.className = "duedeck-course-row";
                const color = document.createElement("span");
                color.className = "duedeck-course-row__color";
                color.style.background = course.color ?? "var(--dd-accent)";
                const name = document.createElement("span");
                name.textContent = course.name;
                const input = document.createElement("input");
                input.type = "checkbox";
                input.checked = courseVisibility?.[key] !== false;
                input.addEventListener("change", () => {
                    callbacks.onCourseVisibilityChange?.({
                        ...(courseVisibility ?? {}),
                        [key]: input.checked,
                    });
                });
                row.append(color, name, input);
                return row;
            }));
        }
    }

    const resetOnboarding = shadowRoot.querySelector("[data-reset-onboarding]");
    const disconnectCanvas = shadowRoot.querySelector("[data-disconnect-canvas]");
    const clearData = shadowRoot.querySelector("[data-clear-data]");
    if (resetOnboarding) {
        resetOnboarding.onclick = () => callbacks.onResetOnboarding?.();
    }
    if (disconnectCanvas) {
        disconnectCanvas.onclick = () => callbacks.onDisconnectCanvas?.();
    }
    if (clearData) {
        clearData.onclick = () => callbacks.onClearData?.();
    }
}

export function bindPanelControls(host, shadowRoot, layout, callbacks = {}) {
    const launcher = shadowRoot.querySelector("[data-launcher]");
    const closeButton = shadowRoot.querySelector("[data-close]");
    const panel = shadowRoot.querySelector("[data-panel]");
    const list = shadowRoot.querySelector("[data-up-next-list]");
    const weekList = shadowRoot.querySelector("[data-week-list]");
    const settings = shadowRoot.querySelector("[data-settings]");
    const syncButton = shadowRoot.querySelector("[data-sync]");
    const manualModal = shadowRoot.querySelector("[data-manual-modal]");
    const manualForm = shadowRoot.querySelector("[data-manual-form]");
    const manualError = shadowRoot.querySelector("[data-manual-error]");

    launcher?.addEventListener("click", () => {
        host.setAttribute("data-open", "true");
    });

    closeButton?.addEventListener("click", () => {
        host.removeAttribute("data-open");
    });

    syncButton?.addEventListener("click", () => callbacks.onSync?.());

    shadowRoot.querySelector("[data-open-manual]")?.addEventListener("click", () => callbacks.onOpenManual?.());
    shadowRoot.querySelector("[data-close-manual]")?.addEventListener("click", () => {
        if (manualModal) {
            manualModal.hidden = true;
        }
        if (manualError) {
            manualError.textContent = "";
            manualError.hidden = true;
        }
    });
    manualForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        callbacks.onManualSubmit?.(new FormData(manualForm));
    });

    shadowRoot.querySelectorAll("[data-view-week]").forEach((button) => {
        button.addEventListener("click", () => {
            setPanelView(shadowRoot, "week");
            callbacks.onWeekView?.();
        });
    });

    shadowRoot.querySelectorAll("[data-view-dashboard]").forEach((button) => {
        button.addEventListener("click", () => {
            setPanelView(shadowRoot, "dashboard");
        });
    });

    shadowRoot.querySelectorAll("[data-view-settings]").forEach((button) => {
        button.addEventListener("click", () => {
            setPanelView(shadowRoot, "settings");
            callbacks.onSettingsView?.();
        });
    });

    shadowRoot.querySelectorAll("[data-view-saved]").forEach((button) => {
        button.addEventListener("click", () => {
            setPanelView(shadowRoot, "saved");
            callbacks.onSavedView?.();
        });
    });

    shadowRoot.querySelectorAll("[data-week-filter]").forEach((button) => {
        button.addEventListener("click", () => {
            shadowRoot.querySelectorAll("[data-week-filter]").forEach(el => el.removeAttribute("data-active"));
            button.setAttribute("data-active", "");
            callbacks.onWeekFilter?.(button.dataset.weekFilter);
        });
    });

    panel?.addEventListener("wheel", (event) => {
        event.stopPropagation();

        if (list?.contains(event.target) || weekList?.contains(event.target) || settings?.contains(event.target)) {
            return;
        }

        event.preventDefault();
    }, { passive: false });

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
