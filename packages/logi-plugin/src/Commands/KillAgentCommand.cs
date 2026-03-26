namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Kill the currently selected agent — quick cleanup.
    public class KillAgentCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public KillAgentCommand()
            : base("Kill Agent", "Kill selected agent", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            var agentId = this.Plugin.State.SelectedAgentId;
            if (!String.IsNullOrEmpty(agentId))
            {
                _ = this.Plugin.BridgeClient.SendCommand(agentId, "kill");
            }
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var hasSelected = !String.IsNullOrEmpty(this.Plugin.State.SelectedAgentId)
                && this.Plugin.State.Agents.Any(a => a.Id == this.Plugin.State.SelectedAgentId);
            return hasSelected
                ? TileRenderer.TileCtrl("icon-x", "KILL", new BitmapColor(180, 40, 40), sz)
                : TileRenderer.TileCtrlDimmed("icon-x", "KILL", new BitmapColor(180, 40, 40), sz);
        }
    }
}
