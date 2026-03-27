namespace Loupedeck.AgentDeckPlugin.Adjustments
{
    using System;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Dial action to cycle effort level on the selected agent.
    /// Claude Code supports /effort slash command (low, medium, high).
    public class EffortAdjustment : PluginDynamicAdjustment
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        private static readonly String[] Levels = { "low", "medium", "high" };
        private Int32 _levelIndex = 1; // default: medium

        public EffortAdjustment()
            : base("Effort Level", "Cycle agent effort level", "Controls", hasReset: false)
        {
        }

        protected override void ApplyAdjustment(String actionParameter, Int32 diff)
        {
            // Rotate: cycle effort level
            _levelIndex = (_levelIndex + diff) % Levels.Length;
            if (_levelIndex < 0) _levelIndex += Levels.Length;

            var agentId = this.Plugin.State.SelectedAgentId;
            if (!String.IsNullOrEmpty(agentId))
            {
                _ = this.Plugin.BridgeClient.SendSkill(agentId, "custom", $"/effort {Levels[_levelIndex]}");
            }

            this.AdjustmentValueChanged();
        }

        protected override void RunCommand(String actionParameter)
        {
            // Press: reset to medium
            _levelIndex = 1;

            var agentId = this.Plugin.State.SelectedAgentId;
            if (!String.IsNullOrEmpty(agentId))
            {
                _ = this.Plugin.BridgeClient.SendSkill(agentId, "custom", "/effort medium");
            }

            this.AdjustmentValueChanged();
        }

        protected override String GetAdjustmentValue(String actionParameter)
        {
            var agent = this.Plugin.State.GetSelectedAgent();
            var name = agent?.Name ?? "No agent";
            return $"{name} · {Levels[_levelIndex]}";
        }
    }
}
