// AgentDeck Web Simulator
// Connects to VS Code Extension WebSocket and renders MX Creative Console UI
// Console = remote control. VS Code = the screen.
// Tap agent tile → focus terminal in VS Code.
// Waiting agent → navigates into approval page with APPROVE / REJECT / BACK.

const WS_URL = "ws://localhost:9999";
const RECONNECT_DELAY = 3000;
const MAX_SLOTS = 6;

const AGENTS = [
  { id: "claude", name: "Claude", desc: "Anthropic" },
  { id: "gemini", name: "Gemini", desc: "Google" },
  { id: "codex", name: "Codex", desc: "OpenAI" },
  { id: "aider", name: "Aider", desc: "Open source" },
  { id: "opencode", name: "OpenCode", desc: "Open source" },
];

// ── State ──────────────────────────────────────────────────────

let ws = null;

let state = {
  phase: "disconnected",
  agents: [],
  selectedAgentId: null,
};

// View: "dashboard" or "approval"
// "approval" = navigated into approval page for selected waiting agent
let view = "dashboard";

// Ring state machine — only used for pick-agent and status list
let ring = {
  mode: null, // null, "pick-agent", "status"
  cursor: 0,
  items: [],
};

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
    case "state":
      const prevSelected = state.selectedAgentId;
      state.agents = msg.agents || [];
      state.selectedAgentId = prevSelected;

      // If in approval view and agent no longer waiting, go back to dashboard
      if (view === "approval") {
        const a = getSelectedAgent();
        if (!a || a.status !== "waiting") {
          view = "dashboard";
        }
      }

      log(`State: ${state.agents.length} agents`, "state");
      renderAll();
      break;

    case "event":
      log(`Event: ${msg.agentId} -> ${msg.event}`, "event");
      if (msg.event === "needs_approval") {
        state.selectedAgentId = msg.agentId;
        view = "approval";
        send({ type: "open_terminal", agentId: msg.agentId });
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

// ── Ring State Machine (pick-agent + status only) ─────────────

function openRing(mode) {
  ring.mode = mode;
  ring.cursor = 0;

  switch (mode) {
    case "pick-agent":
      ring.items = AGENTS;
      break;
    case "status":
      ring.items = state.agents;
      break;
    default:
      ring.items = [];
  }

  document.getElementById("ring-overlay").classList.add("active");
  renderRing();
  renderDialpad();
}

function closeRing() {
  ring.mode = null;
  document.getElementById("ring-overlay").classList.remove("active");
  renderDialpad();
}

function ringDial(diff) {
  if (!ring.mode) return;
  if (ring.items.length > 0) {
    ring.cursor = Math.max(0, Math.min(ring.items.length - 1, ring.cursor + diff));
    renderRing();
    renderDialpad();
  }
}

function ringYes() {
  if (!ring.mode) return;

  switch (ring.mode) {
    case "pick-agent": {
      const picked = ring.items[ring.cursor];
      send({ type: "launch", projectPath: ".", agent: picked.id });
      log(`Launching ${picked.id} in VS Code workspace`);
      closeRing();
      break;
    }
    case "status": {
      const picked = ring.items[ring.cursor];
      if (picked) {
        state.selectedAgentId = picked.id;
        send({ type: "open_terminal", agentId: picked.id });
        if (picked.status === "waiting") {
          view = "approval";
        }
        closeRing();
        renderAll();
      }
      break;
    }
  }
}

function ringNo() {
  closeRing();
}

// ── Approval Actions ──────────────────────────────────────────

function doApprove() {
  const agent = getSelectedAgent();
  if (agent?.status === "waiting") {
    send({ type: "command", agentId: agent.id, action: "approve" });
    log(`Approved: ${agent.name}`);
    view = "dashboard";
    renderAll();
  }
}

function doReject() {
  const agent = getSelectedAgent();
  if (agent?.status === "waiting") {
    send({ type: "command", agentId: agent.id, action: "reject" });
    log(`Rejected: ${agent.name}`);
    view = "dashboard";
    renderAll();
  }
}

function goBack() {
  view = "dashboard";
  renderAll();
}

// ── Rendering ──────────────────────────────────────────────────

function renderAll() {
  renderKeypad();
  renderDialpad();
  renderRing();
}

function renderKeypad() {
  if (view === "approval") {
    renderApprovalPage();
  } else {
    renderDashboard();
  }
}

function renderDashboard() {
  const grid = document.querySelector(".keypad-grid");

  // Top 6 slots: agents
  for (let i = 0; i < MAX_SLOTS; i++) {
    const btn = grid.children[i];
    const agent = state.agents.find((a) => a.slot === i);

    btn.className = "lcd-btn";
    btn.innerHTML = "";
    btn.onclick = null;

    if (!agent) {
      btn.classList.add("empty");
      btn.onclick = null;
      continue;
    }

    btn.classList.add(`status-${agent.status}`);
    btn.style.borderColor = state.selectedAgentId === agent.id ? "#fff" : "";

    btn.innerHTML = `
      <span class="agent-name">${truncate(agent.name, 6)}</span>
      <span class="agent-status">${statusText(agent)}</span>
      <span class="agent-type">${(agent.agent || "").slice(0, 2).toUpperCase()}</span>
    `;

    btn.onclick = ((a) => () => {
      state.selectedAgentId = a.id;
      send({ type: "open_terminal", agentId: a.id });

      if (a.status === "waiting") {
        view = "approval";
        log(`${a.name}: needs input — review in VS Code`);
        renderAll();
      } else {
        log(`Focused: ${a.name}`);
        renderAll();
      }
    })(agent);
  }

  // Bottom row: NEW, STATUS, CFG
  const btnNew = grid.children[6];
  btnNew.className = "lcd-btn ctrl-btn";
  btnNew.style.borderColor = "";
  btnNew.innerHTML = `<span class="ctrl-icon">+</span><span class="ctrl-label">NEW</span>`;
  btnNew.onclick = () => openRing("pick-agent");

  const btnStatus = grid.children[7];
  btnStatus.className = "lcd-btn ctrl-btn";
  btnStatus.style.borderColor = "";
  const waitingCount = state.agents.filter((a) => a.status === "waiting").length;
  btnStatus.innerHTML = `
    <span class="ctrl-count">${state.agents.length}</span>
    <span class="ctrl-label">STATUS</span>
    <span class="ctrl-sub">${waitingCount > 0 ? `${waitingCount} waiting` : ""}</span>
  `;
  btnStatus.onclick = () => openRing("status");

  const btnCfg = grid.children[8];
  btnCfg.className = "lcd-btn ctrl-btn";
  btnCfg.style.borderColor = "";
  btnCfg.innerHTML = `<span class="ctrl-label">CFG</span>`;
  btnCfg.onclick = () => log("Custom action");
}

function renderApprovalPage() {
  const grid = document.querySelector(".keypad-grid");
  const agent = getSelectedAgent();

  if (!agent) {
    goBack();
    return;
  }

  const agentLabel = (agent.agent || "agent").charAt(0).toUpperCase() + (agent.agent || "agent").slice(1);
  const shortPath = (agent.projectPath || "").split("/").pop() || "?";
  const duration = formatDuration(agent.createdAt);

  // Top row: session info
  // Tile 1: Agent identity — who + where
  const btn0 = grid.children[0];
  btn0.className = "lcd-btn context-btn context-identity";
  btn0.style.borderColor = "#fff";
  btn0.innerHTML = `
    <span class="ctx-agent">${agentLabel}</span>
    <span class="ctx-project">${truncate(shortPath, 8)}</span>
  `;
  btn0.onclick = () => {
    send({ type: "open_terminal", agentId: agent.id });
    log(`Focused terminal: ${agent.name}`);
  };

  // Tile 2: Session duration
  const btn1 = grid.children[1];
  btn1.className = "lcd-btn context-btn";
  btn1.style.borderColor = "";
  btn1.innerHTML = `
    <span class="ctx-value">${duration}</span>
    <span class="ctx-label">SESSION</span>
  `;
  btn1.onclick = null;

  // Tile 3: Status context — what's happening
  const btn2 = grid.children[2];
  btn2.className = "lcd-btn context-btn";
  btn2.style.borderColor = "";
  const approvalSummary = agent.approval?.summary || "Permission needed";
  btn2.innerHTML = `
    <span class="ctx-value ctx-waiting">INPUT</span>
    <span class="ctx-detail">${truncate(approvalSummary, 12)}</span>
  `;
  btn2.onclick = null;

  // Middle row: empty (reserved for future: file list, cost, etc.)
  for (let i = 3; i < 6; i++) {
    const btn = grid.children[i];
    btn.className = "lcd-btn empty";
    btn.style.borderColor = "";
    btn.innerHTML = "";
    btn.onclick = null;
  }

  // Bottom row: APPROVE, REJECT, BACK
  const btnApprove = grid.children[6];
  btnApprove.className = "lcd-btn ctrl-btn approve-btn";
  btnApprove.style.borderColor = "";
  btnApprove.innerHTML = `<span class="ctrl-icon approve-icon">&#10003;</span><span class="ctrl-label">APPROVE</span>`;
  btnApprove.onclick = doApprove;

  const btnReject = grid.children[7];
  btnReject.className = "lcd-btn ctrl-btn reject-btn";
  btnReject.style.borderColor = "";
  btnReject.innerHTML = `<span class="ctrl-icon reject-icon">&#10007;</span><span class="ctrl-label">REJECT</span>`;
  btnReject.onclick = doReject;

  const btnBack = grid.children[8];
  btnBack.className = "lcd-btn ctrl-btn";
  btnBack.style.borderColor = "";
  btnBack.innerHTML = `<span class="ctrl-label">BACK</span>`;
  btnBack.onclick = goBack;
}

function renderDialpad() {
  const dialLabel = document.getElementById("dial-label");
  const rollerLabel = document.getElementById("roller-label");

  if (ring.mode === "pick-agent") {
    dialLabel.textContent = "Select\nAgent";
    rollerLabel.textContent = `${ring.cursor + 1}/${ring.items.length}`;
    return;
  }
  if (ring.mode === "status") {
    dialLabel.textContent = "All\nAgents";
    rollerLabel.textContent =
      ring.items.length > 0 ? `${ring.cursor + 1}/${ring.items.length}` : "";
    return;
  }

  const agent = getSelectedAgent();
  if (!agent) {
    dialLabel.textContent = "No agent";
    rollerLabel.textContent = "";
    return;
  }

  const prefix =
    agent.status === "waiting"
      ? "INPUT"
      : agent.status === "working"
        ? "Running"
        : agent.status === "error"
          ? "Error"
          : "Ready";

  dialLabel.textContent = `${prefix}\n${agent.name}`;
  rollerLabel.textContent = "";
}

function renderRing() {
  const overlay = document.getElementById("ring-overlay");
  if (!ring.mode || !overlay.classList.contains("active")) return;

  const header = document.getElementById("ring-header");
  const content = document.getElementById("ring-content");
  const footer = document.getElementById("ring-footer");

  switch (ring.mode) {
    case "pick-agent":
      header.innerHTML = "New Agent";
      content.innerHTML = renderList(
        ring.items.map((a) => `${a.name} <span class="ring-dim">${a.desc}</span>`),
        ring.cursor,
      );
      footer.innerHTML = `<span>Dial to scroll</span><span>YES = launch &middot; NO = cancel</span>`;
      break;

    case "status":
      header.innerHTML = "All Agents";
      content.innerHTML = renderList(
        ring.items.map(
          (a) =>
            `<span class="ring-status-dot status-${a.status}"></span> ${a.name} <span class="ring-dim">${a.agent} &middot; ${statusText(a)}</span>`,
        ),
        ring.cursor,
      );
      footer.innerHTML = `<span>${state.agents.length} agent(s)</span><span>YES = focus &middot; NO = close</span>`;
      break;
  }
}

function renderList(labels, cursor) {
  return labels
    .map(
      (label, i) =>
        `<div class="ring-list-item${i === cursor ? " active" : ""}">${label}</div>`,
    )
    .join("");
}

// ── Helpers ────────────────────────────────────────────────────

function getSelectedAgent() {
  if (!state.selectedAgentId) return null;
  return state.agents.find((a) => a.id === state.selectedAgentId) || null;
}

function statusText(agent) {
  switch (agent.status) {
    case "idle": return "ready";
    case "working": return "running";
    case "waiting": return "INPUT!";
    case "error": return "error";
    default: return "offline";
  }
}

function truncate(str, max) {
  if (!str) return "?";
  return str.length <= max ? str : str.slice(0, max);
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

function log(msg, type = "") {
  const container = document.getElementById("log-content");
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg ${type}">${escapeHtml(msg)}</span>`;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
}

// ── Event Handlers ─────────────────────────────────────────────

// Dialpad YES/NO
document.getElementById("btn-yes").addEventListener("click", () => {
  if (ring.mode) ringYes();
  else if (view === "approval") doApprove();
});

document.getElementById("btn-no").addEventListener("click", () => {
  if (ring.mode) ringNo();
  else if (view === "approval") doReject();
});

document.getElementById("btn-undo").addEventListener("click", () => {
  const agent = getSelectedAgent();
  if (agent) {
    send({ type: "command", agentId: agent.id, action: "kill" });
    log(`Kill: ${agent.name}`);
    view = "dashboard";
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

// Dial = scroll in ring lists
document.getElementById("dial").addEventListener("wheel", (e) => {
  e.preventDefault();
  ringDial(e.deltaY > 0 ? 1 : -1);
});

document.getElementById("roller-up").addEventListener("click", () => ringDial(-1));
document.getElementById("roller-down").addEventListener("click", () => ringDial(1));

// Close ring on background click
document.getElementById("ring-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeRing();
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (ring.mode) closeRing();
    else if (view === "approval") goBack();
  }
  if (e.key === "y") {
    e.preventDefault();
    if (ring.mode) ringYes();
    else if (view === "approval") doApprove();
  }
  if (e.key === "n") {
    e.preventDefault();
    if (ring.mode) ringNo();
    else if (view === "approval") doReject();
  }
  if (e.key === "ArrowUp" && ring.mode) { e.preventDefault(); ringDial(-1); }
  if (e.key === "ArrowDown" && ring.mode) { e.preventDefault(); ringDial(1); }
});

document.getElementById("log-clear").addEventListener("click", () => {
  document.getElementById("log-content").innerHTML = "";
});

// ── Mock Mode ──────────────────────────────────────────────────

function loadMockData() {
  state.agents = [
    {
      id: "s1", slot: 0, name: "JW", agent: "claude", status: "working",
      projectPath: "~/Dev/jw-app", createdAt: new Date().toISOString(),
    },
    {
      id: "s2", slot: 1, name: "AFH", agent: "claude", status: "waiting",
      projectPath: "~/Dev/afh", createdAt: new Date().toISOString(),
    },
    {
      id: "s3", slot: 2, name: "SNAP", agent: "gemini", status: "error",
      projectPath: "~/Dev/snapopa", createdAt: new Date().toISOString(),
    },
    {
      id: "s4", slot: 3, name: "API", agent: "codex", status: "idle",
      projectPath: "~/Dev/api", createdAt: new Date().toISOString(),
    },
  ];
  log("Mock data loaded (Extension not running)", "state");
  renderAll();
}

// ── Init ───────────────────────────────────────────────────────

renderAll(); // Render empty dashboard immediately

// Tick session duration every second when in approval view
setInterval(() => {
  if (view === "approval") renderKeypad();
}, 1000);

connect();
setTimeout(() => {
  if (state.phase !== "connected" && state.agents.length === 0) loadMockData();
}, 2000);
