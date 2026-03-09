// AgentDeck Web Simulator
// ──────────────────────────────────────────────────────────────
// Simulates MX Creative Console's 3x3 LCD grid + dial + 4 buttons.
// Every view renders exactly 9 buttons — maps 1:1 to Logi SDK's
// PluginDynamicFolder with BitmapBuilder tiles.
//
// Views (= folder pages on real hardware):
//   dashboard   — agent tiles + NEW / SESSIONS / MENU
//   new-agent   — 8 agent type tiles + BACK
//   approval    — context tiles + APPROVE / REJECT / BACK
//   menu        — action tiles + PREV / page / NEXT|BACK
//   status-list — all agents as tiles + BACK
//
// Dial rotation → PluginDynamicAdjustment.ApplyAdjustment()
// Button taps   → PluginDynamicFolder.RunCommand(buttonIndex)
// WebSocket     → Extension :9999 (same protocol for plugin + sim)

const WS_URL = "ws://localhost:9999";
const RECONNECT_DELAY = 3000;
const SLOTS_PER_PAGE = 6;

// Agent types available for launching
const AGENTS = [
  { id: "claude",   name: "Claude",   desc: "Anthropic",   color: "#d97706", icon: "icons/claude.png" },
  { id: "gemini",   name: "Gemini",   desc: "Google",      color: "#1a73e8", icon: "icons/gemini.png" },
  { id: "codex",    name: "Codex",    desc: "OpenAI",      color: "#10a37f", icon: "icons/codex.svg" },
  { id: "aider",    name: "Aider",    desc: "Open source", color: "#e67e22", icon: "icons/aider.png" },
  { id: "opencode", name: "OpenCode", desc: "Open source", color: "#6a4dba", icon: "icons/opencode.png" },
];

// Menu actions — each maps to a PluginDynamicCommand in the Logi SDK
const MENU_ACTIONS = [
  // Row 1: "All" actions grouped together
  { id: "confirm-all",    label: "Confirm All",    icon: "⏎", desc: "Confirm all waiting agents", color: "#1e7832" },
  { id: "pause-all",      label: "Pause All",      icon: "\u23F8", desc: "Send Ctrl+C to all",        color: "#886622" },
  { id: "kill-all",       label: "End All",        icon: "\u2716", desc: "Terminate all sessions",     color: "#b42828" },
  // Row 2: Sort & navigate
  { id: "show-waiting",   label: "Waiting First",  icon: "\u25D0", desc: "Sort: waiting on top",       color: "#b4a01e" },
  { id: "show-errors",    label: "Errors First",   icon: "\u2715", desc: "Sort: errors on top",        color: "#b42828" },
  { id: "focus-next",     label: "Next Waiting",   icon: "\u25B6", desc: "Focus next waiting agent",  color: "#d4b030" },
  // Page 2: Utilities
  { id: "kill-idle",      label: "End Idle",        icon: "\u25CB", desc: "Terminate idle sessions",   color: "#5a5a5a" },
  { id: "refresh-status", label: "Refresh",        icon: "\u21BB", desc: "Force re-check all status", color: "#4488bb" },
];

// ── State ──────────────────────────────────────────────────────

let ws = null;

let state = {
  phase: "disconnected",
  agents: [],
  selectedAgentId: null,
};

// View = current folder page
let view = "dashboard";

// Pagination
let page = 0;          // dashboard agent page
let menuPage = 0;      // menu action page
let statusPage = 0;    // status-list page

const MENU_PER_PAGE = 6;
const STATUS_PER_PAGE = 6; // 6 agent tiles (top 2 rows) + bottom row controls

// ── WebSocket ──────────────────────────────────────────────────

function connect() {
  log("Connecting to VS Code Extension...", "connect");
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    log(`Connection failed: ${e.message}`, "error");
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    state.phase = "connected";
    updateConnection(true);
    log("Connected to Extension", "connect");
  };

  ws.onclose = () => {
    state.phase = "disconnected";
    updateConnection(false);
    log("Disconnected from Extension", "error");
    scheduleReconnect();
  };

  ws.onerror = () => log("WebSocket error", "error");

  ws.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (e) {
      log(`Parse error: ${e.message}`, "error");
    }
  };
}

function scheduleReconnect() {
  setTimeout(connect, RECONNECT_DELAY);
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    log(`Sent: ${msg.type} ${msg.action || msg.agent || ""}`, "cmd");
  }
}

function handleMessage(msg) {
  switch (msg.type) {
    case "state": {
      const prevSelected = state.selectedAgentId;
      state.agents = msg.agents || [];
      state.selectedAgentId = prevSelected;

      // Clamp pages
      clampPage();

      // If in approval view and agent no longer waiting, go back
      // BUT: during grace period after confirm/cancel, stay on approval
      // so the agent can transition through working→waiting for next question
      if (view === "approval") {
        const a = getSelectedAgent();
        if (!a) {
          // Agent gone entirely — go back
          view = "dashboard";
        } else if (a.status !== "waiting" && Date.now() > approvalGraceUntil) {
          // Agent not waiting and grace period expired — go back
          view = "dashboard";
        }
        // If agent returns to waiting during grace, the grace just expires naturally
      }

      log(`State: ${state.agents.length} agents`, "state");
      renderAll();
      break;
    }

    case "event":
      log(`Event: ${msg.agentId} -> ${msg.event}`, "event");
      if (msg.event === "needs_approval") {
        // Don't auto-focus terminal — just re-render so tile pulses yellow
        renderAll();
      }
      break;

    case "focus":
      log(`Focus: ${msg.agentId} -> ${msg.view}`, "event");
      state.selectedAgentId = msg.agentId;
      renderAll();
      break;
  }
}

// ── Pagination helpers ──────────────────────────────────────────

function dashboardTotalPages() {
  return Math.max(1, Math.ceil(state.agents.length / SLOTS_PER_PAGE));
}

function clampPage() {
  const max = Math.max(0, dashboardTotalPages() - 1);
  if (page > max) page = max;
}

function paginateDashboard(diff) {
  const max = dashboardTotalPages() - 1;
  page = Math.max(0, Math.min(max, page + diff));
  renderAll();
}

function paginateMenu(diff) {
  const total = Math.max(1, Math.ceil(MENU_ACTIONS.length / MENU_PER_PAGE));
  menuPage = Math.max(0, Math.min(total - 1, menuPage + diff));
  renderAll();
}

function paginateStatus(diff) {
  const total = Math.max(1, Math.ceil(state.agents.length / STATUS_PER_PAGE));
  statusPage = Math.max(0, Math.min(total - 1, statusPage + diff));
  renderAll();
}

// ── Menu Actions ─────────────────────────────────────────────────

function executeMenuAction(actionId) {
  switch (actionId) {
    case "kill-all":
      state.agents.forEach(a => send({ type: "command", agentId: a.id, action: "kill" }));
      log("Ending all sessions");
      break;
    case "confirm-all":
      state.agents.filter(a => a.status === "waiting")
        .forEach(a => send({ type: "command", agentId: a.id, action: "approve" }));
      log("Confirmed all waiting agents");
      break;
    case "show-waiting":
      state.agents.sort((a, b) => (a.status === "waiting" ? -1 : 1) - (b.status === "waiting" ? -1 : 1));
      state.agents.forEach((a, i) => a.slot = i);
      page = 0;
      log("Sorted: waiting agents first");
      break;
    case "show-errors":
      state.agents.sort((a, b) => (a.status === "error" ? -1 : 1) - (b.status === "error" ? -1 : 1));
      state.agents.forEach((a, i) => a.slot = i);
      page = 0;
      log("Sorted: error agents first");
      break;
    case "pause-all":
      state.agents.forEach(a => send({ type: "command", agentId: a.id, action: "pause" }));
      log("Pausing all agents");
      break;
    case "kill-idle":
      state.agents.filter(a => a.status === "idle")
        .forEach(a => send({ type: "command", agentId: a.id, action: "kill" }));
      log("Ending idle sessions");
      break;
    case "focus-next": {
      const waiting = state.agents.filter(a => a.status === "waiting");
      if (waiting.length > 0) {
        const next = waiting[0];
        state.selectedAgentId = next.id;
        send({ type: "open_terminal", agentId: next.id });
        log(`Focused: ${next.name} (waiting)`);
        view = "approval";
      } else {
        log("No waiting agents");
      }
      renderAll();
      return; // Don't go to dashboard — either approval or stay
    }
    case "refresh-status":
      log("Status refresh requested");
      break;
    default:
      log(`Unknown action: ${actionId}`);
  }
  view = "dashboard";
  renderAll();
}

// ── Approval Actions ──────────────────────────────────────────

// Grace period: after confirm/cancel, stay on approval page briefly
// so the agent can transition working→waiting for the next question
let approvalGraceUntil = 0;

function doConfirm() {
  const agent = getSelectedAgent();
  if (agent) {
    send({ type: "command", agentId: agent.id, action: "approve" });
    log(`Confirm (Enter): ${agent.name}`);
    // Stay on approval page — agent may show next question
    approvalGraceUntil = Date.now() + 5000; // 5s grace period
    renderAll();
  }
}

function doCancel() {
  const agent = getSelectedAgent();
  if (agent) {
    send({ type: "command", agentId: agent.id, action: "reject" });
    log(`Cancel (Esc): ${agent.name}`);
    // Cancel = user explicitly dismissed — go back to dashboard immediately
    view = "dashboard";
    approvalGraceUntil = 0;
    renderAll();
  }
}

function doNav(direction) {
  const agent = getSelectedAgent();
  if (agent) {
    send({ type: "command", agentId: agent.id, action: `nav_${direction}` });
    log(`Nav ${direction}: ${agent.name}`);
  }
}

function goBack() {
  view = "dashboard";
  renderAll();
}

// ── Rendering ──────────────────────────────────────────────────
// Every render function sets ALL 9 buttons. This ensures no stale
// state, which is critical for the real Logi SDK where each button
// is an independent BitmapBuilder tile.

function renderAll() {
  renderKeypad();
  renderDialpad();
}

function renderKeypad() {
  switch (view) {
    case "new-agent":   renderNewAgentPage();  break;
    case "approval":    renderApprovalPage();  break;
    case "menu":        renderMenuPage();      break;
    case "status-list": renderStatusList();    break;
    default:            renderDashboard();
  }
}

// ── Dashboard View ──────────────────────────────────────────────
// Layout: 6 agent tiles (paginated) + NEW / SESSIONS / MENU

function renderDashboard() {
  const grid = document.querySelector(".keypad-grid");
  const start = page * SLOTS_PER_PAGE;
  const pageAgents = state.agents.slice(start, start + SLOTS_PER_PAGE);

  for (let i = 0; i < SLOTS_PER_PAGE; i++) {
    const btn = grid.children[i];
    const agent = pageAgents[i];
    resetBtn(btn);

    if (!agent) {
      btn.classList.add("empty");
      continue;
    }

    btn.classList.add(`status-${agent.status}`);
    if (state.selectedAgentId === agent.id) btn.style.borderColor = "#fff";

    const _icon = agentIcon(agent.agent);
    btn.innerHTML = `
      <span class="agent-name">${truncate(agent.name, 6)}</span>
      <span class="agent-status">${statusText(agent)}</span>
      ${_icon ? `<img class="agent-icon" src="${_icon}" alt="">` : ""}
    `;

    btn.onclick = ((a) => () => {
      state.selectedAgentId = a.id;
      send({ type: "open_terminal", agentId: a.id });
      if (a.status === "waiting") {
        view = "approval";
        log(`${a.name}: needs input \u2014 review in VS Code`);
      } else {
        log(`Focused: ${a.name}`);
      }
      renderAll();
    })(agent);
  }

  // ── Bottom row ──

  // [7] NEW
  const btnNew = grid.children[6];
  resetBtn(btnNew);
  btnNew.classList.add("ctrl-btn");
  btnNew.innerHTML = `<span class="ctrl-icon">+</span><span class="ctrl-label">NEW</span>`;
  btnNew.onclick = () => { view = "new-agent"; renderAll(); };

  // [8] SESSIONS — counter with status breakdown
  const btnSessions = grid.children[7];
  resetBtn(btnSessions);
  btnSessions.classList.add("ctrl-btn", "sessions-btn");

  const total = state.agents.length;
  const working = state.agents.filter(a => a.status === "working").length;
  const waiting = state.agents.filter(a => a.status === "waiting").length;
  const errors = state.agents.filter(a => a.status === "error").length;
  const idle = state.agents.filter(a => a.status === "idle").length;

  let parts = [];
  if (working > 0) parts.push(`<span class="sess-working">${working}\u25CF</span>`);
  if (waiting > 0) parts.push(`<span class="sess-waiting">${waiting}\u25D0</span>`);
  if (errors > 0)  parts.push(`<span class="sess-error">${errors}\u2715</span>`);
  if (idle > 0)    parts.push(`<span class="sess-idle">${idle}\u25CB</span>`);

  const pageLabel = dashboardTotalPages() > 1
    ? `<span class="sess-page">${page + 1}/${dashboardTotalPages()}</span>` : "";

  btnSessions.innerHTML = `
    <span class="ctrl-count">${total}</span>
    <span class="ctrl-label">SESSIONS</span>
    <span class="sess-breakdown">${parts.join(" ")}</span>
    ${pageLabel}
  `;
  btnSessions.onclick = () => { statusPage = 0; view = "status-list"; renderAll(); };

  // [9] MENU
  const btnMenu = grid.children[8];
  resetBtn(btnMenu);
  btnMenu.classList.add("ctrl-btn", "menu-btn");
  btnMenu.innerHTML = `<span class="ctrl-icon menu-icon">\u2630</span><span class="ctrl-label">MENU</span>`;
  btnMenu.onclick = () => { menuPage = 0; view = "menu"; renderAll(); };
}

// ── New Agent View ──────────────────────────────────────────────
// Layout: up to 8 agent type tiles + BACK
// Maps to: PluginDynamicFolder sub-page, one BitmapBuilder tile per agent type

function renderNewAgentPage() {
  const grid = document.querySelector(".keypad-grid");

  for (let i = 0; i < SLOTS_PER_PAGE; i++) {
    const btn = grid.children[i];
    const agent = AGENTS[i]; // May be undefined if <6 agent types
    resetBtn(btn);

    if (!agent) {
      btn.classList.add("empty");
      continue;
    }

    btn.classList.add("new-agent-btn");
    btn.style.borderColor = agent.color + "66";
    btn.innerHTML = `
      <img class="new-agent-icon" src="${agent.icon}" alt="${agent.name}">
      <span class="new-agent-name">${agent.name}</span>
      <span class="new-agent-desc">${agent.desc}</span>
    `;
    btn.onclick = ((a) => () => {
      send({ type: "launch", projectPath: ".", agent: a.id });
      log(`Launching ${a.name}`);
      view = "dashboard";
      renderAll();
    })(agent);
  }

  // ── Bottom row ──

  // [7] BACK
  const btnBack = grid.children[6];
  resetBtn(btnBack);
  btnBack.classList.add("ctrl-btn");
  btnBack.innerHTML = `<span class="ctrl-label">BACK</span>`;
  btnBack.onclick = goBack;

  // [8-9] empty
  for (let i = 7; i < 9; i++) {
    resetBtn(grid.children[i]);
    grid.children[i].classList.add("empty");
  }
}

// ── Approval View ───────────────────────────────────────────────
// Layout:
//   [Identity]  [Duration]  [Summary]     ← context
//   [◀ PREV]    [▲ UP/▼ DN] [▶ NEXT]     ← navigation (tabs + options)
//   [CONFIRM]   [CANCEL]    [BACK]        ← actions

function renderApprovalPage() {
  const grid = document.querySelector(".keypad-grid");
  const agent = getSelectedAgent();

  if (!agent) { goBack(); return; }

  const agentLabel = capitalize(agent.agent || "agent");
  const shortPath = (agent.projectPath || "").split("/").pop() || "?";
  const duration = formatDuration(agent.createdAt);

  // [1] Identity
  const btn0 = grid.children[0];
  resetBtn(btn0);
  btn0.classList.add("context-btn", "context-identity");
  btn0.style.borderColor = "#fff";
  btn0.innerHTML = `
    <span class="ctx-agent">${agentLabel}</span>
    <span class="ctx-project">${truncate(shortPath, 8)}</span>
  `;
  btn0.onclick = () => {
    send({ type: "open_terminal", agentId: agent.id });
    log(`Focused terminal: ${agent.name}`);
  };

  // [2] Duration
  const btn1 = grid.children[1];
  resetBtn(btn1);
  btn1.classList.add("context-btn");
  btn1.innerHTML = `
    <span class="ctx-value">${duration}</span>
    <span class="ctx-label">SESSION</span>
  `;

  // [3] Approval summary / status
  const btn2 = grid.children[2];
  resetBtn(btn2);
  btn2.classList.add("context-btn");
  if (agent.status === "waiting") {
    const approvalSummary = agent.approval?.summary || "Input needed";
    btn2.innerHTML = `
      <span class="ctx-value ctx-waiting">INPUT</span>
      <span class="ctx-detail">${truncate(approvalSummary, 12)}</span>
    `;
  } else {
    // Grace period — agent is processing after confirm
    btn2.innerHTML = `
      <span class="ctx-value" style="color:#5cb870">...</span>
      <span class="ctx-detail">Processing</span>
    `;
  }

  // [4] ◀ PREV (Shift+Tab — previous tab)
  const btnPrev = grid.children[3];
  resetBtn(btnPrev);
  btnPrev.classList.add("ctrl-btn", "nav-btn");
  btnPrev.innerHTML = `<span class="ctrl-icon">◀</span><span class="ctrl-label">PREV</span>`;
  btnPrev.onclick = () => doNav("left");

  // [5] ▲▼ UP/DOWN (arrow keys — navigate options)
  const btnUpDown = grid.children[4];
  resetBtn(btnUpDown);
  btnUpDown.classList.add("ctrl-btn", "nav-btn");
  btnUpDown.innerHTML = `<span class="ctrl-icon">▲▼</span><span class="ctrl-label">OPTIONS</span>`;
  // Tap cycles down; the dial handles both directions
  btnUpDown.onclick = () => doNav("down");

  // [6] ▶ NEXT (Tab — next tab)
  const btnNext = grid.children[5];
  resetBtn(btnNext);
  btnNext.classList.add("ctrl-btn", "nav-btn");
  btnNext.innerHTML = `<span class="ctrl-icon">▶</span><span class="ctrl-label">NEXT</span>`;
  btnNext.onclick = () => doNav("right");

  // [7] CONFIRM (Enter)
  const btnConfirm = grid.children[6];
  resetBtn(btnConfirm);
  btnConfirm.classList.add("ctrl-btn", "approve-btn");
  btnConfirm.innerHTML = `<span class="ctrl-icon approve-icon">⏎</span><span class="ctrl-label">CONFIRM</span>`;
  btnConfirm.onclick = doConfirm;

  // [8] CANCEL (Esc)
  const btnCancel = grid.children[7];
  resetBtn(btnCancel);
  btnCancel.classList.add("ctrl-btn", "reject-btn");
  btnCancel.innerHTML = `<span class="ctrl-icon reject-icon">⎋</span><span class="ctrl-label">CANCEL</span>`;
  btnCancel.onclick = doCancel;

  // [9] BACK
  const btnBack = grid.children[8];
  resetBtn(btnBack);
  btnBack.classList.add("ctrl-btn");
  btnBack.innerHTML = `<span class="ctrl-label">BACK</span>`;
  btnBack.onclick = goBack;
}

// ── Menu View ───────────────────────────────────────────────────
// Layout: 6 action tiles + PREV / page info / NEXT|BACK

function renderMenuPage() {
  const grid = document.querySelector(".keypad-grid");
  const start = menuPage * MENU_PER_PAGE;
  const pageActions = MENU_ACTIONS.slice(start, start + MENU_PER_PAGE);
  const menuTotalPages = Math.max(1, Math.ceil(MENU_ACTIONS.length / MENU_PER_PAGE));

  for (let i = 0; i < MENU_PER_PAGE; i++) {
    const btn = grid.children[i];
    const action = pageActions[i];
    resetBtn(btn);

    if (!action) {
      btn.classList.add("empty");
      continue;
    }

    btn.classList.add("menu-action-btn");
    btn.style.borderColor = action.color + "66";
    btn.innerHTML = `
      <span class="menu-action-icon" style="color:${action.color}">${action.icon}</span>
      <span class="menu-action-label">${action.label}</span>
    `;
    btn.onclick = ((a) => () => executeMenuAction(a.id))(action);
  }

  // [7] BACK (always bottom-left)
  const btnBack = grid.children[6];
  resetBtn(btnBack);
  btnBack.classList.add("ctrl-btn");
  btnBack.innerHTML = `<span class="ctrl-label">BACK</span>`;
  btnBack.onclick = goBack;

  // [8] Page cycle — tap to advance, wraps around
  const btnPageCycle = grid.children[7];
  resetBtn(btnPageCycle);
  btnPageCycle.classList.add("ctrl-btn");
  btnPageCycle.innerHTML = `
    <span class="ctrl-count">${menuPage + 1}/${menuTotalPages}</span>
    <span class="ctrl-label">PAGE</span>
  `;
  btnPageCycle.onclick = () => {
    menuPage = (menuPage + 1) % menuTotalPages;
    renderAll();
  };

  // [9] empty
  const btnEmpty = grid.children[8];
  resetBtn(btnEmpty);
  btnEmpty.classList.add("empty");
}

// ── Status List View ────────────────────────────────────────────
// Layout: up to 8 agent tiles + BACK (paginated via dial)
// Shows all agents with status — like dashboard but focused on status review

function renderStatusList() {
  const grid = document.querySelector(".keypad-grid");
  const start = statusPage * STATUS_PER_PAGE;
  const pageAgents = state.agents.slice(start, start + STATUS_PER_PAGE);
  const statusTotalPages = Math.max(1, Math.ceil(state.agents.length / STATUS_PER_PAGE));

  for (let i = 0; i < SLOTS_PER_PAGE; i++) {
    const btn = grid.children[i];
    const agent = pageAgents[i];
    resetBtn(btn);

    if (!agent) {
      btn.classList.add("empty");
      continue;
    }

    btn.classList.add(`status-${agent.status}`);
    if (state.selectedAgentId === agent.id) btn.style.borderColor = "#fff";

    const _sIcon = agentIcon(agent.agent);
    btn.innerHTML = `
      <span class="agent-name">${truncate(agent.name, 6)}</span>
      <span class="agent-status">${statusText(agent)}</span>
      ${_sIcon ? `<img class="agent-icon" src="${_sIcon}" alt="">` : ""}
    `;

    btn.onclick = ((a) => () => {
      state.selectedAgentId = a.id;
      send({ type: "open_terminal", agentId: a.id });
      if (a.status === "waiting") {
        view = "approval";
        log(`${a.name}: needs input`);
      } else {
        log(`Focused: ${a.name}`);
        view = "dashboard";
      }
      renderAll();
    })(agent);
  }

  // ── Bottom row ──

  // [7] BACK
  const btnBack = grid.children[6];
  resetBtn(btnBack);
  btnBack.classList.add("ctrl-btn");
  btnBack.innerHTML = `<span class="ctrl-label">BACK</span>`;
  btnBack.onclick = goBack;

  // [8] Page cycle (if paginated)
  const btnPage = grid.children[7];
  resetBtn(btnPage);
  btnPage.classList.add("ctrl-btn");
  if (statusTotalPages > 1) {
    btnPage.innerHTML = `
      <span class="ctrl-count">${statusPage + 1}/${statusTotalPages}</span>
      <span class="ctrl-label">PAGE</span>
    `;
    btnPage.onclick = () => {
      statusPage = (statusPage + 1) % statusTotalPages;
      renderAll();
    };
  } else {
    btnPage.classList.add("empty");
  }

  // [9] empty
  const btnEmpty = grid.children[8];
  resetBtn(btnEmpty);
  btnEmpty.classList.add("empty");
}

// ── Dialpad ─────────────────────────────────────────────────────
// Maps to: PluginDynamicAdjustment + 4 physical buttons on dial unit

function renderDialpad() {
  const dialLabel = document.getElementById("dial-label");
  const rollerLabel = document.getElementById("roller-label");

  switch (view) {
    case "dashboard":
      if (dashboardTotalPages() > 1) {
        dialLabel.textContent = `Page\n${page + 1}/${dashboardTotalPages()}`;
        rollerLabel.textContent = `${state.agents.length} agents`;
      } else {
        const agent = getSelectedAgent();
        if (agent) {
          const prefix = agent.status === "waiting" ? "INPUT"
            : agent.status === "working" ? "Running"
            : agent.status === "error" ? "Error"
            : "Ready";
          dialLabel.textContent = `${prefix}\n${agent.name}`;
        } else {
          dialLabel.textContent = state.agents.length > 0 ? `${state.agents.length} agents` : "No agent";
        }
        rollerLabel.textContent = "";
      }
      break;

    case "new-agent":
      dialLabel.textContent = "New\nAgent";
      rollerLabel.textContent = `${AGENTS.length} types`;
      break;

    case "approval": {
      const a = getSelectedAgent();
      dialLabel.textContent = a ? `INPUT\n${a.name}` : "INPUT";
      rollerLabel.textContent = "";
      break;
    }

    case "menu": {
      const total = Math.max(1, Math.ceil(MENU_ACTIONS.length / MENU_PER_PAGE));
      dialLabel.textContent = `Actions\n${menuPage + 1}/${total}`;
      rollerLabel.textContent = "";
      break;
    }

    case "status-list": {
      const total = Math.max(1, Math.ceil(state.agents.length / STATUS_PER_PAGE));
      dialLabel.textContent = `Status\n${statusPage + 1}/${total}`;
      rollerLabel.textContent = `${state.agents.length} agents`;
      break;
    }
  }
}

// ── Button helpers ──────────────────────────────────────────────

function agentIcon(agentId) {
  const a = AGENTS.find(x => x.id === agentId);
  return a ? a.icon : "";
}

function resetBtn(btn) {
  btn.className = "lcd-btn";
  btn.innerHTML = "";
  btn.onclick = null;
  btn.style.borderColor = "";
}

function getSelectedAgent() {
  if (!state.selectedAgentId) return null;
  return state.agents.find((a) => a.id === state.selectedAgentId) || null;
}

function statusText(agent) {
  switch (agent.status) {
    case "idle":    return "ready";
    case "working": return "running";
    case "waiting": return "INPUT!";
    case "error":   return "error";
    default:        return "offline";
  }
}

function truncate(str, max) {
  if (!str) return "?";
  return str.length <= max ? str : str.slice(0, max);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDuration(isoDate) {
  if (!isoDate) return "--:--";
  const elapsed = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (elapsed < 0) return "0:00";
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function escapeHtml(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function updateConnection(connected) {
  const el = document.getElementById("connection");
  el.className = connected ? "connection connected" : "connection";
  el.querySelector(".label").textContent = connected
    ? "Connected to Extension"
    : "Disconnected";
}

const MAX_LOG_ENTRIES = 300;

function log(msg, type = "") {
  const container = document.getElementById("log-content");
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg ${type}">${escapeHtml(msg)}</span>`;
  container.appendChild(entry);
  // Cap log entries to prevent unbounded DOM growth
  while (container.children.length > MAX_LOG_ENTRIES) {
    container.removeChild(container.firstChild);
  }
  container.scrollTop = container.scrollHeight;
}

// ── Event Handlers ─────────────────────────────────────────────
// These map to physical buttons on the MX Creative Console dial unit:
//   btn-yes   → top-right button
//   btn-no    → bottom-right button
//   btn-undo  → top-left button (END)
//   btn-pause → bottom-left button (PAUSE)
//   dial      → rotary encoder (wheel event)
//   roller    → simulated via up/down arrows

document.getElementById("btn-yes").addEventListener("click", () => {
  if (view === "approval") doConfirm();
});

document.getElementById("btn-no").addEventListener("click", () => {
  if (view === "approval") doCancel();
  else if (view !== "dashboard") goBack();
});

document.getElementById("btn-undo").addEventListener("click", () => {
  const agent = getSelectedAgent();
  if (agent) {
    send({ type: "command", agentId: agent.id, action: "kill" });
    log(`End: ${agent.name}`);
    if (view === "approval") { view = "dashboard"; }
    renderAll();
  }
});

document.getElementById("btn-pause").addEventListener("click", () => {
  const agent = getSelectedAgent();
  if (agent) {
    send({ type: "command", agentId: agent.id, action: "pause" });
    log(`Pause: ${agent.name}`);
  }
});

// Dial rotation — context-dependent pagination
// Listen on dial-area (larger target) and dial itself
const dialEl = document.getElementById("dial");
const dialArea = dialEl.closest(".dial-area") || dialEl;

// Wheel (scroll) on dial area
dialArea.addEventListener("wheel", (e) => {
  e.preventDefault();
  handleDial(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

// Click-drag rotation on dial
let dialDragging = false;
let dialLastY = 0;
let dialAccum = 0;
const DRAG_THRESHOLD = 30; // pixels per tick

dialEl.addEventListener("mousedown", (e) => {
  dialDragging = true;
  dialLastY = e.clientY;
  dialAccum = 0;
  dialEl.style.cursor = "grabbing";
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!dialDragging) return;
  const dy = e.clientY - dialLastY;
  dialAccum += dy;
  dialLastY = e.clientY;
  while (dialAccum >= DRAG_THRESHOLD) {
    handleDial(1);
    dialAccum -= DRAG_THRESHOLD;
  }
  while (dialAccum <= -DRAG_THRESHOLD) {
    handleDial(-1);
    dialAccum += DRAG_THRESHOLD;
  }
});

document.addEventListener("mouseup", () => {
  if (dialDragging) {
    dialDragging = false;
    dialEl.style.cursor = "grab";
  }
});

// Touch drag on dial (mobile / trackpad)
dialEl.addEventListener("touchstart", (e) => {
  dialDragging = true;
  dialLastY = e.touches[0].clientY;
  dialAccum = 0;
  e.preventDefault();
}, { passive: false });

document.addEventListener("touchmove", (e) => {
  if (!dialDragging) return;
  const dy = e.touches[0].clientY - dialLastY;
  dialAccum += dy;
  dialLastY = e.touches[0].clientY;
  while (dialAccum >= DRAG_THRESHOLD) {
    handleDial(1);
    dialAccum -= DRAG_THRESHOLD;
  }
  while (dialAccum <= -DRAG_THRESHOLD) {
    handleDial(-1);
    dialAccum += DRAG_THRESHOLD;
  }
}, { passive: false });

document.addEventListener("touchend", () => {
  dialDragging = false;
});

document.getElementById("roller-up").addEventListener("click", () => handleDial(-1));
document.getElementById("roller-down").addEventListener("click", () => handleDial(1));

// Visual dial rotation
let dialAngle = 0;

function handleDial(diff) {
  dialAngle += diff * 30;
  dialEl.style.transform = `rotate(${dialAngle}deg)`;

  switch (view) {
    case "dashboard":   paginateDashboard(diff); break;
    case "menu":        paginateMenu(diff);      break;
    case "status-list": paginateStatus(diff);    break;
    case "approval":    doNav(diff > 0 ? "down" : "up"); break;
    // new-agent: no pagination needed
  }
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (view === "approval") doCancel();
    else if (view !== "dashboard") goBack();
  }
  if (e.key === "Enter" && view === "approval") {
    e.preventDefault();
    doConfirm();
  }
  if (view === "approval" && e.key === "ArrowLeft")  { e.preventDefault(); doNav("left"); return; }
  if (view === "approval" && e.key === "ArrowRight") { e.preventDefault(); doNav("right"); return; }
  if (e.key === "ArrowUp")   { e.preventDefault(); handleDial(-1); }
  if (e.key === "ArrowDown") { e.preventDefault(); handleDial(1);  }
});

document.getElementById("log-clear").addEventListener("click", () => {
  document.getElementById("log-content").innerHTML = "";
});

// ── Mock Mode ──────────────────────────────────────────────────

function loadMockData() {
  state.agents = [
    { id: "s1", slot: 0, name: "JW",   agent: "claude", status: "working",  projectPath: "~/Dev/jw-app",  createdAt: new Date().toISOString() },
    { id: "s2", slot: 1, name: "AFH",  agent: "claude", status: "waiting",  projectPath: "~/Dev/afh",     createdAt: new Date().toISOString() },
    { id: "s3", slot: 2, name: "SNAP", agent: "gemini", status: "error",    projectPath: "~/Dev/snapopa", createdAt: new Date().toISOString() },
    { id: "s4", slot: 3, name: "API",  agent: "codex",  status: "idle",     projectPath: "~/Dev/api",     createdAt: new Date().toISOString() },
  ];
  log("Mock data loaded (Extension not running)", "state");
  renderAll();
}

// ── Init ───────────────────────────────────────────────────────

renderAll();

// Tick session duration every second in approval view
setInterval(() => {
  if (view === "approval") renderKeypad();
}, 1000);

connect();
setTimeout(() => {
  if (state.phase !== "connected" && state.agents.length === 0) loadMockData();
}, 2000);
