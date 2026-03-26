namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using Loupedeck.AgentDeckPlugin.Helpers;

    /// Toggle the AgentDeck sidebar in VS Code.
    public class ToggleSidebarCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public ToggleSidebarCommand()
            : base("Toggle Sidebar", "Show/hide AgentDeck sidebar", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            _ = this.Plugin.BridgeClient.SendFocusView("sidebar");
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            return TileRenderer.TileCtrl("menu", "SIDEBAR", new BitmapColor(50, 50, 60), sz);
        }
    }
}
