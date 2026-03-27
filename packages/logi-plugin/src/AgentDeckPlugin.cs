namespace Loupedeck.AgentDeckPlugin
{
    using System;
    using Loupedeck.AgentDeckPlugin.Folders;
    using Loupedeck.AgentDeckPlugin.Models;
    using Loupedeck.AgentDeckPlugin.Services;

    public class AgentDeckPlugin : Plugin
    {
        public override Boolean UsesApplicationApiOnly => true;
        public override Boolean HasNoApplication => true;

        internal PluginState State { get; private set; } = new PluginState();
        internal BridgeMultiClient BridgeClient { get; private set; }
        internal AgentDashboardFolder ActiveFolder { get; set; }

        private BridgeLauncher _bridgeLauncher;

        public AgentDeckPlugin()
        {
            PluginLog.Init(this.Log);
            PluginResources.Init(this.Assembly);
        }

        public override void Load()
        {
            PluginLog.Info("AgentDeck plugin loading...");

            // Check dependencies
            var deps = DependencyChecker.Check();
            if (!deps.AllReady)
            {
                PluginLog.Warning(
                    $"Dependencies: tmux={deps.TmuxInstalled}, agent-deck={deps.AgentDeckInstalled}");
            }

            // Start bridge (bundled binary)
            _bridgeLauncher = new BridgeLauncher();
            // TODO: resolve plugin directory for bundled bridge
            // _bridgeLauncher.Start(pluginDirectory);

            // Register haptic events for MX Master 4
            this.PluginEvents.AddEvent("agent_needs_input", "Agent Needs Input", "An agent requires user approval or input");
            this.PluginEvents.AddEvent("agent_completed", "Agent Completed", "An agent finished its task");
            this.PluginEvents.AddEvent("agent_error", "Agent Error", "An agent encountered an error");

            // Connect to bridge WebSocket (scans ports 9999-10008 for all open windows)
            this.BridgeClient = new BridgeMultiClient();

            this.BridgeClient.OnStateUpdate += (state) =>
            {
                var selectedId = this.State.SelectedAgentId;
                var worktreeEnabled = this.State.WorktreeEnabled;
                var windowCount = state.ConnectedWindowCount;
                this.State = state;
                this.State.SelectedAgentId = selectedId;
                this.State.WorktreeEnabled = worktreeEnabled;
                this.State.ConnectedWindowCount = windowCount;
                this.RefreshAll();
                this.NotifyDashboardFolders();
            };

            this.BridgeClient.OnAgentEvent += (agentId, eventType) =>
            {
                PluginLog.Info($"Agent event: {agentId} -> {eventType}");

                // Trigger haptic feedback on MX Master 4
                switch (eventType)
                {
                    case "needs_approval":
                        this.PluginEvents.RaiseEvent("agent_needs_input");
                        break;
                    case "completed":
                        this.PluginEvents.RaiseEvent("agent_completed");
                        break;
                    case "error":
                        this.PluginEvents.RaiseEvent("agent_error");
                        break;
                }
            };

            this.BridgeClient.OnSettingsUpdate += (worktreeEnabled) =>
            {
                this.State.WorktreeEnabled = worktreeEnabled;
                this.RefreshAll();
                this.NotifyDashboardFolders();
            };

            this.BridgeClient.OnConnected += () =>
            {
                this.State.Phase = PluginPhase.Connected;
                this.RefreshAll();
                // Request current settings
                _ = this.BridgeClient.SendGetSettings();
            };

            this.BridgeClient.OnDisconnected += () =>
            {
                this.State.Phase = PluginPhase.Disconnected;
                this.RefreshAll();
            };

            this.BridgeClient.Start();

            PluginLog.Info("AgentDeck plugin loaded");
        }

        public override void Unload()
        {
            PluginLog.Info("AgentDeck plugin unloading...");
            this.BridgeClient?.Dispose();
            _bridgeLauncher?.Dispose();
        }

        internal void RefreshAll()
        {
            this.OnPluginStatusChanged(
                Loupedeck.PluginStatus.Normal,
                this.State.Phase == PluginPhase.Connected ? "Connected" : "Disconnected");
        }

        private void NotifyDashboardFolders()
        {
            this.ActiveFolder?.OnStateChanged();
        }
    }
}
