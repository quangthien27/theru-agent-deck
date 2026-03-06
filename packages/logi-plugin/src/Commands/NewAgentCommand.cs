namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;

    public class NewAgentCommand : PluginDynamicCommand
    {
        private const Int32 ImageSize = 80;
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public NewAgentCommand()
            : base("New Agent", "Launch a new agent session", "Controls")
        {
        }

        protected override void RunCommand(String actionParameter)
        {
            // TODO: Open ring with project picker
            // For now, launch with default project
            PluginLog.Info("New agent requested");
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            using var builder = new BitmapBuilder(ImageSize, ImageSize);
            builder.Clear(new BitmapColor(40, 40, 60));
            builder.DrawText("+", 0, 10, ImageSize, 40, new BitmapColor(200, 200, 255), 28);
            builder.DrawText("NEW", 0, 50, ImageSize, 20, new BitmapColor(180, 180, 200), 12);
            return builder.ToImage();
        }
    }
}
