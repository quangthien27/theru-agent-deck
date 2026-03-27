namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Focus the next waiting agent's terminal — triage queue navigation.
    public class NextWaitingCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public NextWaitingCommand()
            : base("Next Waiting", "Next Waiting — Focus next waiting agent", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            var waiting = this.Plugin.State.Agents.Where(a => a.Status == AgentStatus.Waiting).ToList();
            if (waiting.Count == 0) return;

            // Cycle: find the one after currently selected, or first
            var currentId = this.Plugin.State.SelectedAgentId;
            var idx = waiting.FindIndex(a => a.Id == currentId);
            var next = waiting[(idx + 1) % waiting.Count];

            this.Plugin.State.SelectedAgentId = next.Id;
            _ = this.Plugin.BridgeClient.SendOpenTerminal(next.Id);
        }

        protected override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) => "";

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var waitCount = this.Plugin.State.Agents.Count(a => a.Status == AgentStatus.Waiting);
            return waitCount > 0
                ? TileRenderer.TileCtrl("circle-dot", $"NEXT ({waitCount})", new BitmapColor(180, 160, 30), sz)
                : TileRenderer.TileCtrlDimmed("circle-dot", "NEXT (0)", new BitmapColor(180, 160, 30), sz);
        }
    }
}
