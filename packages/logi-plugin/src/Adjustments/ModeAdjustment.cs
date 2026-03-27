namespace Loupedeck.AgentDeckPlugin.Adjustments
{
    using System;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Dial action to cycle permission mode on the selected agent.
    /// Sends Shift+Tab which cycles ask → auto → plan in Claude Code and Codex.
    public class ModeAdjustment : PluginDynamicAdjustment
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        private static readonly String[] Modes = { "ask", "auto", "plan" };
        private Int32 _modeIndex = 0; // default: ask

        public ModeAdjustment()
            : base("Permission Mode", "Cycle agent permission mode", "Controls", hasReset: false)
        {
        }

        protected override void ApplyAdjustment(String actionParameter, Int32 diff)
        {
            var agentId = this.Plugin.State.SelectedAgentId;
            if (String.IsNullOrEmpty(agentId)) return;

            // Each rotation step sends one Shift+Tab to cycle mode
            var steps = Math.Abs(diff);
            for (var i = 0; i < steps; i++)
            {
                _ = this.Plugin.BridgeClient.SendCommand(agentId, "cycle_mode");
            }

            // Track mode locally (best-effort, may drift)
            _modeIndex = (_modeIndex + diff) % Modes.Length;
            if (_modeIndex < 0) _modeIndex += Modes.Length;

            this.AdjustmentValueChanged();
        }

        protected override void RunCommand(String actionParameter)
        {
            // Press: send one Shift+Tab
            var agentId = this.Plugin.State.SelectedAgentId;
            if (!String.IsNullOrEmpty(agentId))
            {
                _ = this.Plugin.BridgeClient.SendCommand(agentId, "cycle_mode");
                _modeIndex = (_modeIndex + 1) % Modes.Length;
            }
            this.AdjustmentValueChanged();
        }

        protected override String GetAdjustmentValue(String actionParameter)
        {
            var agent = this.Plugin.State.GetSelectedAgent();
            var name = agent?.Name ?? "No agent";
            return $"{name} · {Modes[_modeIndex]}";
        }
    }
}
