import { formatDueDate, getTimeTone } from "../lib/date.js";

const SUPPORTED_TYPES = new Set(["assignment", "quiz", "discussion_topic", "assessment"]);
const WEEK_DAYS = 7;
const CANVAS_JSON_HEADERS = { Accept: "application/json+canvas-string-ids, application/json" };

/**
 * Canvas API: GET /api/v1/users/self/profile
 * Docs: https://developerdocs.instructure.com/services/canvas/resources/users
 *
 * Request params: none.
 * Reads: `short_name`, `name`.
 * Returns: the first display-name token for the DueDeck greeting, or null.
 *
 * Canvas docs recommend `Accept: application/json+canvas-string-ids` so large
 * integer IDs remain safe in JavaScript.
 *
 * @returns {Promise<string|null>}
 */
export async function fetchCurrentUser() {
    const response = await fetch("/api/v1/users/self/profile", {
        credentials: "same-origin",
        headers: CANVAS_JSON_HEADERS,
    });
    if (!response.ok) {
        throw new Error(`Canvas API ${response.status}`);
    }
    const { short_name, name } = await response.json();
    const display = short_name || name || "";
    return display.split(" ")[0] || null;
}

/**
 * Canvas API: GET /api/v1/calendar_events
 * Docs: https://developerdocs.instructure.com/services/canvas/resources/calendar_events
 *
 * Request params:
 *   - `type=event` so assignments are not mixed into the next-class card.
 *   - `start_date` and `end_date` bound the search to the next 14 days.
 *   - `per_page=25` keeps the call small for side-panel sync.
 *
 * Reads: `id`, `title`, `context_code`, `context_name`, `start_at`,
 * `end_at`, `html_url`.
 * Returns: one normalized class/event object, or null when Canvas has no
 * upcoming calendar event in the selected window.
 *
 * @returns {Promise<object|null>}
 */
export async function fetchNextClassEvent() {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 14);
    const params = new URLSearchParams({
        type: "event",
        start_date: now.toISOString(),
        end_date: end.toISOString(),
        per_page: "25",
    });

    const response = await fetch(`/api/v1/calendar_events?${params}`, {
        credentials: "same-origin",
        headers: CANVAS_JSON_HEADERS,
    });

    if (!response.ok) {
        throw new Error(`Canvas API ${response.status}`);
    }

    const events = await response.json();
    const upcoming = events
        .map(toClassEvent)
        .filter(event => event.startAt && new Date(event.startAt) > now)
        .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

    return upcoming[0] ?? null;
}

/**
 * Canvas API: GET /api/v1/planner/items
 * Docs: https://developerdocs.instructure.com/services/canvas/resources/planner
 *
 * Request params:
 *   - `start_date`: 7 days back to include recently overdue work.
 *   - `end_date`: 90 days forward so the list does not become unbounded.
 *   - `per_page`: at most 50 for this compact list.
 *   - `filter=incomplete_items`: documented Canvas filter for uncompleted work.
 *
 * Reads: planner item `plannable_type`, `plannable_id`, `plannable`,
 * `plannable_date`, `context_name`, `context_code`, `course_id`, `html_url`,
 * and `submissions`.
 * Returns: normalized DueDeck assignments sorted by Canvas planner order.
 *
 * @param {object} [options]
 * @param {number} [options.limit=30]
 * @returns {Promise<Assignment[]>}
 */
export async function fetchUpcomingAssignments({ limit = 30 } = {}) {
    const items = await fetchPlannerItems({
        endOffsetDays: 90,
        lookbackDays: 7,
        perPage: Math.min(limit * 2, 50),
    });

    return getOpenPlannerItems(items)
        .slice(0, limit)
        .map(toAssignment);
}

/**
 * Canvas API: GET /api/v1/planner/items
 * Docs: https://developerdocs.instructure.com/services/canvas/resources/planner
 *
 * Request params: `start_date`, `end_date`, `per_page=100`,
 * `filter=incomplete_items`.
 *
 * Reads the same planner item fields as `fetchUpcomingAssignments`.
 * Returns: normalized DueDeck assignments due between now and 7 days out,
 * sorted earliest-first.
 *
 * @returns {Promise<Assignment[]>}
 */
export async function fetchWeekAssignments() {
    const items = await fetchPlannerItems({ endOffsetDays: WEEK_DAYS, lookbackDays: 7, perPage: 100 });
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + WEEK_DAYS);
    weekEnd.setHours(23, 59, 59, 999);

    return getOpenPlannerItems(items)
        .map(toAssignment)
        .filter(assignment => {
            if (!assignment.dueAt) {
                return false;
            }
            const due = new Date(assignment.dueAt);
            return due <= weekEnd;
        })
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

/**
 * Canvas API: GET /api/v1/planner/items
 * Docs: https://developerdocs.instructure.com/services/canvas/resources/planner
 *
 * Request params: `start_date` 30 days back, `end_date` 7 days forward,
 * `per_page=100`, `filter=incomplete_items`.
 *
 * Reads planner due dates and submission state, then buckets normalized
 * DueDeck assignments into `dueTodayItems` and `overdueItems`.
 *
 * @returns {Promise<{ dueToday: number, overdue: number }>}
 */
export async function fetchAssignmentStats() {
    const items = await fetchPlannerItems({ endOffsetDays: 7, lookbackDays: 30, perPage: 100 });
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 86_400_000 - 1);

    const unsubmitted = getOpenPlannerItems(items);

    const dueToday = unsubmitted.filter(item => {
        const due = getPlannerDueDate(item);
        if (!due) {
            return false;
        }
        return due >= todayStart && due <= todayEnd;
    }).length;

    const overdue = unsubmitted.filter(item => {
        const due = getPlannerDueDate(item);
        if (!due) {
            return false;
        }
        return due < todayStart;
    }).length;

    const overdueItems = unsubmitted
        .filter(item => {
            const due = getPlannerDueDate(item);
            return due && due < todayStart;
        })
        .map(toAssignment);

    const dueTodayItems = unsubmitted
        .filter(item => {
            const due = getPlannerDueDate(item);
            if (!due) {
                return false;
            }
            return due >= todayStart && due <= todayEnd;
        })
        .map(toAssignment);

    return { dueToday, overdue, overdueItems, dueTodayItems };
}

/**
 * Canvas API: GET /api/v1/planner/items
 * Docs: https://developerdocs.instructure.com/services/canvas/resources/planner
 *
 * Request params:
 *   - `start_date`: yyyy-mm-dd, generated from `lookbackDays`.
 *   - `end_date`: yyyy-mm-dd, generated from `endOffsetDays`.
 *   - `per_page`: page size.
 *   - `filter=incomplete_items`: excludes items Canvas considers complete.
 *
 * Returns raw Canvas planner items. Higher-level functions normalize them into
 * DueDeck assignments and still keep local submission guards for Canvas
 * instances that omit or vary the planner filter behavior.
 *
 * @param {object} [options]
 * @param {number} [options.lookbackDays=7]
 * @param {number} [options.endOffsetDays=90]
 * @param {number} [options.perPage=100]
 * @returns {Promise<object[]>}
 */
export async function fetchPlannerItems({ lookbackDays = 7, endOffsetDays = 90, perPage = 100 } = {}) {
    const since = new Date();
    since.setDate(since.getDate() - lookbackDays);
    since.setHours(0, 0, 0, 0);
    const until = new Date();
    until.setDate(until.getDate() + endOffsetDays);
    until.setHours(23, 59, 59, 999);

    const params = new URLSearchParams({
        end_date: until.toISOString().split("T")[0],
        filter: "incomplete_items",
        per_page: String(perPage),
        start_date: since.toISOString().split("T")[0],
    });

    const response = await fetch(`/api/v1/planner/items?${params}`, {
        credentials: "same-origin",
        headers: CANVAS_JSON_HEADERS,
    });

    if (!response.ok) {
        throw new Error(`Canvas API ${response.status}`);
    }

    return response.json();
}

/**
 * Canvas item details:
 *   - Assignments: GET /api/v1/courses/:course_id/assignments/:id
 *     Docs: https://developerdocs.instructure.com/services/canvas/resources/assignments
 *   - Quizzes: GET /api/v1/courses/:course_id/quizzes/:id
 *     Docs: https://developerdocs.instructure.com/services/canvas/resources/quizzes
 *   - Discussions: GET /api/v1/courses/:course_id/discussion_topics/:topic_id
 *     Docs: https://developerdocs.instructure.com/services/canvas/resources/discussion_topics
 *
 * Request params: assignments request `include[]=submission`; discussion and
 * quiz detail requests do not need extra params for the fields DueDeck uses.
 *
 * Reads: `due_at`, nested `assignment.due_at`, `todo_date`, `title`, `name`,
 * `html_url`, `description`, `message`, `body`, `points_possible`, and nested
 * `assignment.points_possible`.
 * Returns: one normalized DueDeck assignment, or null when the current Canvas
 * route is not an assignment/quiz/discussion page.
 *
 * @returns {Promise<Assignment|null>}
 */
export async function fetchCurrentCanvasItem() {
    const match = getCurrentCanvasItemMatch();
    if (!match) {
        return null;
    }

    const course = getCourseFromEnv(match.courseId);
    const endpoint = getCanvasItemEndpoint(match);
    const response = await fetch(endpoint, {
        credentials: "same-origin",
        headers: CANVAS_JSON_HEADERS,
    });

    if (!response.ok) {
        throw new Error(`Canvas API ${response.status}`);
    }

    const item = await response.json();
    return toAssignmentFromCanvasItem(item, match, course);
}

/**
 * Local DOM helper for pages that are not represented by a DueDeck-supported
 * Canvas API detail endpoint, such as syllabus and announcement pages.
 *
 * Endpoint used: none.
 * Docs context: Canvas resources are still API-backed, but this function only
 * creates a local manual-task seed. It never auto-saves.
 *
 * Reads: current Canvas URL, visible heading/title, `ENV.STUDENT_PLANNER_COURSES`,
 * and Canvas course color preferences.
 * Returns: a normalized manual-capture seed, or null if this page should not
 * show manual capture.
 *
 * @returns {object|null}
 */
export function getManualCaptureSuggestion() {
    const match = window.location.pathname.match(/^\/courses\/(\d+)\/(announcements|discussion_topics|assignments\/syllabus|syllabus)/);
    if (!match) {
        return null;
    }

    const course = getCourseFromEnv(match[1]);
    const title =
        document.querySelector("h1")?.textContent?.trim() ||
        document.querySelector(".page-title")?.textContent?.trim() ||
        document.title?.replace(/\s*:\s*.*$/, "") ||
        "Canvas item";

    return {
        id: `manual_capture_${match[1]}_${Date.now()}`,
        sourceId: window.location.href,
        course: course?.shortName ?? course?.name ?? course?.courseCode ?? "Canvas Course",
        courseId: String(match[1]),
        courseColor: getCourseColor(match[1]),
        description: "Capture a deadline from this Canvas page.",
        dueAt: null,
        platform: "Manual",
        platformType: "manual",
        points: null,
        saved: false,
        time: "No due date",
        timeTone: "normal",
        title,
        type: "assignment",
        url: window.location.href,
        captureOnly: true,
    };
}

function getOpenPlannerItems(items) {
    return items.filter(item =>
        SUPPORTED_TYPES.has(item.plannable_type) &&
        !item.submissions?.submitted &&
        !item.submissions?.graded
    );
}

function getPlannerDueDate(item) {
    const dueAt = item.plannable?.due_at ?? item.plannable_date ?? null;
    if (!dueAt) {
        return null;
    }
    const due = new Date(dueAt);
    return Number.isNaN(due.getTime()) ? null : due;
}

function getCurrentCanvasItemMatch() {
    const pathname = window.location.pathname;
    const assignment = pathname.match(/^\/courses\/(\d+)\/assignments\/(\d+)/);
    if (assignment) {
        return { courseId: assignment[1], itemId: assignment[2], kind: "assignment", type: "assignment" };
    }

    const quiz = pathname.match(/^\/courses\/(\d+)\/quizzes\/(\d+)/);
    if (quiz) {
        return { courseId: quiz[1], itemId: quiz[2], kind: "quiz", type: "quiz" };
    }

    const discussion = pathname.match(/^\/courses\/(\d+)\/discussion_topics\/(\d+)/);
    if (discussion) {
        return { courseId: discussion[1], itemId: discussion[2], kind: "discussion_topic", type: "discussion" };
    }

    return null;
}

function getCanvasItemEndpoint(match) {
    if (match.kind === "quiz") {
        return `/api/v1/courses/${match.courseId}/quizzes/${match.itemId}`;
    }
    if (match.kind === "discussion_topic") {
        return `/api/v1/courses/${match.courseId}/discussion_topics/${match.itemId}`;
    }
    return `/api/v1/courses/${match.courseId}/assignments/${match.itemId}?include[]=submission`;
}

function getCourseFromEnv(courseId) {
    const courses = window.ENV?.STUDENT_PLANNER_COURSES ?? [];
    return courses.find(course => String(course.id) === String(courseId)) ?? null;
}

function stripHtml(html = "") {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function getCourseColor(courseId) {
    return window.ENV?.PREFERENCES?.custom_colors?.[`course_${courseId}`] ?? null;
}

function toClassEvent(event) {
    const startAt = event.start_at ?? null;
    return {
        id: String(event.id ?? event.calendar_event_id ?? startAt ?? ""),
        title: event.title ?? "Class event",
        course: event.context_name ?? event.context_code?.replace("course_", "Course ") ?? "Canvas",
        courseId: event.context_code?.replace("course_", "") ?? null,
        courseColor: event.context_code ? getCourseColor(event.context_code.replace("course_", "")) : null,
        startAt,
        endAt: event.end_at ?? null,
        url: event.html_url ?? null,
    };
}

function getTypeLabel(type) {
    if (type === "discussion_topic" || type === "discussion") {
        return "discussion";
    }
    if (type === "quiz" || type === "assessment") {
        return "quiz";
    }
    return "assignment";
}

function toAssignment(item) {
    const dueAt = item.plannable?.due_at ?? item.plannable_date ?? null;
    const courseId = item.course_id ?? item.context_code?.replace("course_", "") ?? null;
    const type = getTypeLabel(item.plannable_type);
    return {
        id: `${item.plannable_type}_${item.plannable_id}`,
        sourceId: String(item.plannable_id ?? ""),
        course: item.context_name ?? "Unknown Course",
        courseId: courseId ? String(courseId) : null,
        courseColor: courseId ? getCourseColor(courseId) : null,
        dueAt,
        platform: "Canvas",
        platformType: "canvas",
        points: item.plannable?.points_possible ?? null,
        saved: false,
        time: formatDueDate(dueAt),
        timeTone: getTimeTone(dueAt),
        type,
        title: item.plannable?.title ?? "Untitled",
        url: item.html_url ?? null,
        description: stripHtml(item.plannable?.description ?? ""),
    };
}

function toAssignmentFromCanvasItem(item, match, course) {
    const dueAt = item.due_at ?? item.assignment?.due_at ?? item.todo_date ?? null;
    const title = item.title ?? item.name ?? "Untitled";
    const type = match.type;
    const url = item.html_url ?? window.location.href;

    return {
        id: `${match.kind}_${match.itemId}`,
        sourceId: String(match.itemId),
        course: course?.shortName ?? course?.name ?? course?.courseCode ?? "Canvas Course",
        courseId: String(match.courseId),
        courseColor: getCourseColor(match.courseId),
        description: stripHtml(item.description ?? item.message ?? item.body ?? ""),
        dueAt,
        platform: "Canvas",
        platformType: "canvas",
        points: item.points_possible ?? item.assignment?.points_possible ?? null,
        saved: false,
        time: formatDueDate(dueAt),
        timeTone: getTimeTone(dueAt),
        title,
        type,
        url,
    };
}
