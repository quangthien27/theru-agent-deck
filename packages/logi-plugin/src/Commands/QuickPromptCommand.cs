namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;

    /// User-configured prompt button — type any prompt in Options+, tap to send to active agent.
    public class QuickPromptCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public QuickPromptCommand()
            : base("Quick Prompt", "Quick Prompt — Send a custom prompt to active agent", "Agent Actions")
        {
            this.MakeProfileAction("text;Enter prompt to send:");
        }

        protected override void RunCommand(String actionParameter)
        {
            if (String.IsNullOrEmpty(actionParameter)) return;

            var agents = this.Plugin.State.Agents;
            if (agents == null || agents.Count == 0) return;

            var selected = this.Plugin.State.GetSelectedAgent();
            var agent = selected ?? agents.FirstOrDefault();
            if (agent == null) return;

            _ = this.Plugin.BridgeClient.SendSkill(agent.Id, "custom", actionParameter);
        }

        protected override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) => "";

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            TileRenderer.EnsureLoaded();
            using var b = new BitmapBuilder(sz, sz);
            b.Clear(BitmapColor.Transparent);

            if (TileRenderer.LucideIconCache.TryGetValue("terminal", out var icon))
            {
                var iconSz = sz * 70 / 100;
                var offset = (sz - iconSz) / 2;
                b.DrawImage(icon, offset, offset + sz * 5 / 100, iconSz, iconSz);
            }

            return b.ToImage();
        }
    }
}
