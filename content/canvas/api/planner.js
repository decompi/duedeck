import { formatDueDate, getTimeTone } from "../lib/date.js";

const SUPPORTED_TYPES = new Set(["assignment", "quiz", "discussion_topic", "assessment"]);

/**
 * Canvas API: GET /api/v1/users/self/profile
 * Docs: https://canvas.instructure.com/doc/api/users.html#method.profile.settings
 *
 * Grabs the current user's profile to personalize the greeting.
 * Prefers `short_name` (user's display name in Canvas settings) over `name`
 * (full name), then returns just the first word.
 *
 * @returns {Promise<string|null>}
 */
export async function fetchCurrentUser() {
    const response = await fetch("/api/v1/users/self/profile", {
        credentials: "same-origin",
        headers: { Accept: "application/json+canvas-string-ids, application/json" },
    });
    if (!response.ok) throw new Error(`Canvas API ${response.status}`);
    const { short_name, name } = await response.json();
    const display = short_name || name || "";
    return display.split(" ")[0] || null;
}

/**
 * Canvas API: GET /api/v1/planner/items
 * Docs: https://canvas.instructure.com/doc/api/planner.html#method.planner.index
 *
 * Fetches upcoming and recent plannable items across all active enrollments.
 * We start 7 days back so overdue unsubmitted work still shows up, then
 * filter client-side to drop already-submitted/graded items and unsupported
 * types (wiki pages, announcements, planner notes, etc.).
 *
 * Fields we use from each item:
 *   - plannable_type: filters to assignment / quiz / discussion_topic / assessment
 *   - plannable.title: shown as the row title
 *   - plannable.due_at / plannable_date: used for date formatting and urgency
 *   - context_name: course name in the meta line
 *   - html_url: where clicking the row navigates
 *   - submissions.submitted / submissions.graded: used to skip completed work
 *
 * @param {object} [options]
 * @param {number} [options.limit=10]
 * @returns {Promise<Assignment[]>}
 */
export async function fetchUpcomingAssignments({ limit = 10 } = {}) {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    since.setHours(0, 0, 0, 0);

    const params = new URLSearchParams({
        per_page: String(Math.min(limit * 2, 50)),
        start_date: since.toISOString().split("T")[0],
    });

    const response = await fetch(`/api/v1/planner/items?${params}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json+canvas-string-ids, application/json" },
    });

    if (!response.ok) throw new Error(`Canvas API ${response.status}`);

    const items = await response.json();

    return items
        .filter(item => SUPPORTED_TYPES.has(item.plannable_type))
        .filter(item => !item.submissions?.submitted && !item.submissions?.graded)
        .slice(0, limit)
        .map(toAssignment);
}

/**
 * Canvas API: GET /api/v1/planner/items
 * Docs: https://canvas.instructure.com/doc/api/planner.html#method.planner.index
 *
 * Same endpoint as fetchUpcomingAssignments but with a 30-day lookback window
 * to get accurate counts for the "Due today" and "Overdue" stat cards.
 * We filter out submitted/graded items the same way, then bucket by due date.
 *
 * Fields used:
 *   - plannable.due_at / plannable_date: compared against today to bucket items
 *   - submissions.submitted / submissions.graded: skip completed work
 *   - plannable_type: same SUPPORTED_TYPES filter as the list
 *
 * @returns {Promise<{ dueToday: number, overdue: number }>}
 */
export async function fetchAssignmentStats() {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);

    const params = new URLSearchParams({
        per_page: "100",
        start_date: since.toISOString().split("T")[0],
    });

    const response = await fetch(`/api/v1/planner/items?${params}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json+canvas-string-ids, application/json" },
    });

    if (!response.ok) throw new Error(`Canvas API ${response.status}`);

    const items = await response.json();
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 86_400_000 - 1);

    const unsubmitted = items.filter(item =>
        SUPPORTED_TYPES.has(item.plannable_type) &&
        !item.submissions?.submitted &&
        !item.submissions?.graded
    );

    const dueToday = unsubmitted.filter(item => {
        const due = new Date(item.plannable?.due_at ?? item.plannable_date);
        return due >= todayStart && due <= todayEnd;
    }).length;

    const overdue = unsubmitted.filter(item => {
        const due = new Date(item.plannable?.due_at ?? item.plannable_date);
        return due < todayStart;
    }).length;

    return { dueToday, overdue };
}

function toAssignment(item) {
    const dueAt = item.plannable?.due_at ?? item.plannable_date ?? null;
    return {
        course: item.context_name ?? "Unknown Course",
        platform: "Canvas",
        platformType: "canvas",
        time: formatDueDate(dueAt),
        timeTone: getTimeTone(dueAt),
        title: item.plannable?.title ?? "Untitled",
        url: item.html_url ?? null,
    };
}
