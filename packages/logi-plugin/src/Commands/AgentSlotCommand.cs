namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Threading.Tasks;
    using Loupedeck.AgentDeckPlugin.Models;
    using Loupedeck.AgentDeckPlugin.Services;

    public class AgentSlotCommand : PluginDynamicCommand
    {
        private const Int32 ImageSize = 80;
        private const Int32 MaxSlots = 6;

        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public AgentSlotCommand()
            : base("Agent Slot", "Agent session slot", "Agents")
        {
            for (var i = 0; i < MaxSlots; i++)
            {
                this.AddParameter($"slot_{i}", $"Agent Slot {i + 1}", $"Agent slot {i + 1}");
            }
        }

        protected override void RunCommand(String actionParameter)
        {
            var slot = ParseSlot(actionParameter);
            if (slot < 0)
            {
                return;
            }

            var agent = this.Plugin.State.GetAgentBySlot(slot);
            if (agent == null)
            {
                return;
            }

            // Tap: select agent (show in ring)
            this.Plugin.State.SelectedAgentId = agent.Id;
            this.Plugin.State.RingScrollOffset = 0;
            this.Plugin.State.RingFileIndex = 0;
            this.Plugin.RefreshAll();
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var slot = ParseSlot(actionParameter);
            if (slot < 0)
            {
                return null;
            }

            using var builder = new BitmapBuilder(ImageSize, ImageSize);

            var agent = this.Plugin.State.GetAgentBySlot(slot);

            if (agent == null)
            {
                // Empty slot
                builder.Clear(new BitmapColor(30, 30, 30));
                builder.DrawText("--", 0, 25, ImageSize, 30, new BitmapColor(80, 80, 80), 14);
                return builder.ToImage();
            }

            var bgColor = GetStatusColor(agent.Status);
            builder.Clear(bgColor);

            // Agent name (top)
            builder.DrawText(
                TruncateName(agent.Name, 6),
                0, 8, ImageSize, 20,
                new BitmapColor(255, 255, 255), 16);

            // Status text (bottom)
            var statusText = GetStatusText(agent);
            builder.DrawText(
                statusText,
                0, 45, ImageSize, 20,
                new BitmapColor(255, 255, 255, 180), 11);

            // Agent type indicator (small, bottom-left corner)
            builder.DrawText(
                agent.Agent?.ToUpperInvariant()?[..Math.Min(2, agent.Agent.Length)] ?? "",
                4, 62, 30, 14,
                new BitmapColor(255, 255, 255, 120), 9);

            return builder.ToImage();
        }

        private static BitmapColor GetStatusColor(AgentStatus status)
        {
            return status switch
            {
                AgentStatus.Idle => new BitmapColor(30, 120, 50),     // Green
                AgentStatus.Working => new BitmapColor(160, 140, 20), // Yellow
                AgentStatus.Waiting => new BitmapColor(180, 40, 40),  // Red
                AgentStatus.Error => new BitmapColor(150, 30, 30),    // Dark red
                _ => new BitmapColor(50, 50, 50)                      // Gray
            };
        }

        private static String GetStatusText(AgentSession agent)
        {
            return agent.Status switch
            {
                AgentStatus.Idle => "idle",
                AgentStatus.Working => "working...",
                AgentStatus.Waiting => "APPROVE!",
                AgentStatus.Error => "error",
                _ => "offline"
            };
        }

        private static String TruncateName(String name, Int32 maxLen)
        {
            if (String.IsNullOrEmpty(name))
            {
                return "?";
            }

            return name.Length <= maxLen ? name : name[..maxLen];
        }

        private static Int32 ParseSlot(String actionParameter)
        {
            if (String.IsNullOrEmpty(actionParameter) || !actionParameter.StartsWith("slot_"))
            {
                return -1;
            }

            if (Int32.TryParse(actionParameter.AsSpan(5), out var slot))
            {
                return slot;
            }

            return -1;
        }
    }
}
