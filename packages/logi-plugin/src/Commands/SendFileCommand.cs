namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Open file picker and send file path to the selected agent.
    public class SendFileCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public SendFileCommand()
            : base("Send File", "Send file context to selected agent", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            var agentId = this.Plugin.State.SelectedAgentId;
            if (!String.IsNullOrEmpty(agentId))
            {
                _ = this.Plugin.BridgeClient.SendSkill(agentId, "context_file");
            }
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var hasSelected = !String.IsNullOrEmpty(this.Plugin.State.SelectedAgentId)
                && this.Plugin.State.Agents.Any(a => a.Id == this.Plugin.State.SelectedAgentId);
            return hasSelected
                ? TileRenderer.TileCtrl("code", "FILE", new BitmapColor(68, 136, 187), sz)
                : TileRenderer.TileCtrlDimmed("code", "FILE", new BitmapColor(68, 136, 187), sz);
        }
    }
}
