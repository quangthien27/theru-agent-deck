# CLAUDE.md - AgentDeck Project Guide

## Project Overview

AgentDeck is a Logitech MX Creative Console plugin that provides a physical control surface for managing multiple AI coding agents (starting with Claude Code). It transforms the LCD keypad into a mission control dashboard showing agent status, and enables one-tap approvals, dial-based navigation, and haptic notifications.

**Key Differentiator:** Multi-session orchestration. Unlike single-agent tools (Conductor, etc.), AgentDeck manages 3+ simultaneous Claude Code sessions with visual status, priority routing, and unified control.

## SDK Language Choice

### Research Findings (March 2026)

| Aspect | C# (.NET) | Node.js/TypeScript |
|--------|-----------|-------------------|
| **Platform** | ✅ Windows + macOS | ⚠️ Windows only |
| **Features** | Full ("advanced features") | "Simple development" |
| **Haptics** | ✅ Documented | ❓ Unclear |
| **Maturity** | Established | New (v0.1.1) |

**Decision:** Use **C# for cross-platform support** (required for macOS development). Node.js SDK is Windows-only with macOS "coming in the future."

### Simplified Architecture

Since we must use C# anyway, we can **eliminate the separate Bridge Service** and build everything in the plugin:

```
┌──────────────────────────────────────────────────────────────────┐
│                        Developer Machine                          │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │ Terminal 1  │  │ Terminal 2  │  │ Terminal 3  │               │
│  │ Claude Code │  │ Claude Code │  │ Claude Code │               │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘               │
│         │                │                │                       │
│         └────────────────┼────────────────┘                       │
│                          │ (tmux/PTY monitoring)                  │
│                          ▼                                        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              AgentDeck Plugin (C# / .NET 8)                 │  │
│  │                                                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │   Terminal   │  │    State     │  │   Checkpoint     │  │  │
│  │  │   Monitor    │  │   Manager    │  │   Manager (Git)  │  │  │
│  │  │  tmux/PTY    │  │  Detection   │  │  Stash/Restore   │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │    Agent     │  │    Cost      │  │   Orchestration  │  │  │
│  │  │   Parsers    │  │   Tracker    │  │   & Priority     │  │  │
│  │  │ Claude/Aider │  │  Token/$     │  │   Management     │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │    LCD       │  │   Haptics    │  │   Actions        │  │  │
│  │  │   Renderer   │  │   Manager    │  │   & Dial         │  │  │
│  │  │  Rich Status │  │  Attention   │  │   Handlers       │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │  │
│  └─────────────────────────────┬──────────────────────────────┘  │
└────────────────────────────────┼──────────────────────────────────┘
                                 ▼
                     MX Creative Console + MX Master 4
```

**Benefits of unified architecture:**
- Single process to install/manage
- No WebSocket complexity
- Faster state updates (no IPC)
- Simpler deployment (.lplug4 file only)

## Directory Structure

```
agentdeck/
├── CLAUDE.md                    # This file
├── README.md                    # Project documentation  
├── LICENSE                      # MIT License
│
├── src/                         # Plugin source (C# / .NET 8)
│   ├── AgentDeck.sln
│   ├── AgentDeck/
│   │   ├── AgentDeck.csproj
│   │   ├── Plugin.cs            # Main plugin entry
│   │   │
│   │   ├── Terminal/            # Terminal monitoring
│   │   │   ├── ITerminalAdapter.cs      # Adapter interface
│   │   │   ├── TmuxAdapter.cs           # tmux session monitoring
│   │   │   ├── PTYAdapter.cs            # Direct PTY (Windows)
│   │   │   └── TerminalManager.cs       # Manages multiple adapters
│   │   │
│   │   ├── Agents/              # Agent parsing & state
│   │   │   ├── IAgentParser.cs          # Parser interface
│   │   │   ├── ClaudeCodeParser.cs      # Claude Code patterns
│   │   │   ├── AiderParser.cs           # Aider patterns (future)
│   │   │   ├── AgentState.cs            # State machine
│   │   │   └── AgentSession.cs          # Session data model
│   │   │
│   │   ├── Orchestration/       # Multi-agent management
│   │   │   ├── SessionOrchestrator.cs   # Priority & routing
│   │   │   ├── CheckpointManager.cs     # Git stash/restore
│   │   │   └── CostTracker.cs           # Token & cost tracking
│   │   │
│   │   ├── Actions/             # Logi Actions SDK commands
│   │   │   ├── AgentSlotAction.cs       # Agent 1/2/3 buttons
│   │   │   ├── ApproveAction.cs         # Yes button
│   │   │   ├── RejectAction.cs          # No button
│   │   │   ├── PauseAction.cs           # Pause button
│   │   │   ├── UndoAction.cs            # Undo button
│   │   │   ├── DiffAction.cs            # Diff button
│   │   │   └── NewTaskAction.cs         # New task button
│   │   │
│   │   ├── Adjustments/         # Dial controls
│   │   │   └── NavigateAdjustment.cs    # Context-aware dial
│   │   │
│   │   ├── Display/             # LCD rendering
│   │   │   ├── LCDRenderer.cs           # Button rendering
│   │   │   ├── ButtonState.cs           # Visual state model
│   │   │   └── Icons.cs                 # Embedded icons
│   │   │
│   │   ├── Haptics/             # Haptic feedback
│   │   │   ├── HapticsManager.cs        # Pattern management
│   │   │   └── HapticPatterns.cs        # Predefined patterns
│   │   │
│   │   └── Config/              # Configuration
│   │       ├── Settings.cs              # User settings
│   │       └── Constants.cs             # App constants
│   │
│   └── AgentDeck.Tests/         # Unit tests
│       ├── ParserTests.cs
│       ├── StateTests.cs
│       └── MockTerminal.cs
│
├── assets/                      # Shared assets
│   ├── icons/                   # PNG icons for LCD (80x80)
│   │   ├── agent-idle.png
│   │   ├── agent-working.png
│   │   ├── agent-waiting.png
│   │   ├── agent-error.png
│   │   ├── approve.png
│   │   ├── reject.png
│   │   └── ...
│   ├── mockups/                 # Design mockups
│   └── logo/                    # AgentDeck branding
│
└── docs/                        # Documentation
    ├── setup.md                 # Installation guide
    ├── development.md           # Development guide
    └── patterns.md              # Claude Code pattern reference
```

## Key Data Models

### AgentSession

```csharp
public class AgentSession
{
    public string Id { get; set; }                    // Unique session ID
    public int Slot { get; set; }                     // Keypad slot (0, 1, 2)
    public string TerminalId { get; set; }            // Terminal/tmux pane ID
    public AgentStatus Status { get; set; }           // Current status
    public string TaskLabel { get; set; }             // Max 8 chars for LCD
    public string TaskFull { get; set; }              // Full description
    public List<string> FilesModified { get; set; }   // Modified files
    public int TokensUsed { get; set; }               // Token count
    public decimal CostEstimate { get; set; }         // Estimated $ cost
    public DateTime LastActivity { get; set; }        // Last update
    public TimeSpan WaitingDuration => Status == AgentStatus.Waiting 
        ? DateTime.Now - LastActivity : TimeSpan.Zero;
    public ApprovalRequest? PendingApproval { get; set; }
}

public enum AgentStatus
{
    Offline,    // Not connected
    Idle,       // Ready for input (green)
    Working,    // Processing (yellow)
    Waiting,    // Needs approval (red)
    Error       // Error state (red flash)
}

public class ApprovalRequest
{
    public ApprovalType Type { get; set; }
    public string Summary { get; set; }
    public string[] Options { get; set; }
}

public enum ApprovalType
{
    FileEdit,
    Command,
    Question
}
```

### LCD Button State

```csharp
public class ButtonState
{
    public int Slot { get; set; }
    
    // Visual
    public Color BackgroundColor { get; set; }
    public string StatusIcon { get; set; }           // Icon asset name
    public string TaskLabel { get; set; }            // Max 8 chars
    
    // Rich indicators (unique to AgentDeck)
    public int? ProgressPercent { get; set; }        // 0-100 progress ring
    public CostLevel? CostIndicator { get; set; }    // Token usage level
    public int? FileCount { get; set; }              // Files modified badge
    public int? WaitingSeconds { get; set; }         // Shows urgency
    
    // Animation
    public bool Pulse { get; set; }                  // Pulsing for attention
    public bool Flash { get; set; }                  // Flash on state change
}

public enum CostLevel { Low, Medium, High }
```

## Claude Code Output Patterns

### Detection Patterns (Regex)

```csharp
public static class ClaudeCodePatterns
{
    // Thinking/Working states
    public static readonly Regex[] Thinking = new[]
    {
        new Regex(@"[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]"),           // Spinner characters
        new Regex(@"Thinking\.\.\.", RegexOptions.IgnoreCase),
        new Regex(@"Analyzing\.\.\.", RegexOptions.IgnoreCase),
        new Regex(@"Reading\s+\d+\s+files", RegexOptions.IgnoreCase),
    };
    
    // Approval needed
    public static readonly Regex[] Approval = new[]
    {
        new Regex(@"Do you want to (?:apply|run|proceed)", RegexOptions.IgnoreCase),
        new Regex(@"\[Y/n\]"),
        new Regex(@"\[y/N\]"),
        new Regex(@"Allow (?:edit|command|execution)", RegexOptions.IgnoreCase),
        new Regex(@"Approve\?", RegexOptions.IgnoreCase),
    };
    
    // Completion
    public static readonly Regex[] Completed = new[]
    {
        new Regex(@"✓ (?:Done|Complete|Applied|Finished)", RegexOptions.IgnoreCase),
        new Regex(@"Changes applied", RegexOptions.IgnoreCase),
        new Regex(@"Task complete", RegexOptions.IgnoreCase),
    };
    
    // Error
    public static readonly Regex[] Error = new[]
    {
        new Regex(@"✗ Error", RegexOptions.IgnoreCase),
        new Regex(@"^Error:", RegexOptions.IgnoreCase | RegexOptions.Multiline),
        new Regex(@"^Failed:", RegexOptions.IgnoreCase | RegexOptions.Multiline),
        new Regex(@"Aborted", RegexOptions.IgnoreCase),
    };
    
    // Idle (prompt visible)
    public static readonly Regex[] Idle = new[]
    {
        new Regex(@"^>\s*$", RegexOptions.Multiline),
        new Regex(@"^claude>\s*$", RegexOptions.Multiline),
        new Regex(@"\n>\s*$"),
    };
    
    // Cost tracking (unique feature)
    public static readonly Regex TokenCount = new Regex(@"Tokens?:\s*([\d,]+)", RegexOptions.IgnoreCase);
    public static readonly Regex CostDisplay = new Regex(@"Cost:\s*\$([\d.]+)", RegexOptions.IgnoreCase);
    public static readonly Regex ContextSize = new Regex(@"Context:\s*([\d.]+)k", RegexOptions.IgnoreCase);
}
```

## Multi-Agent Orchestration (Competitive Advantage)

### Priority System

```csharp
public class SessionOrchestrator
{
    public AgentSession? GetHighestPriority(IEnumerable<AgentSession> agents)
    {
        // Priority order: Waiting > Error > Working (longest) > Idle
        return agents
            .Where(a => a.Status != AgentStatus.Offline)
            .OrderBy(a => a.Status switch
            {
                AgentStatus.Waiting => 0,
                AgentStatus.Error => 1,
                AgentStatus.Working => 2,
                AgentStatus.Idle => 3,
                _ => 4
            })
            .ThenByDescending(a => a.WaitingDuration)  // Longest waiting first
            .FirstOrDefault();
    }
    
    public FocusSuggestion? SuggestNextFocus(IEnumerable<AgentSession> agents)
    {
        var waiting = agents.Where(a => a.Status == AgentStatus.Waiting).ToList();
        if (waiting.Count > 0)
        {
            return new FocusSuggestion
            {
                AgentId = waiting.OrderByDescending(a => a.WaitingDuration).First().Id,
                Reason = FocusReason.ApprovalNeeded,
                Urgency = waiting.Count > 1 ? Urgency.High : Urgency.Medium
            };
        }
        
        var errored = agents.FirstOrDefault(a => a.Status == AgentStatus.Error);
        if (errored != null)
        {
            return new FocusSuggestion
            {
                AgentId = errored.Id,
                Reason = FocusReason.Error,
                Urgency = Urgency.High
            };
        }
        
        return null;  // No urgent focus needed
    }
}
```

### Haptic Patterns (Attention Routing)

```csharp
public static class HapticPatterns
{
    // Single agent needs approval
    public static readonly HapticPattern SingleApproval = 
        new("short-short-short", duration: 300);
    
    // Multiple agents waiting (more urgent)
    public static readonly HapticPattern MultipleApproval = 
        new("long-short-long", duration: 500);
    
    // Task completed
    public static readonly HapticPattern TaskComplete = 
        new("long", duration: 200);
    
    // Error occurred
    public static readonly HapticPattern Error = 
        new("rapid", duration: 400);
    
    // Cost threshold hit
    public static readonly HapticPattern CostWarning = 
        new("short-long", duration: 350);
}
```

### Git Checkpoints (Match Conductor, Multi-Agent)

```csharp
public class CheckpointManager
{
    public async Task<Checkpoint> CreateCheckpoint(AgentSession agent, string workingDir)
    {
        var stashRef = await ExecuteGit(workingDir, "stash create");
        
        return new Checkpoint
        {
            Id = Guid.NewGuid().ToString("N")[..8],
            AgentId = agent.Id,
            Timestamp = DateTime.UtcNow,
            GitRef = stashRef,
            FilesModified = agent.FilesModified.ToList(),
            TaskDescription = agent.TaskFull,
            TokenCount = agent.TokensUsed
        };
    }
    
    public async Task<bool> RestoreCheckpoint(Checkpoint checkpoint, string workingDir)
    {
        if (string.IsNullOrEmpty(checkpoint.GitRef)) return false;
        
        await ExecuteGit(workingDir, $"stash apply {checkpoint.GitRef}");
        return true;
    }
    
    // Unified timeline across all agents (unique to AgentDeck)
    public IEnumerable<Checkpoint> GetTimeline(int limit = 20)
    {
        return _checkpoints
            .OrderByDescending(c => c.Timestamp)
            .Take(limit);
    }
}
```

## Agent Adapter System (Extensibility)

```csharp
public interface IAgentParser
{
    string AgentName { get; }                         // "Claude Code", "Aider"
    AgentStatus? ParseOutput(string line);            // Detect status from output
    string ApproveCommand { get; }                    // What to send for "yes"
    string RejectCommand { get; }                     // What to send for "no"
    string InterruptCommand { get; }                  // Ctrl+C equivalent
}

public class ClaudeCodeParser : IAgentParser
{
    public string AgentName => "Claude Code";
    public string ApproveCommand => "y\n";
    public string RejectCommand => "n\n";
    public string InterruptCommand => "\x03";         // Ctrl+C
    
    public AgentStatus? ParseOutput(string line)
    {
        if (ClaudeCodePatterns.Approval.Any(p => p.IsMatch(line)))
            return AgentStatus.Waiting;
        if (ClaudeCodePatterns.Thinking.Any(p => p.IsMatch(line)))
            return AgentStatus.Working;
        if (ClaudeCodePatterns.Completed.Any(p => p.IsMatch(line)))
            return AgentStatus.Idle;
        if (ClaudeCodePatterns.Error.Any(p => p.IsMatch(line)))
            return AgentStatus.Error;
        if (ClaudeCodePatterns.Idle.Any(p => p.IsMatch(line)))
            return AgentStatus.Idle;
        return null;  // No status change detected
    }
}

// Ready for future expansion
public class AiderParser : IAgentParser { /* ... */ }
public class CodexParser : IAgentParser { /* ... */ }
```

## Terminal Adapters

```csharp
public interface ITerminalAdapter
{
    string AdapterType { get; }                       // "tmux", "pty", "iterm"
    Task<bool> Connect(string identifier);
    Task Disconnect();
    event Action<string> OnOutput;                    // Terminal output stream
    Task SendInput(string text);
    bool IsConnected { get; }
}

// Primary adapter: tmux (works on macOS and Linux, WSL on Windows)
public class TmuxAdapter : ITerminalAdapter
{
    public string AdapterType => "tmux";
    
    public async Task<bool> Connect(string paneId)
    {
        // Monitor tmux pane output via `tmux capture-pane` polling
        // or `tmux pipe-pane` for streaming
    }
    
    public async Task SendInput(string text)
    {
        // Send keystrokes via `tmux send-keys`
        await ExecuteCommand($"tmux send-keys -t {_paneId} '{text}'");
    }
}

// Windows-native adapter (for non-WSL scenarios)
public class PTYAdapter : ITerminalAdapter
{
    public string AdapterType => "pty";
    // Use ConPTY on Windows for direct terminal access
}
```

## Development Commands

### Plugin Development

```bash
# Prerequisites
# - .NET 8.0 SDK
# - Logi Options+ installed
# - MX Creative Console connected

# Clone and build
git clone https://github.com/pinkpixel-dev/agentdeck.git
cd agentdeck/src

# Restore dependencies
dotnet restore

# Build
dotnet build

# The build creates a .link file that Logi Options+ detects
# Restart Logi Options+ to load the plugin

# Run tests
dotnet test

# Package for distribution
# (Use LogiPluginTool from Logitech Developer site)
logiplugintool package AgentDeck
# Creates AgentDeck.lplug4
```

### Testing Without Hardware

```bash
# Run unit tests with mock terminal
dotnet test --filter "Category=UnitTest"

# Run integration tests (requires Logi Options+ but no hardware)
dotnet test --filter "Category=Integration"

# Use the mock terminal to replay Claude Code output
dotnet run --project AgentDeck.Tests -- --replay samples/session-approval.txt
```

## Environment Setup

### Prerequisites

- .NET 8.0 SDK
- Logi Options+ (latest version)
- MX Creative Console (for hardware testing)
- tmux (for terminal monitoring on macOS/Linux)
- Git (for checkpoint feature)

### First-Time Setup

1. Install Logi Options+ from Logitech
2. Connect MX Creative Console
3. Clone this repository
4. Run `dotnet build` in the `src/` directory
5. Restart Logi Options+ to detect the plugin
6. Configure tmux sessions for Claude Code monitoring

### tmux Configuration for AgentDeck

```bash
# Create a named tmux session for Claude Code agents
tmux new-session -s agentdeck -n agent1

# Create additional panes/windows
tmux new-window -t agentdeck -n agent2
tmux new-window -t agentdeck -n agent3

# AgentDeck monitors these pane IDs:
# agentdeck:agent1, agentdeck:agent2, agentdeck:agent3
```

## Build Phase Deliverables (Due April 1st)

- [ ] Working plugin that monitors Claude Code via tmux
- [ ] LCD button updates showing agent status
- [ ] At least 3 agent slots functional
- [ ] Approve/Reject buttons working
- [ ] Basic haptic notifications
- [ ] Git checkpoint creation (before approvals)
- [ ] 3-minute demo video
- [ ] Public GitHub repository

## Competitive Advantages Summary

| Feature | AgentDeck | Conductor | Claw Control |
|---------|-----------|-----------|--------------|
| Multi-session (3+) | ✅ | ❌ (single) | ⚠️ (types, not sessions) |
| CLI/Terminal focus | ✅ | ❌ (VS Code) | ❌ (abstract) |
| Git checkpoints | ✅ | ✅ | ❌ |
| Cost tracking | ✅ | ❌ | ❌ |
| Priority routing | ✅ | ❌ | ❌ |
| Rich LCD display | ✅ | ⚠️ (basic) | ⚠️ (basic) |
| Extensible parsers | ✅ | ❌ | ⚠️ |

## Resources

- [Logi Actions SDK Documentation](https://logitech.github.io/actions-sdk-docs/)
- [Actions SDK C# Getting Started](https://logitech.github.io/actions-sdk-docs/csharp/plugin-development/introduction/)
- [Haptics Guide](https://logitech.github.io/actions-sdk-docs/csharp/haptics/haptics-overview/)
- [Logi Developer Discord](https://discord.gg/ptV2BfHCmm)
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)

## Notes for Development

1. **State Machine**: Be conservative with state transitions. False positives (thinking agent is waiting when it's not) are worse than slight delays.

2. **LCD Updates**: Don't spam updates. Batch changes and update at most every 100ms.

3. **tmux Monitoring**: Use `tmux capture-pane -p` for polling, or `tmux pipe-pane` for streaming. Polling at 200ms intervals is sufficient.

4. **Haptics**: Use sparingly. Only for state changes that need attention, not continuous feedback.

5. **Git Checkpoints**: Create checkpoints automatically before every approval, not after. This lets users undo if they approve by mistake.

6. **Testing**: Create mock terminal sessions that replay Claude Code output. Store sample outputs in `tests/samples/`.
