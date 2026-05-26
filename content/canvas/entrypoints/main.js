import {
    getSavedAssignments,
    getAssignmentChecklist,
    getAssignmentReminders,
    getCourseVisibility,
    getDoneAssignments,
    getManualTasks,
    getLastSyncSnapshot,
    getReminderSettings,
    getStoredLayout,
    getSyncPreferences,
    getThemePreference,
    getTriageState,
    removeSavedAssignment,
    removeManualTask,
    saveAssignment,
    saveAssignmentChecklist,
    saveAssignmentReminder,
    saveManualTask,
    saveCourseVisibility,
    saveLastSyncSnapshot,
    saveReminderSettings,
    saveSyncPreferences,
    clearDueDeckData,
    markAssignmentDone,
    saveThemePreference,
} from "../lib/storage.js";
import { applyLayout, bindPanelControls, bindDrawer, renderAssignmentDetail, renderDetectedAssignment, renderSettings, setPanelView } from "../components/panel/panel.js";
import { formatDueDate, getTimeTone } from "../lib/date.js";

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

function getOppositeTheme(theme) {
    if (theme === "dark") {
        return "light";
    }

    return "dark";
}

function applyTheme(host, theme) {
    if (theme === "dark") {
        host.setAttribute("data-theme", "dark");
        return;
    }

    host.setAttribute("data-theme", "light");
}

function bindThemeToggle(host, shadowRoot) {
    const toggle = shadowRoot.querySelector("[data-theme-toggle]");

    if (!toggle) {
        return;
    }

    function updateLabel() {
        const theme = host.getAttribute("data-theme") ?? "light";
        const nextTheme = getOppositeTheme(theme);
        const label = nextTheme === "dark" ? "Switch to dark mode" : "Switch to light mode";

        toggle.setAttribute("title", label);
        toggle.setAttribute("aria-label", label);
    }

    toggle.addEventListener("click", () => {
        const currentTheme = host.getAttribute("data-theme") ?? "light";
        const nextTheme = getOppositeTheme(currentTheme);

        applyTheme(host, nextTheme);
        saveThemePreference(nextTheme);
        updateLabel();
    });

    updateLabel();
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

function withSavedState(assignments, savedAssignments) {
    return assignments.map(assignment => ({
        ...assignment,
        saved: Boolean(savedAssignments[assignment.id]),
    }));
}

function normalizeLocalAssignment(assignment) {
    return {
        ...assignment,
        time: formatDueDate(assignment.dueAt),
        timeTone: getTimeTone(assignment.dueAt),
        saved: true,
    };
}

function formatSyncStatus(date) {
    if (!date) {
        return "Not synced yet";
    }
    return `Last synced ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function setSyncStatus(shadowRoot, text) {
    const syncStatus = shadowRoot.querySelector("[data-sync-status]");
    if (syncStatus) {
        syncStatus.textContent = text;
    }
}

function setWeekSummary(shadowRoot, assignments) {
    const summary = shadowRoot.querySelector("[data-week-summary]");
    if (!summary) {
        return;
    }
    const overdue = assignments.filter(a => a.timeTone === "overdue").length;
    summary.textContent = `${assignments.length} due${overdue ? ` • ${overdue} overdue` : ""}`;
}

function getAssignmentTypePreferenceKey(type) {
    if (type === "quiz") {
        return "quizzes";
    }
    if (type === "discussion") {
        return "discussions";
    }
    return "assignments";
}

function getCourseKey(assignment) {
    return String(assignment.courseId ?? assignment.contextCode ?? assignment.course ?? "unknown");
}

function assignmentIsVisible(assignment, syncPreferences, courseVisibility) {
    const preferenceKey = getAssignmentTypePreferenceKey(assignment.type);
    if (syncPreferences?.[preferenceKey] === false) {
        return false;
    }
    return courseVisibility?.[getCourseKey(assignment)] !== false;
}

function filterAssignments(assignments, syncPreferences, courseVisibility) {
    return assignments.filter(assignment => assignmentIsVisible(assignment, syncPreferences, courseVisibility));
}

function getCoursesFromAssignments(assignments) {
    return Array.from(new Map(assignments.map((assignment) => {
        const id = getCourseKey(assignment);
        return [id, {
            id,
            name: assignment.course ?? "Canvas course",
            color: assignment.courseColor,
        }];
    })).values()).sort((a, b) => a.name.localeCompare(b.name));
}

function getCanvasEnvCourses() {
    const courses = window.ENV?.STUDENT_PLANNER_COURSES ?? [];
    const colors = window.ENV?.PREFERENCES?.custom_colors ?? {};
    return courses.map(course => ({
        id: String(course.id),
        name: course.shortName || course.short_name || course.nickname || course.name || `Course ${course.id}`,
        color: colors[`course_${course.id}`] ?? course.color,
    }));
}

function mergeCourses(...courseLists) {
    return Array.from(new Map(courseLists.flat().filter(Boolean).map((course) => {
        const id = String(course.id ?? course.name ?? "");
        if (!id) {
            return null;
        }
        return [id, {
            id,
            name: course.name ?? "Canvas course",
            color: course.color,
        }];
    }).filter(Boolean)).values()).sort((a, b) => a.name.localeCompare(b.name));
}

function filterStats(stats, syncPreferences, courseVisibility) {
    const dueTodayItems = filterAssignments(stats.dueTodayItems ?? [], syncPreferences, courseVisibility);
    const overdueItems = filterAssignments(stats.overdueItems ?? [], syncPreferences, courseVisibility);
    return {
        ...stats,
        dueToday: dueTodayItems.length,
        overdue: overdueItems.length,
        dueTodayItems,
        overdueItems,
    };
}

function injectCanvasEnhancement(assignment, onOpen, onSave) {
    const existing = document.querySelector("[data-duedeck-canvas-widget]");
    existing?.remove();

    const widget = document.createElement("div");
    widget.dataset.duedeckCanvasWidget = "true";
    widget.className = "duedeck-canvas-widget";
    widget.innerHTML = `
        <div class="duedeck-canvas-widget__text">
            <strong>DueDeck</strong>
            <span>${assignment ? "Assignment detected" : "Deadlines from NJIT Canvas"}</span>
        </div>
    `;

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.textContent = "Open";
    openButton.addEventListener("click", onOpen);

    widget.append(openButton);

    if (assignment) {
        const saveButton = document.createElement("button");
        saveButton.type = "button";
        saveButton.textContent = assignment.saved ? "Saved" : "Save";
        saveButton.disabled = assignment.saved;
        saveButton.addEventListener("click", () => onSave(assignment));
        widget.append(saveButton);
    }

    if (!document.getElementById("duedeck-canvas-widget-style")) {
        const style = document.createElement("style");
        style.id = "duedeck-canvas-widget-style";
        style.textContent = `
            .duedeck-canvas-widget {
                display: flex;
                align-items: center;
                gap: 10px;
                margin: 12px 0;
                padding: 10px 12px;
                border: 1px solid rgba(210, 38, 48, 0.18);
                border-radius: 10px;
                background: #fff;
                color: #18181f;
                font-family: Inter, Lato, Arial, sans-serif;
                box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
            }
            .duedeck-canvas-widget__text {
                display: grid;
                flex: 1;
                min-width: 0;
            }
            .duedeck-canvas-widget__text strong {
                font-size: 13px;
                line-height: 1.2;
            }
            .duedeck-canvas-widget__text span {
                color: #565b66;
                font-size: 12px;
            }
            .duedeck-canvas-widget button {
                border: 1px solid #d22630;
                border-radius: 8px;
                background: #d22630;
                color: #fff;
                cursor: pointer;
                font-size: 12px;
                font-weight: 650;
                padding: 7px 10px;
            }
            .duedeck-canvas-widget button:disabled {
                cursor: default;
                opacity: 0.6;
            }
        `;
        document.head.append(style);
    }

    const assignmentTarget =
        document.querySelector("#assignment_show") ||
        document.querySelector(".assignment-title")?.parentElement ||
        document.querySelector("[data-testid='ToDoSidebar']") ||
        document.querySelector(".Sidebar__TodoListContainer");

    if (assignmentTarget) {
        assignmentTarget.prepend(widget);
    }
}

async function mountDueDeckCanvasPanel() {
    if (document.getElementById(DUEDECK_HOST_ID)) {
        return;
    }

    const host = document.createElement("div");
    host.id = DUEDECK_HOST_ID;

    const shadowRoot = host.attachShadow({ mode: "open" });

    const [theme] = await Promise.all([
        getThemePreference(),
        createPanelShadowDom(shadowRoot),
    ]);

    applyTheme(host, theme);

    const {
        renderUpNextAssignments,
        renderUpNextLoading,
        renderUpNextError,
        renderDrawerItems,
        renderWeekAssignments,
        fetchUpcomingAssignments,
        fetchCurrentUser,
        fetchAssignmentStats,
        fetchNextClassEvent,
        fetchWeekAssignments,
        fetchCurrentCanvasItem,
        getManualCaptureSuggestion,
    } = await loadPanelComponents();
    const layout = await getStoredLayout();
    const panel = shadowRoot.querySelector("[data-panel]");

    if (panel) {
        applyLayout(host, panel, layout);
    }

    const listEl = shadowRoot.querySelector("[data-up-next-list]");
    const weekListEl = shadowRoot.querySelector("[data-week-list]");
    const savedListEl = shadowRoot.querySelector("[data-saved-list]");
    const detectionEl = shadowRoot.querySelector("[data-detection]");
    let savedAssignments = await getSavedAssignments();
    let syncPreferences = await getSyncPreferences();
    let courseVisibility = await getCourseVisibility();
    let reminderSettings = await getReminderSettings();
    let assignmentReminders = await getAssignmentReminders();
    let doneAssignments = await getDoneAssignments();
    let manualTasks = await getManualTasks();
    let weekAssignments = [];
    let allVisibleAssignments = [];
    let weekFilter = "all";
    let knownCourses = [];
    let currentDetectedAssignment = null;
    let currentChecklist = null;
    let selectedAssignment = null;

    renderUpNextLoading(listEl);
    setSyncStatus(shadowRoot, "Syncing...");

    const [name] = await Promise.allSettled([fetchCurrentUser()]);
    const firstName = name.status === "fulfilled" ? name.value : null;
    const greeting = shadowRoot.querySelector(".duedeck-greeting");
    if (greeting) {
        greeting.textContent = `${getGreeting()}, ${firstName ?? "there"}`;
    }

    async function handleSaveAssignment(assignment) {
        const saved = await saveAssignment(assignment);
        savedAssignments = {
            ...savedAssignments,
            [saved.id]: saved,
        };
        if (currentDetectedAssignment?.id === saved.id) {
            currentDetectedAssignment = { ...currentDetectedAssignment, saved: true };
            renderDetectedAssignment(detectionEl, currentDetectedAssignment, {
                onSave: handleSaveAssignment,
                onRemove: handleRemoveAssignment,
                onChecklistChange: saveAssignmentChecklist,
                checklist: currentChecklist,
                onManualCapture: openManualForm,
            });
        }
        await refreshData();
        injectCanvasEnhancement(currentDetectedAssignment, openPanel, handleSaveAssignment);
    }

    async function handleRemoveAssignment(id) {
        if (manualTasks[id]) {
            await removeManualTask(id);
            manualTasks = await getManualTasks();
        } else {
            await removeSavedAssignment(id);
            savedAssignments = await getSavedAssignments();
        }
        if (currentDetectedAssignment?.id === id) {
            currentDetectedAssignment = { ...currentDetectedAssignment, saved: false };
            renderDetectedAssignment(detectionEl, currentDetectedAssignment, {
                onSave: handleSaveAssignment,
                onRemove: handleRemoveAssignment,
                onChecklistChange: saveAssignmentChecklist,
                checklist: currentChecklist,
                onManualCapture: openManualForm,
            });
        }
        await refreshData();
        injectCanvasEnhancement(currentDetectedAssignment, openPanel, handleSaveAssignment);
    }

    async function handleReminderChange(assignment, reminder) {
        assignmentReminders = {
            ...assignmentReminders,
            [assignment.id]: await saveAssignmentReminder(assignment.id, reminder, assignment),
        };
        if (selectedAssignment?.id === assignment.id) {
            await showAssignmentDetail(assignment);
        }
    }

    async function handleMarkDone(id) {
        await markAssignmentDone(id, true);
        doneAssignments = await getDoneAssignments();
        await refreshData();
        setPanelView(shadowRoot, "dashboard");
    }

    async function handleDeleteManual(id) {
        await removeManualTask(id);
        manualTasks = await getManualTasks();
        await refreshData();
        setPanelView(shadowRoot, "dashboard");
    }

    async function showAssignmentDetail(assignment) {
        selectedAssignment = assignment;
        const detailEl = shadowRoot.querySelector("[data-detail]");
        const checklist = await getAssignmentChecklist(assignment.id);
        assignmentReminders = await getAssignmentReminders();
        renderAssignmentDetail(detailEl, assignment, {
            checklist,
            reminder: assignmentReminders[assignment.id],
            onSave: handleSaveAssignment,
            onRemove: handleRemoveAssignment,
            onReminderChange: handleReminderChange,
            onChecklistChange: saveAssignmentChecklist,
            onDone: handleMarkDone,
            onDeleteManual: handleDeleteManual,
        });
        setPanelView(shadowRoot, "detail");
    }

    function openManualForm(seed = {}) {
        const modal = shadowRoot.querySelector("[data-manual-modal]");
        const form = shadowRoot.querySelector("[data-manual-form]");
        if (!modal || !form) {
            return;
        }
        form.reset();
        const error = shadowRoot.querySelector("[data-manual-error]");
        if (error) {
            error.textContent = "";
            error.hidden = true;
        }
        form.elements.title.value = seed.title ?? currentDetectedAssignment?.title ?? "";
        form.elements.course.value = seed.course ?? currentDetectedAssignment?.course ?? "";
        form.elements.description.value = seed.description ?? "";
        form.elements.type.value = seed.type ?? "assignment";
        modal.hidden = false;
        form.elements.title.focus();
    }

    async function handleManualSubmit(formData) {
        const error = shadowRoot.querySelector("[data-manual-error]");
        const title = String(formData.get("title") || "").trim();
        if (!title) {
            if (error) {
                error.textContent = "Add a title before saving.";
                error.hidden = false;
            }
            return;
        }
        const dueAtValue = formData.get("dueAt");
        const dueAt = dueAtValue ? new Date(dueAtValue).toISOString() : null;
        await saveManualTask(normalizeLocalAssignment({
            title,
            course: String(formData.get("course") || "Manual").trim() || "Manual",
            dueAt,
            description: String(formData.get("description") || ""),
            type: String(formData.get("type") || "assignment"),
            courseColor: "#d22630",
        }));
        shadowRoot.querySelector("[data-manual-modal]").hidden = true;
        manualTasks = await getManualTasks();
        await refreshData();
    }

    function openPanel() {
        host.setAttribute("data-open", "true");
    }

    async function refreshData() {
        setSyncStatus(shadowRoot, "Syncing...");
        renderUpNextLoading(listEl);

        const [upNext, stats, week, nextClass, lastSnapshot] = await Promise.all([
            fetchUpcomingAssignments(),
            fetchAssignmentStats(),
            fetchWeekAssignments(),
            fetchNextClassEvent().catch(() => null),
            getLastSyncSnapshot(),
        ]);

        savedAssignments = await getSavedAssignments();
        manualTasks = await getManualTasks();
        assignmentReminders = await getAssignmentReminders();
        doneAssignments = await getDoneAssignments();
        const manualList = Object.values(manualTasks).map(normalizeLocalAssignment).filter(assignment => !doneAssignments[assignment.id]);
        const manualDueToday = manualList.filter(assignment => {
            if (!assignment.dueAt) {
                return false;
            }
            const due = new Date(assignment.dueAt);
            const today = new Date();
            return due.toDateString() === today.toDateString();
        });
        const openUpNext = upNext.filter(assignment => !doneAssignments[assignment.id]);
        const openWeek = week.filter(assignment => !doneAssignments[assignment.id]);
        const savedUpNext = filterAssignments(withSavedState([...openUpNext, ...manualList], savedAssignments), syncPreferences, courseVisibility);
        const savedWeek = filterAssignments(withSavedState([...openWeek, ...manualList], savedAssignments), syncPreferences, courseVisibility);
        const visibleStats = filterStats({
            ...stats,
            dueTodayItems: [...(stats.dueTodayItems ?? []).filter(a => !doneAssignments[a.id]), ...manualDueToday],
            overdueItems: [...(stats.overdueItems ?? []), ...manualList.filter(a => a.timeTone === "overdue")],
        }, syncPreferences, courseVisibility);
        weekAssignments = savedWeek;
        allVisibleAssignments = savedUpNext;
        knownCourses = mergeCourses(
            getCanvasEnvCourses(),
            lastSnapshot?.courses ?? [],
            getCoursesFromAssignments([...upNext, ...week, ...manualList, ...(stats.dueTodayItems ?? []), ...(stats.overdueItems ?? [])]),
        );

        renderUpNextAssignments(listEl, savedUpNext, { onRemove: handleRemoveAssignment, onSelect: showAssignmentDetail });
        renderWeekAssignments(weekListEl, weekAssignments, weekFilter, { onRemove: handleRemoveAssignment, onSelect: showAssignmentDetail });
        renderUpNextAssignments(savedListEl, savedUpNext.filter(assignment => assignment.saved || assignment.platformType === "manual"), {
            onRemove: handleRemoveAssignment,
            onSelect: showAssignmentDetail,
        });
        setWeekSummary(shadowRoot, weekAssignments);
        renderSettings(shadowRoot, {
            syncPreferences,
            reminderSettings,
            courseVisibility,
            courses: knownCourses,
        }, settingsCallbacks);

        const todayEl = shadowRoot.querySelector("[data-stat='today'] strong");
        if (todayEl) {
            todayEl.textContent = visibleStats.dueToday;
        }
        if (panel) {
            bindDrawer(shadowRoot, panel, layout, visibleStats, await getTriageState(), (root, assignments, type) => {
                renderDrawerItems(root, assignments, type, { onSelect: showAssignmentDetail });
            });
        }

        const syncedAt = new Date();
        setSyncStatus(shadowRoot, formatSyncStatus(syncedAt));
        saveLastSyncSnapshot({
            canvasConnected: true,
            canvasHost: location.host,
            lastSyncedAt: syncedAt.toISOString(),
            stats: {
                dueToday: visibleStats.dueToday,
                overdue: visibleStats.overdue,
            },
            upNext: savedUpNext.slice(0, 8),
            courses: knownCourses,
            nextClass,
            syncError: null,
        });
    }

    const settingsCallbacks = {
        onSyncPreferencesChange: async (next) => {
            syncPreferences = next;
            await saveSyncPreferences(syncPreferences);
            await refreshData();
        },
        onReminderSettingsChange: async (next) => {
            reminderSettings = next;
            await saveReminderSettings(reminderSettings);
            renderSettings(shadowRoot, {
                syncPreferences,
                reminderSettings,
                courseVisibility,
                courses: knownCourses,
            }, settingsCallbacks);
        },
        onCourseVisibilityChange: async (next) => {
            courseVisibility = next;
            await saveCourseVisibility(courseVisibility);
            await refreshData();
        },
        onDisconnectCanvas: async () => {
            await saveLastSyncSnapshot({
                canvasConnected: false,
                canvasHost: location.host,
                lastSyncedAt: null,
                stats: { dueToday: 0, overdue: 0 },
                upNext: [],
                courses: [],
                nextClass: null,
                syncError: null,
            });
            setSyncStatus(shadowRoot, "NJIT Canvas data disconnected locally.");
        },
        onClearData: async () => {
            await clearDueDeckData();
            setSyncStatus(shadowRoot, "DueDeck data cleared. Refresh NJIT Canvas to start again.");
        },
    };

    async function refreshDetectedAssignment() {
        try {
            const assignment = await fetchCurrentCanvasItem();
            if (!assignment) {
                currentDetectedAssignment = null;
                currentChecklist = null;
                const suggestion = getManualCaptureSuggestion?.();
                if (suggestion) {
                    currentDetectedAssignment = suggestion;
                }
                renderDetectedAssignment(detectionEl, suggestion, {
                    onSave: handleSaveAssignment,
                    onRemove: handleRemoveAssignment,
                    onChecklistChange: saveAssignmentChecklist,
                    onManualCapture: () => openManualForm(suggestion ?? {}),
                    showManualCapture: Boolean(suggestion),
                });
                injectCanvasEnhancement(null, openPanel, handleSaveAssignment);
                return;
            }
            currentDetectedAssignment = {
                ...assignment,
                saved: Boolean(savedAssignments[assignment.id]),
            };
            currentChecklist = await getAssignmentChecklist(currentDetectedAssignment.id);
            renderDetectedAssignment(detectionEl, currentDetectedAssignment, {
                onSave: handleSaveAssignment,
                onRemove: handleRemoveAssignment,
                onChecklistChange: saveAssignmentChecklist,
                checklist: currentChecklist,
                onManualCapture: () => openManualForm(currentDetectedAssignment),
            });
            injectCanvasEnhancement(currentDetectedAssignment, openPanel, handleSaveAssignment);
        } catch {
        }
    }

    refreshDetectedAssignment();

    refreshData().catch(() => {
        renderUpNextError(listEl);
        setSyncStatus(shadowRoot, "Sync failed");
        saveLastSyncSnapshot({
            canvasConnected: true,
            canvasHost: location.host,
            lastSyncedAt: new Date().toISOString(),
            stats: { dueToday: 0, overdue: 0 },
            upNext: [],
            courses: knownCourses,
            nextClass: null,
            syncError: "NJIT Canvas sync failed. Try refreshing NJIT Canvas or signing in again.",
        });
    });

    bindPanelControls(host, shadowRoot, layout, {
        onSync: () => refreshData().catch(() => {
            renderUpNextError(listEl);
            setSyncStatus(shadowRoot, "Sync failed");
        }),
        onWeekFilter: (filter) => {
            weekFilter = filter;
            renderWeekAssignments(weekListEl, weekAssignments, weekFilter, { onRemove: handleRemoveAssignment, onSelect: showAssignmentDetail });
        },
        onWeekView: () => {
            setPanelView(shadowRoot, "week");
            renderWeekAssignments(weekListEl, weekAssignments, weekFilter, { onRemove: handleRemoveAssignment, onSelect: showAssignmentDetail });
        },
        onSavedView: () => {
            setPanelView(shadowRoot, "saved");
            renderUpNextAssignments(savedListEl, allVisibleAssignments.filter(assignment => assignment.saved || assignment.platformType === "manual"), {
                onRemove: handleRemoveAssignment,
                onSelect: showAssignmentDetail,
            });
        },
        onSettingsView: () => {
            renderSettings(shadowRoot, {
                syncPreferences,
                reminderSettings,
                courseVisibility,
                courses: knownCourses,
            }, settingsCallbacks);
        },
        onOpenManual: () => openManualForm(),
        onManualSubmit: handleManualSubmit,
    });
    bindThemeToggle(host, shadowRoot);

    let lastUrl = location.href;
    const handleRouteChange = () => {
        if (location.href === lastUrl) {
            return;
        }
        lastUrl = location.href;
        window.setTimeout(refreshDetectedAssignment, 250);
    };
    ["pushState", "replaceState"].forEach((method) => {
        const original = history[method];
        history[method] = function patchedHistoryMethod(...args) {
            const result = original.apply(this, args);
            handleRouteChange();
            return result;
        };
    });
    window.addEventListener("popstate", handleRouteChange);

    document.documentElement.append(host);
}

export function startDueDeck() {
    mountDueDeckCanvasPanel().catch((error) => {
        console.error("[DueDeck] Failed to mount Canvas panel", error);
    });
}
