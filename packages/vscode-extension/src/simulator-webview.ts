import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let panel: vscode.WebviewPanel | undefined;

export function openSimulatorWebview(context: vscode.ExtensionContext): void {
  // If panel already exists, reveal it
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'agentdeck.simulator',
    'AgentDeck Simulator',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.resolve(context.extensionPath, '..', 'simulator')),
      ],
    }
  );

  panel.webview.html = getWebviewContent(context);

  panel.onDidDispose(() => {
    panel = undefined;
  }, null, context.subscriptions);
}

function getWebviewContent(context: vscode.ExtensionContext): string {
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
  } else {
    // Fallback: bundled copies or error
    return `<html><body style="color:#ccc;padding:24px;font-family:monospace;">
      <h2>Simulator files not found</h2>
      <p>Expected at: ${simulatorDir}</p>
      <p>Make sure packages/simulator exists alongside the extension.</p>
    </body></html>`;
  }

  // Convert icon paths to webview URIs so images load inside the webview
  const iconsDir = path.join(simulatorDir, 'icons');
  if (fs.existsSync(iconsDir)) {
    const iconFiles = fs.readdirSync(iconsDir);
    for (const file of iconFiles) {
      const webviewUri = panel!.webview.asWebviewUri(vscode.Uri.file(path.join(iconsDir, file)));
      js = js.replace(new RegExp(`icons/${file.replace('.', '\\.')}`, 'g'), webviewUri.toString());
    }
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
          <button class="dial-btn" id="btn-undo">END</button>
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
