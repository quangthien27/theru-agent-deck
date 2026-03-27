#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOTNET_ROOT="/opt/homebrew/Cellar/dotnet@8/8.0.124/libexec"
export DOTNET_ROOT
export PATH="/opt/homebrew/Cellar/dotnet@8/8.0.124/bin:$HOME/.dotnet/tools:$PATH"

# ── Version: read from packages/vscode-extension/package.json ──
VERSION=$(node -p "require('$ROOT/packages/vscode-extension/package.json').version")
COMMIT=$(git -C "$ROOT" rev-parse --short HEAD)
TIMESTAMP=$(date +%Y%m%d-%H%M)
RELEASE_NAME="v${VERSION}-${TIMESTAMP}-${COMMIT}"
RELEASE_DIR="$ROOT/releases/$RELEASE_NAME"

echo "🔨 Building release: $RELEASE_NAME"
mkdir -p "$RELEASE_DIR"

# ── 1. Logi Plugin ──
echo "📦 Building Logi Plugin (Release)..."
cd "$ROOT/packages/logi-plugin/src"
dotnet build -c Release -v quiet

echo "📦 Packing .lplug4..."
logiplugintool pack "$ROOT/packages/logi-plugin/bin/Release" "$RELEASE_DIR/AgentDeck-${VERSION}.lplug4"

# ── 2. VS Code Extension ──
echo "📦 Building VS Code Extension..."
cd "$ROOT/packages/vscode-extension"
npm run compile --silent
npx @vscode/vsce package --allow-missing-repository -o "$RELEASE_DIR/agentdeck-${VERSION}.vsix" 2>&1 | tail -3

# ── 3. Version info ──
cat > "$RELEASE_DIR/BUILD_INFO.txt" <<EOF
Release:  $RELEASE_NAME
Version:  $VERSION
Commit:   $(git -C "$ROOT" rev-parse HEAD)
Date:     $(date -u +"%Y-%m-%d %H:%M:%S UTC")
Branch:   $(git -C "$ROOT" branch --show-current)

Files:
  AgentDeck-${VERSION}.lplug4  — Logi Plugin (double-click to install)
  agentdeck-${VERSION}.vsix    — VS Code Extension (Install from VSIX)

Install:
  Logi:  logiplugintool install AgentDeck-${VERSION}.lplug4
  VSCode: code --install-extension agentdeck-${VERSION}.vsix
  Windsurf: windsurf --install-extension agentdeck-${VERSION}.vsix
EOF

echo ""
echo "✅ Release built: $RELEASE_DIR"
echo "   📦 AgentDeck-${VERSION}.lplug4"
echo "   📦 agentdeck-${VERSION}.vsix"
echo ""
echo "To bump version before next release:"
echo "   npm version patch --prefix packages/vscode-extension --no-git-tag-version"
