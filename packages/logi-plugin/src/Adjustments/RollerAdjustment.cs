namespace Loupedeck.AgentDeckPlugin.Adjustments
{
    using System;
    using Loupedeck.AgentDeckPlugin.Models;

    public class RollerAdjustment : PluginDynamicAdjustment
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public RollerAdjustment()
            : base("File Navigator", "Navigate between files in changeset", "Navigation", hasReset: false)
        {
        }

        protected override void ApplyAdjustment(String actionParameter, Int32 diff)
        {
            // Roller: navigate between files in approval changeset
            var agent = this.Plugin.State.GetSelectedAgent();
            if (agent?.Approval?.Files == null || agent.Approval.Files.Length == 0)
            {
                return;
            }

            var fileCount = agent.Approval.Files.Length;
            var newIndex = this.Plugin.State.RingFileIndex + diff;

            // Clamp to valid range
            if (newIndex < 0)
            {
                newIndex = 0;
            }
            else if (newIndex >= fileCount)
            {
                newIndex = fileCount - 1;
            }

            this.Plugin.State.RingFileIndex = newIndex;
            this.Plugin.State.RingScrollOffset = 0; // Reset scroll when switching files
            this.AdjustmentValueChanged();
        }

        protected override String GetAdjustmentValue(String actionParameter)
        {
            var agent = this.Plugin.State.GetSelectedAgent();
            if (agent?.Approval?.Files == null || agent.Approval.Files.Length == 0)
            {
                return "";
            }

            var idx = this.Plugin.State.RingFileIndex;
            var total = agent.Approval.Files.Length;
            return $"File {idx + 1}/{total}";
        }
    }
}
