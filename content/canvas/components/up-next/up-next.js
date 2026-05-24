const PLATFORM_LOGOS = {
    canvas: { fallback: "C", path: "assets/platforms/canvas.svg" },
    pearson: { fallback: "P", path: "assets/platforms/pearson.svg" },
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


function createUpNextItem(assignment) {
    const item = document.createElement("button");
    item.className = "duedeck-assignment";
    item.type = "button";

    if (assignment.url) {
        item.addEventListener("click", () => window.open(assignment.url, "_blank", "noopener"));
    }

    const time = document.createElement("span");
    time.className = `duedeck-assignment__time duedeck-assignment__time--${assignment.timeTone}`;
    time.textContent = assignment.time;

    const content = document.createElement("span");
    content.className = "duedeck-assignment__content";

    const title = document.createElement("strong");
    title.textContent = assignment.title;

    const meta = document.createElement("span");
    meta.className = "duedeck-assignment__meta";
    meta.textContent = `${assignment.course} • ${assignment.platform}`;

    content.append(title, meta);
    item.append(time, content, createPlatformBadge(assignment));
    return item;
}


function createDrawerItem(assignment, type) {
    const item = document.createElement("button");
    item.className = "duedeck-drawer__item";
    item.type = "button";

    if (assignment.url) {
        item.addEventListener("click", () => window.open(assignment.url, "_blank", "noopener"));
    }

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

export function renderDrawerItems(root, assignments, type) {
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
    root.replaceChildren(...assignments.map(a => createDrawerItem(a, type)));
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

export function renderUpNextAssignments(root, assignments) {
    if (!root) {
        return;
    }
    root.removeAttribute("aria-busy");

    if (!assignments?.length) {
        root.replaceChildren(createStatusMessage("All caught up!"));
        return;
    }

    root.replaceChildren(...assignments.map(createUpNextItem));
}

export function renderUpNextError(root) {
    if (!root) {
        return;
    }
    root.removeAttribute("aria-busy");
    root.replaceChildren(createStatusMessage("Couldn't load assignments."));
}
