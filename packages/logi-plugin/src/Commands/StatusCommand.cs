namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;

    public class StatusCommand : PluginDynamicCommand
    {
        private const Int32 ImageSize = 80;
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public StatusCommand()
            : base("Status", "Show all agent statuses", "Controls")
        {
        }

        protected override void RunCommand(String actionParameter)
        {
            // TODO: Open ring with all-agents view
            PluginLog.Info("Status view requested");
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var waitingCount = this.Plugin.State.WaitingCount();

            using var builder = new BitmapBuilder(ImageSize, ImageSize);
            builder.Clear(new BitmapColor(40, 50, 60));

            var agentCount = this.Plugin.State.Agents.Count;
            builder.DrawText(
                $"{agentCount}",
                0, 8, ImageSize, 30,
                new BitmapColor(200, 220, 255), 22);

            builder.DrawText(
                "STATUS",
                0, 38, ImageSize, 18,
                new BitmapColor(180, 190, 200), 11);

            if (waitingCount > 0)
            {
                builder.DrawText(
                    $"{waitingCount} waiting",
                    0, 56, ImageSize, 16,
                    new BitmapColor(255, 140, 140), 10);
            }

            return builder.ToImage();
        }
    }
}
