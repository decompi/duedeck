const SAMPLE_ASSIGNMENTS = [
    {
        course: "Biology 101",
        platform: "Canvas",
        platformType: "canvas",
        time: "11:59 PM",
        timeTone: "urgent",
        title: "Lab Report 3",
    },
    {
        course: "Calculus I",
        platform: "Pearson MyLab",
        platformType: "pearson",
        time: "Tomorrow",
        timeTone: "normal",
        title: "MyLab Homework 5",
    },
    {
        course: "US History",
        platform: "Canvas",
        platformType: "canvas",
        time: "10:00 PM",
        timeTone: "normal",
        title: "Discussion Post",
    },
];

function createPlatformBadge(assignment) {
    const badge = document.createElement("span");
    badge.className = `duedeck-assignment__badge duedeck-assignment__badge--${assignment.platformType}`;
    badge.setAttribute("aria-label", assignment.platform);

    if (assignment.platformType === "pearson") {
        badge.textContent = "P";
    }

    return badge;
}

function createUpNextItem(assignment) {
    const item = document.createElement("button");
    item.className = "duedeck-assignment";
    item.type = "button";

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

export function renderUpNextAssignments(root, assignments = SAMPLE_ASSIGNMENTS) {
    if (!root) return;

    root.replaceChildren(...assignments.map(createUpNextItem));
}
