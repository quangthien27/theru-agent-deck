namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Pause all running agents.
    public class PauseAllCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public PauseAllCommand()
            : base("Pause All", "Pause All — Pause all running agents", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            foreach (var agent in this.Plugin.State.Agents.Where(a => a.Status == AgentStatus.Working).ToList())
            {
                _ = this.Plugin.BridgeClient.SendCommand(agent.Id, "pause");
            }
        }

        protected override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) => "";

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var runCount = this.Plugin.State.Agents.Count(a => a.Status == AgentStatus.Working);
            var amber = new BitmapColor(180, 140, 30);
            return runCount > 0
                ? TileRenderer.TileCtrl("pause", $"ALL ({runCount})", amber, sz)
                : TileRenderer.TileCtrlDimmed("pause", "ALL (0)", amber, sz);
        }
    }
}
