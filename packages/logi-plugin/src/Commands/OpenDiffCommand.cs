namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Open the diff view for the selected agent.
    public class OpenDiffCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public OpenDiffCommand()
            : base("Open Diff", "Open diff view for selected agent", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            var agentId = this.Plugin.State.SelectedAgentId;
            if (!String.IsNullOrEmpty(agentId))
            {
                _ = this.Plugin.BridgeClient.SendFocusView("diff", agentId);
            }
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var hasSelected = !String.IsNullOrEmpty(this.Plugin.State.SelectedAgentId)
                && this.Plugin.State.Agents.Any(a => a.Id == this.Plugin.State.SelectedAgentId);
            return hasSelected
                ? TileRenderer.TileCtrl("eye", "DIFF", new BitmapColor(136, 85, 187), sz)
                : TileRenderer.TileCtrlDimmed("eye", "DIFF", new BitmapColor(136, 85, 187), sz);
        }
    }
}
