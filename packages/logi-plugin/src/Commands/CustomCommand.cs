namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;

    public class CustomCommand : PluginDynamicCommand
    {
        private const Int32 ImageSize = 80;

        public CustomCommand()
            : base("Custom", "User-configurable action", "Controls")
        {
        }

        protected override void RunCommand(String actionParameter)
        {
            // TODO: Open settings or execute custom action
            PluginLog.Info("Custom action triggered");
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            using var builder = new BitmapBuilder(ImageSize, ImageSize);
            builder.Clear(new BitmapColor(50, 50, 50));
            builder.DrawText("CFG", 0, 25, ImageSize, 30, new BitmapColor(160, 160, 160), 14);
            return builder.ToImage();
        }
    }
}
