const HOST_ID = "duedeck-canvas-panel-host";
const SAVED_ASSIGNMENTS_KEY = "duedeckSavedAssignments";
const LAST_SYNC_SNAPSHOT_KEY = "duedeckLastSyncSnapshot";
const REMINDER_SETTINGS_KEY = "duedeckReminderSettings";
const REMINDER_PREFIX = "duedeck-reminder:";
const NJIT_CANVAS_URL = "https://njit.instructure.com/";

function isUsableTab(tab) {
    return Boolean(tab?.id && tab?.url && /^https:\/\//.test(tab.url));
}

async function openDueDeckPanel(tab, open = true) {
    if (!isUsableTab(tab)) {
        return { ok: false, reason: "DueDeck works after you open NJIT Canvas in a normal HTTPS tab." };
    }

    async function toggleExisting() {
        const [{ result: didToggle } = {}] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (hostId, shouldOpen) => {
                const host = document.getElementById(hostId);
                if (!host) {
                    return false;
                }
                if (shouldOpen) {
                    host.setAttribute("data-open", "true");
                } else {
                    const isOpen = host.getAttribute("data-open") === "true";
                    host.setAttribute("data-open", isOpen ? "false" : "true");
                }
                return true;
            },
            args: [HOST_ID, open],
        });
        return Boolean(didToggle);
    }

    if (await toggleExisting()) {
        return { ok: true, mounted: true };
    }

    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/canvas/entrypoints/index.js"],
    });

    await new Promise(resolve => setTimeout(resolve, 120));
    const opened = await toggleExisting();
    return opened
        ? { ok: true, mounted: false }
        : { ok: false, mounted: false, reason: "Open NJIT Canvas first, then try DueDeck again." };
}

chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id || !tab.url || !/^https:\/\//.test(tab.url)) {
        return;
    }
    await openDueDeckPanel(tab, false);
});

async function getReminderOffsetHours() {
    const result = await chrome.storage.local.get([REMINDER_SETTINGS_KEY]);
    const hours = Number(result?.[REMINDER_SETTINGS_KEY]?.defaultOffsetHours ?? 24);
    return Number.isFinite(hours) && hours > 0 ? hours : 24;
}

async function getReminderTime(assignment, offsetHoursOverride) {
    if (!assignment?.dueAt) {
        return null;
    }
    const dueTime = new Date(assignment.dueAt).getTime();
    if (!Number.isFinite(dueTime)) {
        return null;
    }
    const offsetHours = Number(offsetHoursOverride) || await getReminderOffsetHours();
    const reminderTime = dueTime - offsetHours * 60 * 60 * 1000;
    return reminderTime > Date.now() ? reminderTime : null;
}

async function scheduleReminder(assignment, offsetHours) {
    if (!assignment?.id) {
        return false;
    }
    if (!offsetHours) {
        await cancelReminder(assignment.id);
        return false;
    }
    const when = await getReminderTime(assignment, offsetHours);
    const alarmName = `${REMINDER_PREFIX}${assignment.id}`;
    await chrome.alarms.clear(alarmName);
    if (!when) {
        return false;
    }
    await chrome.alarms.create(alarmName, { when });
    return true;
}

async function cancelReminder(id) {
    if (!id) {
        return;
    }
    await chrome.alarms.clear(`${REMINDER_PREFIX}${id}`);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "DUEDECK_OPEN_PANEL") {
        chrome.tabs.query({ active: true, currentWindow: true })
            .then(([tab]) => openDueDeckPanel(tab, true))
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (message?.type === "DUEDECK_OPEN_CANVAS") {
        chrome.storage.local.get([LAST_SYNC_SNAPSHOT_KEY])
            .then((result) => {
                const host = result?.[LAST_SYNC_SNAPSHOT_KEY]?.canvasHost;
                const url = host ? `https://${host}/` : NJIT_CANVAS_URL;
                return chrome.tabs.create({ url });
            })
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (message?.type === "DUEDECK_SCHEDULE_REMINDER") {
        scheduleReminder(message.assignment, message.offsetHours)
            .then((scheduled) => sendResponse({ ok: true, scheduled }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (message?.type === "DUEDECK_CANCEL_REMINDER") {
        cancelReminder(message.id)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith(REMINDER_PREFIX)) {
        return;
    }

    const id = alarm.name.slice(REMINDER_PREFIX.length);
    const result = await chrome.storage.local.get([SAVED_ASSIGNMENTS_KEY]);
    const saved = result?.[SAVED_ASSIGNMENTS_KEY] ?? {};
    const assignment = saved[id];
    if (!assignment) {
        return;
    }

    const due = assignment.dueAt
        ? new Date(assignment.dueAt).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        })
        : "soon";

    await chrome.notifications.create(`duedeck-notification:${id}`, {
        type: "basic",
        iconUrl: "assets/platforms/canvas.svg",
        title: `DueDeck: ${assignment.title}`,
        message: `${assignment.course || "NJIT Canvas"} is due ${due}.`,
        priority: 1,
    });
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
    if (!notificationId.startsWith("duedeck-notification:")) {
        return;
    }

    const id = notificationId.replace("duedeck-notification:", "");
    const result = await chrome.storage.local.get([SAVED_ASSIGNMENTS_KEY, "duedeckManualTasks"]);
    const assignment = result?.[SAVED_ASSIGNMENTS_KEY]?.[id] ?? result?.duedeckManualTasks?.[id];
    if (assignment?.url) {
        await chrome.tabs.create({ url: assignment.url });
    }
    await chrome.notifications.clear(notificationId);
});
