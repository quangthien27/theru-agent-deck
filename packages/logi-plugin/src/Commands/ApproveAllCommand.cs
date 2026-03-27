namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Batch approve all waiting agents.
    public class ApproveAllCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public ApproveAllCommand()
            : base("Continue All", "Continue All — Approve all waiting agents", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            foreach (var agent in this.Plugin.State.Agents.Where(a => a.Status == AgentStatus.Waiting).ToList())
            {
                _ = this.Plugin.BridgeClient.SendCommand(agent.Id, "approve");
            }
        }

        protected override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) => "";

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var waitCount = this.Plugin.State.Agents.Count(a => a.Status == AgentStatus.Waiting);
            return waitCount > 0
                ? TileRenderer.TileCtrl("check", $"ALL ({waitCount})", new BitmapColor(30, 120, 50), sz)
                : TileRenderer.TileCtrlDimmed("check", "ALL (0)", new BitmapColor(30, 120, 50), sz);
        }
    }
}
