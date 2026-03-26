namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Pause (Ctrl+C) the currently selected agent.
    public class PauseAgentCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public PauseAgentCommand()
            : base("Pause Agent", "Send Ctrl+C to selected agent", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            var agentId = this.Plugin.State.SelectedAgentId;
            if (!String.IsNullOrEmpty(agentId))
            {
                _ = this.Plugin.BridgeClient.SendCommand(agentId, "pause");
            }
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var hasSelected = !String.IsNullOrEmpty(this.Plugin.State.SelectedAgentId)
                && this.Plugin.State.Agents.Any(a => a.Id == this.Plugin.State.SelectedAgentId);
            return hasSelected
                ? TileRenderer.TileCtrl("circle-pause", "PAUSE", new BitmapColor(136, 102, 34), sz)
                : TileRenderer.TileCtrlDimmed("circle-pause", "PAUSE", new BitmapColor(136, 102, 34), sz);
        }
    }
}
