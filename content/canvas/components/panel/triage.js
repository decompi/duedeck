const PLATFORM_COLORS = {
    canvas: "#e33f32",
    pearson: "#087f9a",
};

const PLATFORM_INITIALS = {
    canvas: "C",
    pearson: "P",
};

const STATUS_LABELS = {
    submitted: "Awaiting grade",
    dropped: "Professor dropped it",
    dismissed: "Dismissed",
};

function createTinyBadge(assignment) {
    const badge = document.createElement("span");
    badge.className = "duedeck-triage-badge";
    badge.style.background = PLATFORM_COLORS[assignment.platformType] ?? "#6d28d9";
    badge.textContent = PLATFORM_INITIALS[assignment.platformType] ?? "?";
    return badge;
}

function createTriageItem(assignment, onTriage) {
    const item = document.createElement("div");
    item.className = "duedeck-triage-item";

    const header = document.createElement("div");
    header.className = "duedeck-triage-item__header";

    const info = document.createElement("div");
    info.className = "duedeck-triage-item__info";

    const title = document.createElement("span");
    title.className = "duedeck-triage-item__title";
    title.textContent = assignment.title;

    const course = document.createElement("span");
    course.className = "duedeck-triage-item__course";
    course.textContent = assignment.course;

    info.append(title, course);
    header.append(createTinyBadge(assignment), info);

    const time = document.createElement("span");
    time.className = "duedeck-triage-item__time";
    time.textContent = assignment.time;

    const actions = document.createElement("div");
    actions.className = "duedeck-triage-item__actions";

    const btnSubmitted = document.createElement("button");
    btnSubmitted.type = "button";
    btnSubmitted.className = "duedeck-triage-btn duedeck-triage-btn--submitted";
    btnSubmitted.textContent = "I submitted this";
    btnSubmitted.addEventListener("click", () => onTriage(assignment.id, "submitted"));

    const btnDropped = document.createElement("button");
    btnDropped.type = "button";
    btnDropped.className = "duedeck-triage-btn duedeck-triage-btn--neutral";
    btnDropped.textContent = "Dropped";
    btnDropped.addEventListener("click", () => onTriage(assignment.id, "dropped"));

    const btnDismiss = document.createElement("button");
    btnDismiss.type = "button";
    btnDismiss.className = "duedeck-triage-btn duedeck-triage-btn--neutral";
    btnDismiss.textContent = "Dismiss";
    btnDismiss.addEventListener("click", () => onTriage(assignment.id, "dismissed"));

    actions.append(btnSubmitted, btnDropped, btnDismiss);
    item.append(header, time, actions);
    return item;
}

function createResolvedItem(assignment, status, onUndo) {
    const item = document.createElement("div");
    item.className = `duedeck-resolved-item duedeck-resolved-item--${status}`;

    const badge = createTinyBadge(assignment);

    const info = document.createElement("div");
    info.className = "duedeck-resolved-item__info";

    const title = document.createElement("span");
    title.className = "duedeck-resolved-item__title";
    title.textContent = assignment.title;

    const statusEl = document.createElement("span");
    statusEl.className = "duedeck-resolved-item__status";
    statusEl.textContent = STATUS_LABELS[status] ?? status;

    info.append(title, statusEl);

    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "duedeck-resolved-item__undo";
    undoBtn.textContent = "Undo";
    undoBtn.addEventListener("click", () => onUndo(assignment.id));

    item.append(badge, info, undoBtn);
    return item;
}

function createResolvedSection(resolved, triageState, onUndo, startExpanded = false) {
    const section = document.createElement("div");
    section.className = "duedeck-resolved";

    let isExpanded = startExpanded;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "duedeck-resolved__toggle";

    const chevron = document.createElement("span");
    chevron.className = "duedeck-resolved__chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▸";

    const label = document.createElement("span");
    label.textContent = `Resolved (${resolved.length})`;

    toggle.append(chevron, label);

    const list = document.createElement("div");
    list.className = "duedeck-resolved__list";
    list.hidden = !isExpanded;
    chevron.textContent = isExpanded ? "▾" : "▸";

    resolved.forEach(a => {
        list.append(createResolvedItem(a, triageState[a.id], onUndo));
    });

    toggle.addEventListener("click", () => {
        isExpanded = !isExpanded;
        list.hidden = !isExpanded;
        chevron.textContent = isExpanded ? "▾" : "▸";
    });

    section.append(toggle, list);
    return section;
}

export function renderOverdueDrawer(root, assignments, triageState, onTriage, onUndo, expandResolved = false) {
    const unresolved = assignments.filter(a => !triageState[a.id]);
    const resolved = assignments.filter(a => !!triageState[a.id]);

    root.replaceChildren();

    if (unresolved.length === 0) {
        const allClear = document.createElement("div");
        allClear.className = "duedeck-triage-clear";

        const icon = document.createElement("div");
        icon.className = "duedeck-triage-clear__icon";
        icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#22c55e" stroke-width="2"/><path d="M9 12l2 2 4-4" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

        const msg = document.createElement("p");
        msg.className = "duedeck-triage-clear__text";
        msg.textContent = "All clear!";

        const sub = document.createElement("p");
        sub.className = "duedeck-triage-clear__sub";
        sub.textContent = resolved.length > 0 ? "Everything triaged" : "No overdue items";

        allClear.append(icon, msg, sub);
        root.append(allClear);
    } else {
        unresolved.forEach(a => {
            root.append(createTriageItem(a, onTriage));
        });
    }

    if (resolved.length > 0) {
        root.append(createResolvedSection(resolved, triageState, onUndo, expandResolved));
    }
}
