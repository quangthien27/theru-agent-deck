namespace Loupedeck.AgentDeckPlugin.Adjustments
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Models;

    public class DialAdjustment : PluginDynamicAdjustment
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public DialAdjustment()
            : base("Agent Dial", "Rotate to cycle agents, press to focus terminal", "Navigation", hasReset: false)
        {
        }

        protected override void ApplyAdjustment(String actionParameter, Int32 diff)
        {
            var view = this.Plugin.ActiveFolder?.CurrentView ?? "dashboard";
            var agents = this.Plugin.State.Agents;

            switch (view)
            {
                case "dashboard":
                    // Rotate: cycle selected agent
                    if (agents.Count == 0) return;
                    var currentIdx = agents.FindIndex(a => a.Id == this.Plugin.State.SelectedAgentId);
                    if (currentIdx < 0) currentIdx = 0;
                    var newIdx = (currentIdx + diff) % agents.Count;
                    if (newIdx < 0) newIdx += agents.Count;
                    this.Plugin.State.SelectedAgentId = agents[newIdx].Id;
                    _ = this.Plugin.BridgeClient.SendOpenTerminal(agents[newIdx].Id);
                    this.Plugin.ActiveFolder?.RefreshExternal();
                    break;

                case "skills":
                    // Rotate: could scroll skill pages — unused for now
                    break;

                default:
                    this.Plugin.State.RingScrollOffset += diff;
                    break;
            }

            this.AdjustmentValueChanged();
        }

        protected override void RunCommand(String actionParameter)
        {
            var view = this.Plugin.ActiveFolder?.CurrentView ?? "dashboard";

            switch (view)
            {
                case "dashboard":
                    // Press: focus selected agent's terminal
                    var agentId = this.Plugin.State.SelectedAgentId;
                    if (!String.IsNullOrEmpty(agentId))
                    {
                        _ = this.Plugin.BridgeClient.SendOpenTerminal(agentId);
                    }
                    break;

                case "skills":
                    // Press: could send selected skill — unused for now
                    break;

                default:
                    this.Plugin.State.RingScrollOffset = 0;
                    break;
            }

            this.AdjustmentValueChanged();
        }

        protected override String GetAdjustmentValue(String actionParameter)
        {
            var agent = this.Plugin.State.GetSelectedAgent();
            if (agent == null) return "No agent";

            return agent.Status switch
            {
                AgentStatus.Waiting => $"INPUT - {agent.Name}",
                AgentStatus.Working => $"Working - {agent.Name}",
                AgentStatus.Idle => $"Ready - {agent.Name}",
                AgentStatus.Error => $"Error - {agent.Name}",
                _ => agent.Name
            };
        }
    }
}
