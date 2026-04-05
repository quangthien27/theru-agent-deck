namespace Loupedeck.AgentDeckPlugin.Models
{
    using System;
    using System.Collections.Generic;

    public enum PluginPhase
    {
        Connecting,
        Connected,
        Disconnected
    }

    public class PluginState
    {
        /// Dial/roller ticks required per step — higher = less sensitive.
        public const Int32 DialStepThreshold = 10;

        public PluginPhase Phase { get; set; } = PluginPhase.Connecting;
        public List<AgentSession> Agents { get; set; } = new List<AgentSession>();
        public String SelectedAgentId { get; set; }
        public Boolean WorktreeEnabled { get; set; } = true;
        public String ThinkingOverride { get; set; } // null, "low", "medium", "high"
        public String ModeOverride { get; set; }    // null, "plan", "auto", "bypassPermissions"
        public String EffortOverride { get; set; }  // null, "low", "medium", "high", "max"
        public Int32 ConnectedWindowCount { get; set; }
        public Int32 RingScrollOffset { get; set; }
        public Int32 RingFileIndex { get; set; }

        public AgentSession GetAgentBySlot(Int32 slot)
        {
            return this.Agents.Find(a => a.Slot == slot);
        }

        public AgentSession GetSelectedAgent()
        {
            if (this.SelectedAgentId == null)
            {
                return null;
            }

            return this.Agents.Find(a => a.Id == this.SelectedAgentId);
        }

        public Int32 WaitingCount()
        {
            var count = 0;
            foreach (var agent in this.Agents)
            {
                if (agent.Status == AgentStatus.Waiting)
                {
                    count++;
                }
            }

            return count;
        }
    }
}
