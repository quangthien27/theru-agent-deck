namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Kill all agent sessions.
    public class EndAllCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public EndAllCommand()
            : base("End All", "End All — Kill all agent sessions", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            foreach (var agent in this.Plugin.State.Agents.ToList())
            {
                _ = this.Plugin.BridgeClient.SendCommand(agent.Id, "kill");
            }
        }

        protected override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) => "";

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var count = this.Plugin.State.Agents.Count;
            var red = new BitmapColor(180, 40, 40);
            return count > 0
                ? TileRenderer.TileCtrl("x", $"ALL ({count})", red, sz)
                : TileRenderer.TileCtrlDimmed("x", "ALL (0)", red, sz);
        }
    }
}
