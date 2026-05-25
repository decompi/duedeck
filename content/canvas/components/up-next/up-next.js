const PLATFORM_LOGOS = {
    canvas: { fallback: "C", path: "assets/platforms/canvas.svg" },
};


function createPlatformBadge(assignment) {
    const badge = document.createElement("span");
    badge.className = `duedeck-assignment__badge duedeck-assignment__badge--${assignment.platformType}`;
    badge.setAttribute("aria-label", assignment.platform);

    const logo = PLATFORM_LOGOS[assignment.platformType];
    if (!logo) {
        return badge;
    }

    const fallback = document.createElement("span");
    fallback.className = "duedeck-assignment__badge-fallback";
    fallback.textContent = logo.fallback;

    const image = document.createElement("img");
    image.alt = "";
    image.addEventListener("load", () => badge.classList.add("duedeck-assignment__badge--has-logo"));
    image.addEventListener("error", () => image.remove());
    image.src = chrome.runtime.getURL(logo.path);

    badge.append(image, fallback);
    return badge;
}


function createUpNextItem(assignment, callbacks = {}) {
    const item = document.createElement("button");
    item.className = "duedeck-assignment";
    item.type = "button";
    item.dataset.type = assignment.type ?? "assignment";
    item.dataset.saved = assignment.saved ? "true" : "false";
    if (assignment.courseColor) {
        item.dataset.courseColor = "true";
        item.style.setProperty("--course-color", assignment.courseColor);
    }

    item.addEventListener("click", () => callbacks.onSelect?.(assignment));

    const time = document.createElement("span");
    time.className = `duedeck-assignment__time duedeck-assignment__time--${assignment.timeTone}`;
    time.textContent = assignment.time;

    const content = document.createElement("span");
    content.className = "duedeck-assignment__content";

    const title = document.createElement("strong");
    title.textContent = assignment.title;

    const meta = document.createElement("span");
    meta.className = "duedeck-assignment__meta";
    const type = assignment.type ? `${assignment.type[0].toUpperCase()}${assignment.type.slice(1)}` : "Assignment";
    const points = Number.isFinite(Number(assignment.points)) ? ` • ${assignment.points} pts` : "";
    meta.textContent = `${assignment.course} • ${type}${points}`;

    content.append(title, meta);
    const tail = document.createElement("span");
    tail.className = "duedeck-assignment__tail";
    if (assignment.saved && callbacks.onRemove) {
        const remove = document.createElement("span");
        remove.className = "duedeck-row-action";
        remove.setAttribute("role", "button");
        remove.setAttribute("tabindex", "0");
        remove.textContent = "Unsave";
        const removeAssignment = (event) => {
            event.preventDefault();
            event.stopPropagation();
            callbacks.onRemove(assignment.id);
        };
        remove.addEventListener("click", removeAssignment);
        remove.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                removeAssignment(event);
            }
        });
        tail.append(remove);
    }
    tail.append(createPlatformBadge(assignment));

    item.append(time, content, tail);
    return item;
}


function createDrawerItem(assignment, type, callbacks = {}) {
    const item = document.createElement("button");
    item.className = "duedeck-drawer__item";
    item.type = "button";

    item.addEventListener("click", () => callbacks.onSelect?.(assignment));

    const badge = createPlatformBadge(assignment);
    badge.style.cssText = "width:22px;height:22px;flex-shrink:0";

    const info = document.createElement("div");
    info.className = "duedeck-drawer__item-info";

    const title = document.createElement("span");
    title.className = "duedeck-drawer__item-title";
    title.textContent = assignment.title;

    const course = document.createElement("span");
    course.className = "duedeck-drawer__item-course";
    course.textContent = assignment.course;

    const time = document.createElement("span");
    time.className = `duedeck-drawer__item-time duedeck-drawer__item-time--${type}`;
    time.textContent = assignment.time;

    info.append(title, course, time);
    item.append(badge, info);
    return item;
}

export function renderDrawerItems(root, assignments, type, callbacks = {}) {
    if (!root) {
        return;
    }
    if (!assignments?.length) {
        const msg = document.createElement("p");
        msg.className = "duedeck-drawer__empty";
        msg.textContent = "All clear!";
        root.replaceChildren(msg);
        return;
    }
    root.replaceChildren(...assignments.map(a => createDrawerItem(a, type, callbacks)));
}

function createSkeletonItem() {
    const item = document.createElement("div");
    item.className = "duedeck-assignment duedeck-assignment--skeleton";
    item.setAttribute("aria-hidden", "true");

    const time = document.createElement("span");
    time.className = "duedeck-skeleton__block duedeck-skeleton__block--time";

    const content = document.createElement("span");
    content.className = "duedeck-assignment__content";

    const title = document.createElement("span");
    title.className = "duedeck-skeleton__block duedeck-skeleton__block--title";

    const meta = document.createElement("span");
    meta.className = "duedeck-skeleton__block duedeck-skeleton__block--meta";

    content.append(title, meta);

    const badge = document.createElement("span");
    badge.className = "duedeck-skeleton__block duedeck-skeleton__block--badge";

    item.append(time, content, badge);
    return item;
}


function createStatusMessage(text) {
    const p = document.createElement("p");
    p.className = "duedeck-up-next__status";
    p.textContent = text;
    return p;
}


export function renderUpNextLoading(root) {
    if (!root) {
        return;
    }
    root.setAttribute("aria-busy", "true");
    root.replaceChildren(...Array.from({ length: 3 }, createSkeletonItem));
}

export function renderUpNextAssignments(root, assignments, callbacks = {}) {
    if (!root) {
        return;
    }
    root.removeAttribute("aria-busy");

    if (!assignments?.length) {
        root.replaceChildren(createStatusMessage("All caught up!"));
        return;
    }

    root.replaceChildren(...assignments.map(assignment => createUpNextItem(assignment, callbacks)));
}

export function renderUpNextError(root) {
    if (!root) {
        return;
    }
    root.removeAttribute("aria-busy");
    root.replaceChildren(createStatusMessage("Couldn't load assignments."));
}

function getDayKey(assignment) {
    const due = assignment.dueAt ? new Date(assignment.dueAt) : null;
    if (!due || Number.isNaN(due.getTime())) {
        return "No due date";
    }
    return due.toDateString();
}

function getDayLabel(assignment) {
    const due = assignment.dueAt ? new Date(assignment.dueAt) : null;
    if (!due || Number.isNaN(due.getTime())) {
        return "No due date";
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueStart = new Date(due);
    dueStart.setHours(0, 0, 0, 0);
    const diffDays = Math.round((dueStart - today) / 86_400_000);
    const date = due.toLocaleDateString([], { month: "short", day: "numeric" });

    if (diffDays < 0) {
        return `Overdue • ${date}`;
    }
    if (diffDays === 0) {
        return `Today • ${date}`;
    }
    if (diffDays === 1) {
        return `Tomorrow • ${date}`;
    }
    return `${due.toLocaleDateString([], { weekday: "long" })} • ${date}`;
}

function createWeekItem(assignment, callbacks = {}) {
    const item = document.createElement("button");
    item.className = "duedeck-week-item";
    item.type = "button";
    item.dataset.type = assignment.type ?? "assignment";
    item.dataset.saved = assignment.saved ? "true" : "false";
    if (assignment.courseColor) {
        item.dataset.courseColor = "true";
        item.style.setProperty("--course-color", assignment.courseColor);
    }

    item.addEventListener("click", () => callbacks.onSelect?.(assignment));

    const type = document.createElement("span");
    type.className = "duedeck-week-item__type";
    type.style.background = assignment.courseColor ? `${assignment.courseColor}20` : "";
    type.style.color = assignment.courseColor ?? "";
    type.textContent = (assignment.type ?? "assignment").slice(0, 1).toUpperCase();

    const info = document.createElement("span");
    const title = document.createElement("span");
    title.className = "duedeck-week-item__title";
    title.textContent = assignment.title;

    const meta = document.createElement("span");
    meta.className = "duedeck-week-item__meta";
    meta.textContent = `${assignment.course} • ${assignment.platform}`;

    const time = document.createElement("span");
    time.className = `duedeck-week-item__time duedeck-week-item__time--${assignment.timeTone}`;
    time.textContent = assignment.time;

    info.append(title, meta);
    const tail = document.createElement("span");
    tail.className = "duedeck-assignment__tail";
    if (assignment.saved && callbacks.onRemove) {
        const remove = document.createElement("span");
        remove.className = "duedeck-row-action";
        remove.setAttribute("role", "button");
        remove.setAttribute("tabindex", "0");
        remove.textContent = "Unsave";
        remove.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            callbacks.onRemove(assignment.id);
        });
        tail.append(remove);
    }
    tail.append(time);

    item.append(type, info, tail);
    return item;
}

export function renderWeekAssignments(root, assignments, filter = "all", callbacks = {}) {
    if (!root) {
        return;
    }

    const filtered = filter === "all"
        ? assignments
        : assignments.filter(assignment => assignment.type === filter);

    if (!filtered.length) {
        root.replaceChildren(createStatusMessage("Nothing due in this filter."));
        return;
    }

    const groups = new Map();
    filtered.forEach(assignment => {
        const key = getDayKey(assignment);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(assignment);
    });

    const sections = Array.from(groups.values()).map(groupAssignments => {
        const section = document.createElement("section");
        section.className = "duedeck-day-group";

        const label = document.createElement("p");
        label.className = "duedeck-day-group__label";
        label.textContent = getDayLabel(groupAssignments[0]);

        section.append(label, ...groupAssignments.map(assignment => createWeekItem(assignment, callbacks)));
        return section;
    });

    root.replaceChildren(...sections);
}
