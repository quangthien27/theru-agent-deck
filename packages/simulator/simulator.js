// AgentDeck Web Simulator
// Connects to bridge WebSocket and renders MX Creative Console UI
// Ring-driven UI: all interactions go through the Ring, controlled by dialpad

const BRIDGE_URL = "ws://localhost:9999";
const RECONNECT_DELAY = 3000;
const MAX_SLOTS = 6;

const AGENTS = [
  { id: "claude", name: "Claude", desc: "Anthropic" },
  { id: "gemini", name: "Gemini", desc: "Google" },
  { id: "codex", name: "Codex", desc: "OpenAI" },
  { id: "aider", name: "Aider", desc: "Open source" },
  { id: "opencode", name: "OpenCode", desc: "Open source" },
];

// TODO: load from ~/.agentdeck/config.json via bridge
const PROJECTS = [
  { name: "jw-app", path: "~/Dev/jw-app" },
  { name: "afh", path: "~/Dev/afh" },
  { name: "snapopa", path: "~/Dev/snapopa" },
];

// ── State ──────────────────────────────────────────────────────

let ws = null;

let state = {
  phase: "disconnected",
  agents: [],
  selectedAgentId: null,
  ringFileIndex: 0,
};

// Ring state machine
// Modes: null (closed), "agent", "approval", "pick-agent", "pick-project", "status"
let ring = {
  mode: null,
  cursor: 0, // current highlighted item in lists
  items: [], // current list items
  pickedAgent: null, // selected agent type during new-agent flow
};

// ── WebSocket ──────────────────────────────────────────────────

function connect() {
  log("Connecting to bridge...", "connect");
  try {
    ws = new WebSocket(BRIDGE_URL);
  } catch (e) {
    log(`Connection failed: ${e.message}`, "error");
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    state.phase = "connected";
    updateConnection(true);
    log("Connected to bridge", "connect");
  };

  ws.onclose = () => {
    state.phase = "disconnected";
    updateConnection(false);
    log("Disconnected from bridge", "error");
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
      log(`State: ${state.agents.length} agents`, "state");
      renderAll();
      break;

    case "event":
      log(`Event: ${msg.agentId} -> ${msg.event}`, "event");
      if (msg.event === "needs_approval") {
        state.selectedAgentId = msg.agentId;
        state.ringFileIndex = 0;
        openRing("approval");
      }
      break;
  }
}

// ── Ring State Machine ─────────────────────────────────────────

function openRing(mode) {
  ring.mode = mode;
  ring.cursor = 0;

  switch (mode) {
    case "pick-agent":
      ring.items = AGENTS;
      break;
    case "pick-project":
      ring.items = PROJECTS;
      break;
    case "status":
      ring.items = state.agents;
      break;
    default:
      ring.items = [];
  }

  document.getElementById("ring-overlay").classList.add("active");
  renderAll();
}

function closeRing() {
  ring.mode = null;
  document.getElementById("ring-overlay").classList.remove("active");
  renderAll();
}

// Dial = scroll within current view
function ringDial(diff) {
  if (!ring.mode) return;

  if (ring.mode === "approval") {
    // Scroll not implemented visually yet, but state tracked
    return;
  }

  // List modes: move cursor
  if (ring.items.length > 0) {
    ring.cursor = Math.max(0, Math.min(ring.items.length - 1, ring.cursor + diff));
    renderRing();
  }
}

// Roller = navigate files in approval mode
function ringRoller(diff) {
  if (ring.mode === "approval") {
    const agent = getSelectedAgent();
    if (!agent?.approval?.files?.length) return;
    const max = agent.approval.files.length - 1;
    state.ringFileIndex = Math.max(0, Math.min(max, state.ringFileIndex + diff));
    renderRing();
  }
}

// YES = confirm current selection
function ringYes() {
  if (!ring.mode) return;

  switch (ring.mode) {
    case "pick-agent":
      ring.pickedAgent = ring.items[ring.cursor].id;
      log(`Selected agent: ${ring.pickedAgent}`);
      openRing("pick-project");
      break;

    case "pick-project":
      const project = ring.items[ring.cursor];
      send({
        type: "launch",
        projectPath: project.path,
        agent: ring.pickedAgent,
      });
      log(`Launching ${ring.pickedAgent} at ${project.path}`);
      closeRing();
      break;

    case "approval": {
      const agent = getSelectedAgent();
      if (agent) {
        send({ type: "command", agentId: agent.id, action: "approve" });
        log(`Approved: ${agent.name}`);
      }
      closeRing();
      break;
    }

    case "agent": {
      // If agent is waiting, switch to approval view
      const a = getSelectedAgent();
      if (a?.status === "waiting" && a.approval) {
        state.ringFileIndex = 0;
        openRing("approval");
      }
      break;
    }

    case "status": {
      // Select agent from list
      const picked = ring.items[ring.cursor];
      if (picked) {
        state.selectedAgentId = picked.id;
        if (picked.status === "waiting" && picked.approval) {
          state.ringFileIndex = 0;
          openRing("approval");
        } else {
          openRing("agent");
        }
      }
      break;
    }
  }
}

// NO = cancel / go back
function ringNo() {
  if (!ring.mode) return;

  switch (ring.mode) {
    case "pick-project":
      // Go back to agent picker
      openRing("pick-agent");
      break;

    case "approval": {
      const agent = getSelectedAgent();
      if (agent) {
        send({ type: "command", agentId: agent.id, action: "reject" });
        log(`Rejected: ${agent.name}`);
      }
      closeRing();
      break;
    }

    default:
      closeRing();
  }
}

// ── Rendering ──────────────────────────────────────────────────

function renderAll() {
  renderSlots();
  renderControls();
  renderDialpad();
  renderRing();
}

function renderSlots() {
  for (let i = 0; i < MAX_SLOTS; i++) {
    const btn = document.getElementById(`slot-${i}`);
    const agent = state.agents.find((a) => a.slot === i);

    btn.className = "lcd-btn";
    btn.innerHTML = "";

    if (!agent) {
      btn.classList.add("empty");
      continue;
    }

    btn.classList.add(`status-${agent.status}`);
    btn.style.borderColor =
      state.selectedAgentId === agent.id ? "#fff" : "";

    btn.innerHTML = `
      <span class="agent-name">${truncate(agent.name, 6)}</span>
      <span class="agent-status">${statusText(agent)}</span>
      <span class="agent-type">${(agent.agent || "").slice(0, 2).toUpperCase()}</span>
    `;
  }
}

function renderControls() {
  document.getElementById("status-count").textContent = state.agents.length;
  const waiting = state.agents.filter((a) => a.status === "waiting").length;
  document.getElementById("status-waiting").textContent =
    waiting > 0 ? `${waiting} waiting` : "";
}

function renderDialpad() {
  const dialLabel = document.getElementById("dial-label");
  const rollerLabel = document.getElementById("roller-label");

  // Show ring context in dial
  if (ring.mode === "pick-agent") {
    dialLabel.textContent = "Select\nAgent";
    rollerLabel.textContent = `${ring.cursor + 1}/${ring.items.length}`;
    return;
  }
  if (ring.mode === "pick-project") {
    dialLabel.textContent = "Select\nProject";
    rollerLabel.textContent = `${ring.cursor + 1}/${ring.items.length}`;
    return;
  }
  if (ring.mode === "status") {
    dialLabel.textContent = "All\nAgents";
    rollerLabel.textContent =
      ring.items.length > 0
        ? `${ring.cursor + 1}/${ring.items.length}`
        : "";
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

  if (ring.mode === "approval" && agent.approval?.files?.length) {
    rollerLabel.textContent = `${state.ringFileIndex + 1}/${agent.approval.files.length}`;
  } else {
    rollerLabel.textContent = "";
  }
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
      footer.innerHTML = `<span>Dial to scroll</span><span>YES = select &middot; NO = cancel</span>`;
      break;

    case "pick-project":
      header.innerHTML = `New ${capitalize(ring.pickedAgent)} Agent`;
      content.innerHTML = renderList(
        ring.items.map(
          (p) =>
            `${p.name} <span class="ring-dim">${p.path}</span>`,
        ),
        ring.cursor,
      );
      footer.innerHTML = `<span>Dial to scroll</span><span>YES = launch &middot; NO = back</span>`;
      break;

    case "approval":
      renderApprovalRing(header, content, footer);
      break;

    case "agent":
      renderAgentRing(header, content, footer);
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
      footer.innerHTML = `<span>${state.agents.length} agent(s)</span><span>YES = select &middot; NO = close</span>`;
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

function renderApprovalRing(header, content, footer) {
  const agent = getSelectedAgent();
  if (!agent?.approval) {
    header.innerHTML = "No approval data";
    content.innerHTML = "";
    footer.innerHTML = "";
    return;
  }

  const a = agent.approval;
  header.innerHTML = `<span class="ring-waiting">${agent.name} &mdash; Needs Input</span>`;

  if (a.files?.length) {
    const file = a.files[Math.min(state.ringFileIndex, a.files.length - 1)];
    content.innerHTML =
      `<div class="ring-dim" style="margin-bottom:8px">Edit: ${escapeHtml(file.path)}</div>` +
      formatDiff(file.diff);
    footer.innerHTML = `<span>File ${state.ringFileIndex + 1}/${a.files.length}</span><span>YES = approve &middot; NO = reject</span>`;
  } else if (a.command) {
    content.innerHTML = `<div class="ring-dim" style="margin-bottom:8px">Run command:</div><div style="color:#ddd">${escapeHtml(a.command)}</div>`;
    footer.innerHTML = `<span>${a.type}</span><span>YES = approve &middot; NO = reject</span>`;
  } else {
    content.innerHTML = `<div>${escapeHtml(a.summary || a.fullContent)}</div>`;
    footer.innerHTML = `<span>${a.type}</span><span>YES = approve &middot; NO = reject</span>`;
  }
}

function renderAgentRing(header, content, footer) {
  const agent = getSelectedAgent();
  if (!agent) {
    closeRing();
    return;
  }

  header.innerHTML = agent.name;
  content.innerHTML = `
<div class="ring-detail"><span class="ring-dim">Status</span> ${statusText(agent)}</div>
<div class="ring-detail"><span class="ring-dim">Agent</span> ${agent.agent}</div>
<div class="ring-detail"><span class="ring-dim">Project</span> ${agent.projectPath}</div>
<div class="ring-detail"><span class="ring-dim">Started</span> ${agent.createdAt}</div>`;

  const actions = [];
  if (agent.status === "waiting") actions.push("YES = approve");
  actions.push("NO = close");
  footer.innerHTML = `<span class="ring-status-dot status-${agent.status}"></span><span>${actions.join(" &middot; ")}</span>`;
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

function capitalize(str) {
  if (!str) return "";
  return str[0].toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDiff(diff) {
  if (!diff) return "";
  return escapeHtml(diff)
    .split("\n")
    .map((line) => {
      if (line.startsWith("+")) return `<span class="diff-add">${line}</span>`;
      if (line.startsWith("-")) return `<span class="diff-remove">${line}</span>`;
      if (line.startsWith("@@")) return `<span class="diff-hunk">${line}</span>`;
      return line;
    })
    .join("\n");
}

function updateConnection(connected) {
  const el = document.getElementById("connection");
  el.className = connected ? "connection connected" : "connection";
  el.querySelector(".label").textContent = connected ? "Connected" : "Disconnected";
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

// Agent slot tap → open agent detail or approval ring
for (let i = 0; i < MAX_SLOTS; i++) {
  document.getElementById(`slot-${i}`).addEventListener("click", () => {
    const agent = state.agents.find((a) => a.slot === i);
    if (!agent) return;

    state.selectedAgentId = agent.id;
    state.ringFileIndex = 0;

    if (agent.status === "waiting" && agent.approval) {
      openRing("approval");
    } else {
      openRing("agent");
    }

    log(`Selected: ${agent.name} (slot ${i})`);
  });
}

// NEW → open agent picker ring
document.getElementById("btn-new").addEventListener("click", () => openRing("pick-agent"));

// STATUS → open all-agents ring
document.getElementById("btn-status").addEventListener("click", () => openRing("status"));

document.getElementById("btn-custom").addEventListener("click", () => log("Custom action"));

// Dialpad → routed through ring state machine
document.getElementById("btn-yes").addEventListener("click", () => ringYes());
document.getElementById("btn-no").addEventListener("click", () => ringNo());

document.getElementById("btn-undo").addEventListener("click", () => {
  const agent = getSelectedAgent();
  if (agent) {
    send({ type: "command", agentId: agent.id, action: "kill" });
    log(`Kill: ${agent.name}`);
  }
});

document.getElementById("btn-pause").addEventListener("click", () => {
  const agent = getSelectedAgent();
  if (agent) {
    send({ type: "command", agentId: agent.id, action: "pause" });
    log(`Pause: ${agent.name}`);
  }
});

// Dial = scroll / navigate list
document.getElementById("dial").addEventListener("wheel", (e) => {
  e.preventDefault();
  ringDial(e.deltaY > 0 ? 1 : -1);
});

// Roller = file navigation in approval, or same as dial in list modes
document.getElementById("roller-up").addEventListener("click", () => {
  if (ring.mode === "approval") {
    ringRoller(-1);
  } else {
    ringDial(-1);
  }
});

document.getElementById("roller-down").addEventListener("click", () => {
  if (ring.mode === "approval") {
    ringRoller(1);
  } else {
    ringDial(1);
  }
});

// Close ring on background click
document.getElementById("ring-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeRing();
});

// Keyboard shortcuts (simulate dialpad)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeRing();
  if (e.key === "y" && ring.mode) { e.preventDefault(); ringYes(); }
  if (e.key === "n" && ring.mode) { e.preventDefault(); ringNo(); }
  if (e.key === "ArrowUp" && ring.mode) { e.preventDefault(); ringDial(-1); }
  if (e.key === "ArrowDown" && ring.mode) { e.preventDefault(); ringDial(1); }
  if (e.key === "ArrowLeft" && ring.mode) { e.preventDefault(); ringRoller(-1); }
  if (e.key === "ArrowRight" && ring.mode) { e.preventDefault(); ringRoller(1); }
});

document.getElementById("log-clear").addEventListener("click", () => {
  document.getElementById("log-content").innerHTML = "";
});

// ── Mock Mode ──────────────────────────────────────────────────

function loadMockData() {
  state.agents = [
    {
      id: "s1", slot: 0, name: "JW", agent: "claude", status: "working",
      projectPath: "~/projects/jw-app", createdAt: new Date().toISOString(),
    },
    {
      id: "s2", slot: 1, name: "AFH", agent: "claude", status: "waiting",
      projectPath: "~/projects/afh", createdAt: new Date().toISOString(),
      approval: {
        type: "file_edit", summary: "Edit src/auth.ts", fullContent: "",
        files: [
          { path: "src/auth.ts", diff: "@@ -10,5 +10,7 @@\n-async function validateToken(token) {\n+async function validateToken(token): Promise<boolean> {\n   const decoded = jwt.verify(token, SECRET);\n+  if (!decoded) return false;\n   return true;\n }", linesAdded: 2, linesRemoved: 1 },
          { path: "src/middleware.ts", diff: "@@ -3,3 +3,5 @@\n import { validateToken } from './auth';\n+import { logger } from './utils';\n \n export async function authMiddleware(req, res, next) {\n+  logger.info('Auth check');\n   const token = req.headers.authorization;", linesAdded: 2, linesRemoved: 0 },
          { path: "tests/auth.test.ts", diff: "@@ -1,1 +1,8 @@\n+import { validateToken } from '../src/auth';\n+\n+describe('validateToken', () => {\n+  it('returns false for invalid token', async () => {\n+    expect(await validateToken('bad')).toBe(false);\n+  });\n+});", linesAdded: 7, linesRemoved: 0 },
        ],
      },
    },
    {
      id: "s3", slot: 2, name: "SNAP", agent: "gemini", status: "error",
      projectPath: "~/projects/snapopa", createdAt: new Date().toISOString(),
    },
    {
      id: "s4", slot: 3, name: "API", agent: "codex", status: "idle",
      projectPath: "~/projects/api", createdAt: new Date().toISOString(),
    },
  ];
  log("Mock data loaded (bridge not running)", "state");
  renderAll();
}

// ── Init ───────────────────────────────────────────────────────

connect();
setTimeout(() => {
  if (state.phase !== "connected" && state.agents.length === 0) loadMockData();
}, 2000);
