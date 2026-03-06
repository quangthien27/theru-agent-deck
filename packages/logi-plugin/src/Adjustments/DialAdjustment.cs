namespace Loupedeck.AgentDeckPlugin.Adjustments
{
    using System;
    using Loupedeck.AgentDeckPlugin.Models;

    public class DialAdjustment : PluginDynamicAdjustment
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public DialAdjustment()
            : base("Agent Dial", "Scroll through agent details", "Navigation", hasReset: true)
        {
        }

        protected override void ApplyAdjustment(String actionParameter, Int32 diff)
        {
            // Dial rotation: scroll within current view (diff lines, history)
            this.Plugin.State.RingScrollOffset += diff;
            this.AdjustmentValueChanged();
        }

        protected override void RunCommand(String actionParameter)
        {
            // Dial press: reset scroll
            this.Plugin.State.RingScrollOffset = 0;
            this.AdjustmentValueChanged();
        }

        protected override String GetAdjustmentValue(String actionParameter)
        {
            var agent = this.Plugin.State.GetSelectedAgent();
            if (agent == null)
            {
                return "No agent";
            }

            return agent.Status switch
            {
                AgentStatus.Waiting => $"APPROVE - {agent.Name}",
                AgentStatus.Working => $"Working - {agent.Name}",
                AgentStatus.Idle => $"Idle - {agent.Name}",
                AgentStatus.Error => $"Error - {agent.Name}",
                _ => agent.Name
            };
        }
    }
}
