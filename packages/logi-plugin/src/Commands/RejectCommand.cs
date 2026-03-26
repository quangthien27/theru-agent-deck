namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Reject first waiting agent — one-tap from any button or Actions Ring slot.
    public class RejectCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public RejectCommand()
            : base("Reject", "Reject first waiting agent", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            var agent = this.Plugin.State.Agents.FirstOrDefault(a => a.Status == AgentStatus.Waiting);
            if (agent != null)
            {
                _ = this.Plugin.BridgeClient.SendCommand(agent.Id, "reject");
            }
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var hasWaiting = this.Plugin.State.Agents.Any(a => a.Status == AgentStatus.Waiting);
            return hasWaiting
                ? TileRenderer.TileCtrl("icon-x", "REJECT", new BitmapColor(180, 40, 40), sz)
                : TileRenderer.TileCtrlDimmed("icon-x", "REJECT", new BitmapColor(180, 40, 40), sz);
        }
    }
}
