namespace Loupedeck.AgentDeckPlugin.Adjustments
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Models;

    public class RollerAdjustment : PluginDynamicAdjustment
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public RollerAdjustment()
            : base("Agent Roller", "Cycle through agents", "Navigation", hasReset: false)
        {
        }

        protected override void ApplyAdjustment(String actionParameter, Int32 diff)
        {
            var agents = this.Plugin.State.Agents;
            if (agents.Count == 0) return;

            // Roller always cycles through agents (dashboard context)
            var currentIdx = agents.FindIndex(a => a.Id == this.Plugin.State.SelectedAgentId);
            if (currentIdx < 0) currentIdx = 0;
            var newIdx = (currentIdx + diff) % agents.Count;
            if (newIdx < 0) newIdx += agents.Count;

            this.Plugin.State.SelectedAgentId = agents[newIdx].Id;
            _ = this.Plugin.BridgeClient.SendOpenTerminal(agents[newIdx].Id);
            this.Plugin.ActiveFolder?.RefreshExternal();
            this.AdjustmentValueChanged();
        }

        protected override String GetAdjustmentValue(String actionParameter)
        {
            var agent = this.Plugin.State.GetSelectedAgent();
            if (agent == null) return "No agent";

            var agents = this.Plugin.State.Agents;
            var idx = agents.FindIndex(a => a.Id == agent.Id);
            return $"{agent.Name} ({idx + 1}/{agents.Count})";
        }
    }
}
