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
        internal BridgeClient BridgeClient { get; private set; }
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

            // Connect to bridge WebSocket
            this.BridgeClient = new BridgeClient();

            this.BridgeClient.OnStateUpdate += (state) =>
            {
                var selectedId = this.State.SelectedAgentId;
                var worktreeEnabled = this.State.WorktreeEnabled;
                this.State = state;
                this.State.SelectedAgentId = selectedId;
                this.State.WorktreeEnabled = worktreeEnabled;
                this.RefreshAll();
                this.NotifyDashboardFolders();
            };

            this.BridgeClient.OnAgentEvent += (agentId, eventType) =>
            {
                PluginLog.Info($"Agent event: {agentId} -> {eventType}");
                // TODO: trigger haptics based on eventType
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
