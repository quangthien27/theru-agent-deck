"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.openSimulatorWebview = openSimulatorWebview;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let panel;
function openSimulatorWebview(context) {
    // If panel already exists, reveal it
    if (panel) {
        panel.reveal(vscode.ViewColumn.Beside);
        return;
    }
    panel = vscode.window.createWebviewPanel('agentdeck.simulator', 'AgentDeck Simulator', vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });
    panel.webview.html = getWebviewContent(context);
    panel.onDidDispose(() => {
        panel = undefined;
    }, null, context.subscriptions);
}
function getWebviewContent(context) {
    // Try to load from simulator package (sibling directory)
    const extDir = context.extensionPath;
    const simulatorDir = path.resolve(extDir, '..', 'simulator');
    let css = '';
    let js = '';
    const cssPath = path.join(simulatorDir, 'style.css');
    const jsPath = path.join(simulatorDir, 'simulator.js');
    if (fs.existsSync(cssPath) && fs.existsSync(jsPath)) {
        css = fs.readFileSync(cssPath, 'utf-8');
        js = fs.readFileSync(jsPath, 'utf-8');
    }
    else {
        // Fallback: bundled copies or error
        return `<html><body style="color:#ccc;padding:24px;font-family:monospace;">
      <h2>Simulator files not found</h2>
      <p>Expected at: ${simulatorDir}</p>
      <p>Make sure packages/simulator exists alongside the extension.</p>
    </body></html>`;
    }
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentDeck Simulator</title>
  <style>${css}</style>
</head>
<body>
  <div class="simulator">
    <header class="topbar">
      <h1>AgentDeck Simulator</h1>
      <div class="connection" id="connection">
        <span class="dot"></span>
        <span class="label">Disconnected</span>
      </div>
    </header>

    <div class="console-layout">
      <div class="keypad">
        <div class="keypad-grid">
          <button class="lcd-btn"></button>
          <button class="lcd-btn"></button>
          <button class="lcd-btn"></button>
          <button class="lcd-btn"></button>
          <button class="lcd-btn"></button>
          <button class="lcd-btn"></button>
          <button class="lcd-btn ctrl-btn"></button>
          <button class="lcd-btn ctrl-btn"></button>
          <button class="lcd-btn ctrl-btn"></button>
        </div>
      </div>

      <div class="dialpad">
        <div class="dialpad-grid">
          <button class="dial-btn" id="btn-undo">KILL</button>
          <button class="dial-btn" id="btn-pause">PAUSE</button>
          <div class="dial-area">
            <div class="dial" id="dial">
              <div class="dial-knob"></div>
              <div class="dial-label" id="dial-label">No agent</div>
            </div>
          </div>
          <div class="roller-area">
            <button class="roller-btn" id="roller-up">&#9650;</button>
            <div class="roller-label" id="roller-label"></div>
            <button class="roller-btn" id="roller-down">&#9660;</button>
          </div>
          <button class="dial-btn yes" id="btn-yes">YES</button>
          <button class="dial-btn no" id="btn-no">NO</button>
        </div>
      </div>
    </div>

    <div class="ring-overlay" id="ring-overlay">
      <div class="ring-panel" id="ring-panel">
        <div class="ring-header" id="ring-header"></div>
        <div class="ring-content" id="ring-content"></div>
        <div class="ring-footer" id="ring-footer"></div>
      </div>
    </div>

    <div class="log-panel">
      <div class="log-header">
        <span>Event Log</span>
        <button id="log-clear">Clear</button>
      </div>
      <div class="log-content" id="log-content"></div>
    </div>
  </div>

  <script>${js}</script>
</body>
</html>`;
}
//# sourceMappingURL=simulator-webview.js.map