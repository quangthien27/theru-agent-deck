namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Approve first waiting agent — one-tap from any button or Actions Ring slot.
    public class ApproveCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public ApproveCommand()
            : base("Approve", "Approve first waiting agent", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            var agent = this.Plugin.State.Agents.FirstOrDefault(a => a.Status == AgentStatus.Waiting);
            if (agent != null)
            {
                _ = this.Plugin.BridgeClient.SendCommand(agent.Id, "approve");
            }
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var hasWaiting = this.Plugin.State.Agents.Any(a => a.Status == AgentStatus.Waiting);
            return hasWaiting
                ? TileRenderer.TileCtrl("check", "APPROVE", new BitmapColor(30, 120, 50), sz)
                : TileRenderer.TileCtrlDimmed("check", "APPROVE", new BitmapColor(30, 120, 50), sz);
        }
    }
}
