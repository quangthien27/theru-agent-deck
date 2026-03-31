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
        private Int32 _accumulated = 0;

        public ModeAdjustment()
            : base("Permission Mode", "Cycle agent permission mode", "Controls", hasReset: false)
        {
        }

        protected override void ApplyAdjustment(String actionParameter, Int32 diff)
        {
            _accumulated += diff;
            if (Math.Abs(_accumulated) < PluginState.DialStepThreshold) return;
            var steps = Math.Sign(_accumulated);
            _accumulated = 0;

            var agentId = this.Plugin.State.SelectedAgentId;
            if (String.IsNullOrEmpty(agentId)) return;

            var absSteps = Math.Abs(steps);
            for (var i = 0; i < absSteps; i++)
            {
                _ = this.Plugin.BridgeClient.SendCommand(agentId, "cycle_mode");
            }

            _modeIndex = (_modeIndex + steps) % Modes.Length;
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
