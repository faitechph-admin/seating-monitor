// Seating Monitor — offline PWA app logic (vanilla JS, no build step)

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const STATUS = { EMPTY: "empty", OCCUPIED: "occupied", RESERVED: "reserved" };
function statusColors() {
  return { occupied: cssVar("--occupied"), reserved: cssVar("--reserved") };
}

function colLetters(index) {
  // 0-based index -> "A".."Z", "AA".."AZ", "BA".. etc (like spreadsheet columns)
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function seatLabel(rowIndex, colIndex, colOffset) {
  const letter = colLetters(colOffset + colIndex);
  return `${letter}${rowIndex + 1}`;
}

function nextStatus(current) {
  if (current === STATUS.EMPTY) return STATUS.OCCUPIED;
  if (current === STATUS.OCCUPIED) return STATUS.RESERVED;
  return STATUS.EMPTY;
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function nowTimeHHMM() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

const DEFAULT_SECTIONS = [
  { id: "s1", name: "Section A", rows: 7, cols: 5 },
  { id: "s2", name: "Section B", rows: 7, cols: 5 },
  { id: "s3", name: "Section C", rows: 7, cols: 5 },
  { id: "s4", name: "Section D", rows: 7, cols: 5 },
];

function makeInitialSeats(sections) {
  const seats = {};
  sections.forEach((sec) => {
    for (let r = 0; r < sec.rows; r++) {
      for (let c = 0; c < sec.cols; c++) {
        seats[`${sec.id}-${r}-${c}`] = STATUS.EMPTY;
      }
    }
  });
  return seats;
}

// ---------------- App state ----------------
let state = {
  sections: DEFAULT_SECTIONS,
  seats: makeInitialSeats(DEFAULT_SECTIONS),
  eventName: "",
  eventDate: todayISO(),
  eventTime: nowTimeHHMM(),
  records: [],
  saveStatus: "",
  modal: null, // 'config' | 'save' | 'export' | null
};

let saveStatusTimer = null;
let persistTimer = null;

const root = document.getElementById("app");

// ---------------- Persistence ----------------
async function loadState() {
  const saved = await Storage_.get("app-state");
  if (saved) {
    state = {
      ...state,
      ...saved,
      modal: null,
      saveStatus: "",
    };
  }
  render();
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const { modal, saveStatus, ...persisted } = state;
    Storage_.set("app-state", persisted);
  }, 250);
}

function setState(patch) {
  state = { ...state, ...patch };
  render();
  schedulePersist();
}

function flashSaveStatus(text) {
  if (saveStatusTimer) clearTimeout(saveStatusTimer);
  setState({ saveStatus: text });
  saveStatusTimer = setTimeout(() => setState({ saveStatus: "" }), 4000);
}

// ---------------- Derived data ----------------
function computeTotal(sections) {
  return sections.reduce((sum, s) => sum + s.rows * s.cols, 0);
}

function computeCounts(seats, total) {
  let occupied = 0;
  let reserved = 0;
  Object.values(seats).forEach((v) => {
    if (v === STATUS.OCCUPIED) occupied++;
    if (v === STATUS.RESERVED) reserved++;
  });
  return { occupied, reserved, empty: total - occupied - reserved };
}

function computeSectionCounts(sections, seats) {
  const map = {};
  sections.forEach((sec) => {
    let occ = 0;
    let res = 0;
    for (let r = 0; r < sec.rows; r++) {
      for (let c = 0; c < sec.cols; c++) {
        const v = seats[`${sec.id}-${r}-${c}`];
        if (v === STATUS.OCCUPIED) occ++;
        if (v === STATUS.RESERVED) res++;
      }
    }
    const t = sec.rows * sec.cols;
    map[sec.id] = { occupied: occ, reserved: res, empty: t - occ - res, total: t };
  });
  return map;
}

// ---------------- Actions ----------------
function cycleSeat(key) {
  const seats = { ...state.seats, [key]: nextStatus(state.seats[key] ?? STATUS.EMPTY) };
  setState({ seats });
}

function resetAll() {
  setState({ seats: makeInitialSeats(state.sections) });
}

function changeRows(sectionId, delta) {
  const sec = state.sections.find((s) => s.id === sectionId);
  if (!sec) return;
  const newRows = Math.max(1, Math.min(20, sec.rows + delta));
  if (newRows === sec.rows) return;

  const seats = { ...state.seats };
  if (delta > 0) {
    for (let r = sec.rows; r < newRows; r++) {
      for (let c = 0; c < sec.cols; c++) seats[`${sectionId}-${r}-${c}`] = STATUS.EMPTY;
    }
  } else {
    for (let r = newRows; r < sec.rows; r++) {
      for (let c = 0; c < sec.cols; c++) delete seats[`${sectionId}-${r}-${c}`];
    }
  }

  const sections = state.sections.map((s) => (s.id === sectionId ? { ...s, rows: newRows } : s));
  setState({ sections, seats });
}

function changeCols(sectionId, delta) {
  const sec = state.sections.find((s) => s.id === sectionId);
  if (!sec) return;
  const newCols = Math.max(1, Math.min(20, sec.cols + delta));
  if (newCols === sec.cols) return;

  const seats = { ...state.seats };
  if (delta > 0) {
    for (let r = 0; r < sec.rows; r++) {
      for (let c = sec.cols; c < newCols; c++) seats[`${sectionId}-${r}-${c}`] = STATUS.EMPTY;
    }
  } else {
    for (let r = 0; r < sec.rows; r++) {
      for (let c = newCols; c < sec.cols; c++) delete seats[`${sectionId}-${r}-${c}`];
    }
  }

  const sections = state.sections.map((s) => (s.id === sectionId ? { ...s, cols: newCols } : s));
  setState({ sections, seats });
}

function applySections(newSections) {
  const next = {};
  newSections.forEach((sec) => {
    for (let r = 0; r < sec.rows; r++) {
      for (let c = 0; c < sec.cols; c++) {
        const key = `${sec.id}-${r}-${c}`;
        next[key] = state.seats[key] ?? STATUS.EMPTY;
      }
    }
  });
  setState({ sections: newSections, seats: next, modal: null });
}

function saveRecord() {
  const total = computeTotal(state.sections);
  const counts = computeCounts(state.seats, total);
  const sectionCounts = computeSectionCounts(state.sections, state.seats);
  const perSection = state.sections.map((sec) => ({ name: sec.name, ...sectionCounts[sec.id] }));

  const record = {
    id: `r${Date.now()}`,
    eventName: state.eventName.trim() || "Untitled event",
    date: state.eventDate,
    time: state.eventTime,
    total,
    occupied: counts.occupied,
    reserved: counts.reserved,
    empty: counts.empty,
    perSection,
  };

  const records = [...state.records, record];
  setState({ records, modal: null });
  flashSaveStatus(`Saved "${record.eventName}" — ${record.date} ${record.time}`);
}

function deleteRecord(id) {
  const records = state.records.filter((r) => r.id !== id);
  setState({ records });
}

function exportRecords(period) {
  const now = new Date();
  const filtered = state.records.filter((r) => {
    const d = new Date(r.date);
    if (period === "monthly") {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    if (period === "quarterly") {
      const q = Math.floor(now.getMonth() / 3);
      const rq = Math.floor(d.getMonth() / 3);
      return d.getFullYear() === now.getFullYear() && rq === q;
    }
    if (period === "annually") {
      return d.getFullYear() === now.getFullYear();
    }
    return true;
  });

  if (filtered.length === 0) {
    flashSaveStatus(`No saved records found for this ${period.replace("ly", "")} period.`);
    return;
  }

  const maxSections = Math.max(...filtered.map((r) => r.perSection.length));
  const header = ["Event Name", "Date", "Time", "Total Seats", "Occupied", "Reserved", "Empty"];
  for (let i = 0; i < maxSections; i++) {
    header.push(`Section ${i + 1} Name`, `Section ${i + 1} Occupied`, `Section ${i + 1} Reserved`, `Section ${i + 1} Empty`);
  }

  const rows = filtered.map((r) => {
    const row = [r.eventName, r.date, r.time, r.total, r.occupied, r.reserved, r.empty];
    for (let i = 0; i < maxSections; i++) {
      const s = r.perSection[i];
      row.push(s ? s.name : "", s ? s.occupied : "", s ? s.reserved : "", s ? s.empty : "");
    }
    return row;
  });

  const sheetName = period === "monthly" ? "Monthly" : period === "quarterly" ? "Quarterly" : "Annual";
  const stamp = now.toISOString().slice(0, 10);
  MiniXlsx.downloadXlsx([{ name: sheetName, rows: [header, ...rows] }], `seating-${period}-${stamp}.xlsx`);
  setState({ modal: null });
}

// ---------------- Rendering ----------------
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "html") {
      node.innerHTML = value;
    } else if (value !== undefined && value !== null && value !== false) {
      node.setAttribute(key, value);
    }
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  });
  return node;
}

function render() {
  root.innerHTML = "";
  root.appendChild(renderHeader());
  root.appendChild(renderFloorPlan());
  root.appendChild(renderFooter());

  if (state.modal === "config") root.appendChild(renderConfigSheet());
  if (state.modal === "save") root.appendChild(renderSaveSheet());
  if (state.modal === "export") root.appendChild(renderExportSheet());
}

function renderHeader() {
  const total = computeTotal(state.sections);
  const counts = computeCounts(state.seats, total);
  const colors = statusColors();

  const eventFields = el("div", { class: "event-fields" }, [
    el("input", {
      class: "event-name-input",
      value: state.eventName,
      placeholder: "Event name (e.g. Sunday Worship Service)",
      oninput: (e) => { state.eventName = e.target.value; schedulePersist(); },
      onblur: () => render(),
    }),
    el("div", { class: "event-datetime-row" }, [
      el("input", {
        class: "event-date-input",
        type: "date",
        value: state.eventDate,
        onchange: (e) => setState({ eventDate: e.target.value }),
      }),
      el("input", {
        class: "event-time-input",
        type: "time",
        value: state.eventTime,
        onchange: (e) => setState({ eventTime: e.target.value }),
      }),
    ]),
  ]);

  return el("div", { class: "header" }, [
    el("div", { class: "header-row" }, [
      el("div", { class: "header-title" }, "Seating Monitor"),
      el("div", { class: "header-links" }, [
        el("button", { class: "link-btn", onclick: () => setState({ modal: "export" }) }, "Export"),
        el("button", { class: "link-btn", onclick: () => setState({ modal: "config" }) }, "Edit sections"),
      ]),
    ]),
    eventFields,
    el("div", { class: "stats-row" }, [
      renderStat("Occupied", counts.occupied, colors.occupied, true),
      renderStat("Reserved", counts.reserved, colors.reserved, true),
      renderStat("Empty", counts.empty, cssVar("--text-faintest"), false),
      renderStat("Total", total, cssVar("--text-dim"), false),
    ]),
    el("div", { class: "legend-row" }, [
      renderLegend(colors.occupied, "Occupied"),
      renderLegend(colors.reserved, "Reserved for ministers"),
      renderLegend(cssVar("--panel-2"), "Empty", true),
    ]),
    state.saveStatus ? el("div", { class: "save-status" }, state.saveStatus) : null,
  ]);
}

function renderStat(label, value, color, glow) {
  return el("div", { class: "stat" }, [
    el("div", { class: "stat-value", style: { color, textShadow: glow ? `0 0 12px ${color}88` : "none" } }, String(value)),
    el("div", { class: "stat-label" }, label),
  ]);
}

function renderLegend(color, label, border) {
  return el("div", { class: "legend-item" }, [
    el("span", { class: "legend-swatch", style: { background: color, border: border ? `1px solid ${cssVar("--border-2")}` : "none", boxShadow: border ? "none" : `0 0 4px 1px ${color}77` } }),
    el("span", { class: "legend-label" }, label),
  ]);
}

function renderFloorPlan() {
  const sectionCounts = computeSectionCounts(state.sections, state.seats);
  const colors = statusColors();

  let colOffset = 0;
  const sectionBlocks = state.sections.map((sec) => {
    const sc = sectionCounts[sec.id];
    const sectionColOffset = colOffset;
    colOffset += sec.cols;
    const seatRows = [];
    for (let r = 0; r < sec.rows; r++) {
      const cells = [];
      for (let c = 0; c < sec.cols; c++) {
        const key = `${sec.id}-${r}-${c}`;
        const status = state.seats[key] ?? STATUS.EMPTY;
        const label = seatLabel(r, c, sectionColOffset);
        const filled = status !== STATUS.EMPTY;
        const color = colors[status];
        cells.push(
          el("button", {
            class: `seat${filled ? " filled" : ""}`,
            "aria-label": `${sec.name} seat ${label}, ${status}`,
            style: filled ? { background: color, boxShadow: `0 0 8px 2px ${color}88` } : {},
            onclick: () => cycleSeat(key),
          }, label)
        );
      }
      seatRows.push(el("div", { class: "seat-row" }, cells));
    }

    return el("div", { class: "section-block" }, [
      el("div", { class: "section-name" }, sec.name),
      el("div", { class: "section-count" }, `${sc.occupied + sc.reserved}/${sec.rows * sec.cols}`),
      el("div", {}, seatRows),
      el("div", { class: "row-controls" }, [
        el("div", { class: "ctrl-row" }, [
          el("button", { class: "ctrl-btn", "aria-label": `Remove a row from ${sec.name}`, onclick: () => changeRows(sec.id, -1) }, "−"),
          el("span", { class: "ctrl-label" }, `${sec.rows} rows`),
          el("button", { class: "ctrl-btn", "aria-label": `Add a row to ${sec.name}`, onclick: () => changeRows(sec.id, 1) }, "+"),
        ]),
        el("div", { class: "ctrl-row" }, [
          el("button", { class: "ctrl-btn", "aria-label": `Remove a column from ${sec.name}`, onclick: () => changeCols(sec.id, -1) }, "−"),
          el("span", { class: "ctrl-label" }, `${sec.cols} cols`),
          el("button", { class: "ctrl-btn", "aria-label": `Add a column to ${sec.name}`, disabled: sec.cols >= 20, onclick: () => changeCols(sec.id, 1) }, "+"),
        ]),
      ]),
    ]);
  });

  return el("div", { class: "floor-wrap" }, [
    el("div", { class: "floor-inner" }, [
      el("svg", { viewBox: "0 0 600 40", style: { width: "100%", maxWidth: "560px", height: "40px" }, preserveAspectRatio: "none" },
        (() => {
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", "M 0 32 Q 300 0 600 32");
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", cssVar("--accent"));
          path.setAttribute("stroke-width", "2.5");
          path.setAttribute("stroke-linecap", "round");
          return path;
        })()
      ),
      el("div", { class: "stage-label" }, "Stage"),
      el("div", { class: "sections-row" }, sectionBlocks),
    ]),
  ]);
}

function renderFooter() {
  return el("div", { class: "footer" }, [
    el("button", { class: "btn btn-secondary", onclick: resetAll }, "Clear all seats"),
    el("button", { class: "btn btn-primary", onclick: () => setState({ modal: "save" }) }, "Save event record"),
  ]);
}

// ---------------- Modals ----------------
function renderConfigSheet() {
  // local draft copy, mutated directly then applied on Save
  const draft = state.sections.map((s) => ({ ...s }));

  function rerenderModal() {
    const existing = document.querySelector(".sheet-overlay");
    if (existing) existing.replaceWith(build());
  }

  function build() {
    const cards = draft.map((sec, i) =>
      el("div", { class: "section-edit-card" }, [
        el("div", { class: "section-edit-head" }, [
          el("input", {
            class: "section-edit-name",
            value: sec.name,
            placeholder: `Section ${i + 1}`,
            oninput: (e) => { draft[i].name = e.target.value; },
          }),
          draft.length > 1
            ? el("button", { class: "remove-link", onclick: () => { draft.splice(i, 1); rerenderModal(); } }, "Remove")
            : null,
        ]),
        el("div", { class: "mini-fields" }, [
          renderMiniField("Rows", sec.rows, 1, 20, (v) => { draft[i].rows = v; rerenderModal(); }),
          renderMiniField("Columns", sec.cols, 1, 20, (v) => { draft[i].cols = v; rerenderModal(); }),
        ]),
      ])
    );

    return el("div", { class: "sheet-overlay", onclick: (e) => { if (e.target.classList.contains("sheet-overlay")) setState({ modal: null }); } }, [
      el("div", { class: "sheet" }, [
        el("div", { class: "sheet-handle" }),
        el("div", { class: "sheet-title" }, "Edit sections"),
        el("div", {}, cards),
        el("button", {
          class: "add-section-btn",
          onclick: () => { draft.push({ id: `s${Date.now()}`, name: `Section ${draft.length + 1}`, rows: 7, cols: 5 }); rerenderModal(); },
        }, "+ Add section"),
        el("div", { class: "hint-text" }, "Existing seat states are kept where positions still exist after your changes."),
        el("div", { class: "sheet-actions" }, [
          el("button", { class: "btn btn-secondary", onclick: () => setState({ modal: null }) }, "Cancel"),
          el("button", { class: "btn btn-primary", onclick: () => applySections(draft) }, "Save"),
        ]),
      ]),
    ]);
  }

  return build();
}

function renderMiniField(label, value, min, max, onChange) {
  let current = value;
  const valueSpan = el("span", { class: "mini-value" }, String(current));
  const dec = el("button", { class: "mini-btn", onclick: () => { current = Math.max(min, current - 1); valueSpan.textContent = String(current); onChange(current); } }, "−");
  const inc = el("button", { class: "mini-btn", onclick: () => { current = Math.min(max, current + 1); valueSpan.textContent = String(current); onChange(current); } }, "+");
  return el("div", { class: "mini-field" }, [
    el("div", { class: "mini-field-label" }, label),
    el("div", { class: "mini-field-row" }, [dec, valueSpan, inc]),
  ]);
}

function renderSaveSheet() {
  const total = computeTotal(state.sections);
  const counts = computeCounts(state.seats, total);
  const eventName = state.eventName.trim() || "Untitled event";
  const colors = statusColors();
  const faint = cssVar("--text-faint");

  return el("div", { class: "sheet-overlay", onclick: (e) => { if (e.target.classList.contains("sheet-overlay")) setState({ modal: null }); } }, [
    el("div", { class: "sheet" }, [
      el("div", { class: "sheet-handle" }),
      el("div", { class: "sheet-title" }, "Save event record"),
      el("div", { class: "sheet-subtitle" }, "Captures the current seat counts under the event name, date, and time set in the header."),

      el("div", { class: "summary-box" }, [
        el("div", { class: "summary-title" }, `${eventName} — ${state.eventDate} ${state.eventTime}`),
        el("div", { class: "summary-values" }, [
          el("span", { style: { color: colors.occupied } }, `${counts.occupied} occupied`),
          el("span", { style: { color: colors.reserved } }, `${counts.reserved} reserved`),
          el("span", { style: { color: faint } }, `${counts.empty} empty`),
          el("span", { style: { color: faint } }, `/ ${total} total`),
        ]),
      ]),

      el("div", { class: "sheet-actions" }, [
        el("button", { class: "btn btn-secondary", onclick: () => setState({ modal: null }) }, "Cancel"),
        el("button", { class: "btn btn-primary", onclick: () => saveRecord() }, "Save record"),
      ]),
    ]),
  ]);
}

function renderExportSheet() {
  const count = state.records.length;

  const recordRows = state.records
    .slice()
    .sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1))
    .map((r) =>
      el("div", { class: "record-row" }, [
        el("div", {}, [
          el("div", { class: "record-main" }, r.eventName),
          el("div", { class: "record-sub" }, `${r.date} ${r.time}`),
        ]),
        el("div", { style: { display: "flex", alignItems: "center" } }, [
          el("div", { class: "record-counts" }, `${r.occupied + r.reserved}/${r.total} filled`),
          el("button", { class: "delete-record-btn", onclick: () => { deleteRecord(r.id); setState({ modal: "export" }); } }, "Delete"),
        ]),
      ])
    );

  return el("div", { class: "sheet-overlay", onclick: (e) => { if (e.target.classList.contains("sheet-overlay")) setState({ modal: null }); } }, [
    el("div", { class: "sheet" }, [
      el("div", { class: "sheet-handle" }),
      el("div", { class: "sheet-title" }, "Export to Excel"),
      el("div", { class: "sheet-subtitle" },
        count === 0
          ? 'No event records saved yet. Use "Save event record" first, then export.'
          : `${count} saved record${count === 1 ? "" : "s"} on this device. Choose a period to export.`
      ),

      el("button", { class: "export-option", onclick: () => exportRecords("monthly") }, [
        el("div", { class: "export-option-title" }, "Monthly"),
        el("span", { class: "export-option-sub" }, "Records from this calendar month"),
      ]),
      el("button", { class: "export-option", onclick: () => exportRecords("quarterly") }, [
        el("div", { class: "export-option-title" }, "Quarterly"),
        el("span", { class: "export-option-sub" }, "Records from this calendar quarter"),
      ]),
      el("button", { class: "export-option", onclick: () => exportRecords("annually") }, [
        el("div", { class: "export-option-title" }, "Annually"),
        el("span", { class: "export-option-sub" }, "Records from this calendar year"),
      ]),

      count > 0 ? el("div", { class: "records-list" }, recordRows) : null,

      el("button", { class: "btn btn-secondary", style: { width: "100%" }, onclick: () => setState({ modal: null }) }, "Close"),
    ]),
  ]);
}

// ---------------- Online/offline badge ----------------
function updateOfflineBadge() {
  const badge = document.getElementById("offline-badge");
  if (!navigator.onLine) badge.classList.add("show");
  else badge.classList.remove("show");
}
window.addEventListener("online", updateOfflineBadge);
window.addEventListener("offline", updateOfflineBadge);
updateOfflineBadge();

// ---------------- Service worker registration ----------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// ---------------- Boot ----------------
loadState();
