const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

export function formatDueDate(isoString) {
    if (!isoString) return "No due date";

    const due = new Date(isoString);
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
    const dayAfterStart = new Date(tomorrowStart.getTime() + DAY_MS);

    if (due < now) {
        const daysAgo = Math.floor((now - due) / DAY_MS);
        if (daysAgo === 0) return "Due tonight";
        if (daysAgo === 1) return "Yesterday";
        return `${daysAgo}d overdue`;
    }

    if (due < tomorrowStart) {
        return due.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    if (due < dayAfterStart) return "Tomorrow";

    if (due - now < 7 * DAY_MS) {
        return due.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    }

    return due.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function getTimeTone(isoString) {
    if (!isoString) return "normal";
    const diff = new Date(isoString) - Date.now();
    if (diff < 0) return "overdue";
    if (diff < HOUR_MS * 24) return "urgent";
    return "normal";
}
