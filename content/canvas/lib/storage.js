const STORAGE_KEY = "duedeckCanvasPanelLayout";
const LEGACY_STORAGE_KEY = "duedeckOverlayLayout";
const THEME_STORAGE_KEY = "duedeckTheme";
const SAVED_ASSIGNMENTS_KEY = "duedeckSavedAssignments";
const REMINDER_SETTINGS_KEY = "duedeckReminderSettings";
const ONBOARDING_STORAGE_KEY = "duedeckOnboardingComplete";
const SYNC_PREFERENCES_KEY = "duedeckSyncPreferences";
const COURSE_VISIBILITY_KEY = "duedeckCourseVisibility";
const LAST_SYNC_SNAPSHOT_KEY = "duedeckLastSyncSnapshot";
const ASSIGNMENT_CHECKLISTS_KEY = "duedeckAssignmentChecklists";
const MANUAL_TASKS_KEY = "duedeckManualTasks";
const ASSIGNMENT_REMINDERS_KEY = "duedeckAssignmentReminders";
const DONE_ASSIGNMENTS_KEY = "duedeckDoneAssignments";

export const DEFAULT_SYNC_PREFERENCES = {
    assignments: true,
    quizzes: true,
    discussions: true,
};

export const DEFAULT_REMINDER_SETTINGS = {
    defaultOffsetHours: 24,
};

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
    }
}

export function getThemePreference() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([THEME_STORAGE_KEY], (result) => {
            resolve(result?.[THEME_STORAGE_KEY] ?? "light");
        });
    });
}

export function saveThemePreference(theme) {
    try {
        chrome.storage?.local?.set({ [THEME_STORAGE_KEY]: theme });
    } catch {
    }
}

const TRIAGE_STORAGE_KEY = "duedeckTriageState";

export function getTriageState() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([TRIAGE_STORAGE_KEY], (result) => {
            resolve(result?.[TRIAGE_STORAGE_KEY] ?? {});
        });
    });
}

export function saveTriageState(state) {
    try {
        chrome.storage?.local?.set({ [TRIAGE_STORAGE_KEY]: state });
    } catch {
    }
}

export function getSavedAssignments() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([SAVED_ASSIGNMENTS_KEY], (result) => {
            resolve(result?.[SAVED_ASSIGNMENTS_KEY] ?? {});
        });
    });
}

export async function saveAssignment(assignment) {
    const saved = await getSavedAssignments();
    const nextAssignment = {
        ...assignment,
        saved: true,
        savedAt: new Date().toISOString(),
    };
    const next = {
        ...saved,
        [nextAssignment.id]: nextAssignment,
    };

    await new Promise((resolve) => {
        chrome.storage?.local?.set({ [SAVED_ASSIGNMENTS_KEY]: next }, resolve);
    });

    try {
        chrome.runtime?.sendMessage?.({
            type: "DUEDECK_SCHEDULE_REMINDER",
            assignment: nextAssignment,
            offsetHours: await getAssignmentReminderOffset(nextAssignment.id),
        });
    } catch {
    }

    return nextAssignment;
}

export async function removeSavedAssignment(id) {
    const saved = await getSavedAssignments();
    const next = { ...saved };
    delete next[id];

    await new Promise((resolve) => {
        chrome.storage?.local?.set({ [SAVED_ASSIGNMENTS_KEY]: next }, resolve);
    });

    try {
        chrome.runtime?.sendMessage?.({ type: "DUEDECK_CANCEL_REMINDER", id });
    } catch {
    }
}

export function getManualTasks() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([MANUAL_TASKS_KEY], (result) => {
            resolve(result?.[MANUAL_TASKS_KEY] ?? {});
        });
    });
}

export async function saveManualTask(task) {
    const tasks = await getManualTasks();
    const id = task.id || `manual_${Date.now()}`;
    const dueAt = task.dueAt || null;
    const nextTask = {
        ...task,
        id,
        sourceId: id,
        platform: "Manual",
        platformType: "manual",
        type: task.type || "assignment",
        saved: true,
        dueAt,
        createdAt: task.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    await new Promise((resolve) => {
        chrome.storage?.local?.set({
            [MANUAL_TASKS_KEY]: {
                ...tasks,
                [id]: nextTask,
            },
        }, resolve);
    });

    try {
        chrome.runtime?.sendMessage?.({
            type: "DUEDECK_SCHEDULE_REMINDER",
            assignment: nextTask,
            offsetHours: await getAssignmentReminderOffset(id),
        });
    } catch {
    }

    return nextTask;
}

export async function removeManualTask(id) {
    const tasks = await getManualTasks();
    const next = { ...tasks };
    delete next[id];

    await new Promise((resolve) => {
        chrome.storage?.local?.set({ [MANUAL_TASKS_KEY]: next }, resolve);
    });

    try {
        chrome.runtime?.sendMessage?.({ type: "DUEDECK_CANCEL_REMINDER", id });
    } catch {
    }
}

export function getAssignmentReminders() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([ASSIGNMENT_REMINDERS_KEY], (result) => {
            resolve(result?.[ASSIGNMENT_REMINDERS_KEY] ?? {});
        });
    });
}

export async function getAssignmentReminderOffset(id) {
    const reminders = await getAssignmentReminders();
    const setting = reminders?.[id];
    if (!setting?.enabled) {
        return null;
    }
    const hours = Number(setting.offsetHours);
    return Number.isFinite(hours) && hours > 0 ? hours : null;
}

export async function saveAssignmentReminder(id, reminder, assignment) {
    const reminders = await getAssignmentReminders();
    const nextReminder = {
        enabled: reminder?.enabled !== false,
        offsetHours: Number(reminder?.offsetHours ?? 24),
        updatedAt: new Date().toISOString(),
    };

    await new Promise((resolve) => {
        chrome.storage?.local?.set({
            [ASSIGNMENT_REMINDERS_KEY]: {
                ...reminders,
                [id]: nextReminder,
            },
        }, resolve);
    });

    try {
        if (nextReminder.enabled && assignment) {
            chrome.runtime?.sendMessage?.({
                type: "DUEDECK_SCHEDULE_REMINDER",
                assignment,
                offsetHours: nextReminder.offsetHours,
            });
        } else {
            chrome.runtime?.sendMessage?.({ type: "DUEDECK_CANCEL_REMINDER", id });
        }
    } catch {
    }

    return nextReminder;
}

export async function clearAssignmentReminder(id) {
    const reminders = await getAssignmentReminders();
    const next = { ...reminders };
    delete next[id];
    await new Promise((resolve) => {
        chrome.storage?.local?.set({ [ASSIGNMENT_REMINDERS_KEY]: next }, resolve);
    });
    try {
        chrome.runtime?.sendMessage?.({ type: "DUEDECK_CANCEL_REMINDER", id });
    } catch {
    }
}

export function getDoneAssignments() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([DONE_ASSIGNMENTS_KEY], (result) => {
            resolve(result?.[DONE_ASSIGNMENTS_KEY] ?? {});
        });
    });
}

export async function markAssignmentDone(id, done = true) {
    const doneAssignments = await getDoneAssignments();
    const next = { ...doneAssignments };
    if (done) {
        next[id] = new Date().toISOString();
    } else {
        delete next[id];
    }
    return new Promise((resolve) => {
        chrome.storage?.local?.set({ [DONE_ASSIGNMENTS_KEY]: next }, resolve);
    });
}

export function getReminderSettings() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([REMINDER_SETTINGS_KEY], (result) => {
            resolve({
                ...DEFAULT_REMINDER_SETTINGS,
                ...(result?.[REMINDER_SETTINGS_KEY] ?? {}),
            });
        });
    });
}

export function saveReminderSettings(settings) {
    return new Promise((resolve) => {
        chrome.storage?.local?.set({
            [REMINDER_SETTINGS_KEY]: {
                ...DEFAULT_REMINDER_SETTINGS,
                ...(settings ?? {}),
            },
        }, resolve);
    });
}

export function getOnboardingComplete() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([ONBOARDING_STORAGE_KEY], (result) => {
            resolve(Boolean(result?.[ONBOARDING_STORAGE_KEY]));
        });
    });
}

export function setOnboardingComplete(complete = true) {
    return new Promise((resolve) => {
        chrome.storage?.local?.set({ [ONBOARDING_STORAGE_KEY]: Boolean(complete) }, resolve);
    });
}

export function getSyncPreferences() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([SYNC_PREFERENCES_KEY], (result) => {
            resolve({
                ...DEFAULT_SYNC_PREFERENCES,
                ...(result?.[SYNC_PREFERENCES_KEY] ?? {}),
            });
        });
    });
}

export function saveSyncPreferences(preferences) {
    return new Promise((resolve) => {
        chrome.storage?.local?.set({
            [SYNC_PREFERENCES_KEY]: {
                ...DEFAULT_SYNC_PREFERENCES,
                ...(preferences ?? {}),
            },
        }, resolve);
    });
}

export function getCourseVisibility() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([COURSE_VISIBILITY_KEY], (result) => {
            resolve(result?.[COURSE_VISIBILITY_KEY] ?? {});
        });
    });
}

export function saveCourseVisibility(visibility) {
    return new Promise((resolve) => {
        chrome.storage?.local?.set({ [COURSE_VISIBILITY_KEY]: visibility ?? {} }, resolve);
    });
}

export function getLastSyncSnapshot() {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([LAST_SYNC_SNAPSHOT_KEY], (result) => {
            resolve(result?.[LAST_SYNC_SNAPSHOT_KEY] ?? null);
        });
    });
}

export function saveLastSyncSnapshot(snapshot) {
    return new Promise((resolve) => {
        chrome.storage?.local?.set({ [LAST_SYNC_SNAPSHOT_KEY]: snapshot }, resolve);
    });
}

export function clearDueDeckData() {
    const keys = [
        STORAGE_KEY,
        LEGACY_STORAGE_KEY,
        THEME_STORAGE_KEY,
        SAVED_ASSIGNMENTS_KEY,
        REMINDER_SETTINGS_KEY,
        ONBOARDING_STORAGE_KEY,
        SYNC_PREFERENCES_KEY,
        COURSE_VISIBILITY_KEY,
        LAST_SYNC_SNAPSHOT_KEY,
        ASSIGNMENT_CHECKLISTS_KEY,
        MANUAL_TASKS_KEY,
        ASSIGNMENT_REMINDERS_KEY,
        DONE_ASSIGNMENTS_KEY,
        TRIAGE_STORAGE_KEY,
    ];

    return new Promise((resolve) => {
        chrome.storage?.local?.remove(keys, resolve);
    });
}

export function getAssignmentChecklist(id) {
    return new Promise((resolve) => {
        chrome.storage?.local?.get([ASSIGNMENT_CHECKLISTS_KEY], (result) => {
            resolve(result?.[ASSIGNMENT_CHECKLISTS_KEY]?.[id] ?? null);
        });
    });
}

export async function saveAssignmentChecklist(id, checklist) {
    const all = await new Promise((resolve) => {
        chrome.storage?.local?.get([ASSIGNMENT_CHECKLISTS_KEY], (result) => {
            resolve(result?.[ASSIGNMENT_CHECKLISTS_KEY] ?? {});
        });
    });

    return new Promise((resolve) => {
        chrome.storage?.local?.set({
            [ASSIGNMENT_CHECKLISTS_KEY]: {
                ...all,
                [id]: checklist,
            },
        }, resolve);
    });
}
