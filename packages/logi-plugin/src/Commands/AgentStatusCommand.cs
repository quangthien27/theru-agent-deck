namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Fleet status tile — shows total agent count with colored status dots.
    public class AgentStatusCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public AgentStatusCommand()
            : base("Agent Status", "Agent Status — Fleet overview with status dots", "Agents") { }

        protected override void RunCommand(String actionParameter)
        {
            // Tap: cycle to next agent
            var agents = this.Plugin.State.Agents;
            if (agents.Count == 0) return;
            var idx = agents.FindIndex(a => a.Id == this.Plugin.State.SelectedAgentId);
            var next = (idx + 1) % agents.Count;
            this.Plugin.State.SelectedAgentId = agents[next].Id;
            _ = this.Plugin.BridgeClient.SendOpenTerminal(agents[next].Id);
            this.Plugin.RefreshAll();
        }

        protected override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) => "";

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var agents = this.Plugin.State.Agents;
            var t = agents.Count;
            var wk = agents.Count(a => a.Status == AgentStatus.Working);
            var w = agents.Count(a => a.Status == AgentStatus.Waiting);
            var e = agents.Count(a => a.Status == AgentStatus.Error);

            using var b = new BitmapBuilder(sz, sz);
            b.Clear(new BitmapColor(40, 50, 60));

            // TileCtrl-matching layout
            var iconSz = sz * 34 / 100;
            var labelH = sz * 18 / 100;
            var gap = sz * 2 / 100;
            var totalH = iconSz + gap + labelH;
            var startY = (sz - totalH) / 2;

            // Count number — nudged down to sit close to label
            b.DrawText($"{t}", 0, startY + iconSz * 20 / 100, sz, iconSz * 80 / 100,
                new BitmapColor(200, 220, 255), sz / 3);

            // Label
            var labelY = startY + iconSz + gap;
            b.DrawText("AGENTS", 0, labelY, sz, labelH,
                new BitmapColor(210, 210, 220), sz / 6);

            // Status dots — horizontal row below label
            var dotSz = sz * 6 / 100;
            var dotGap = sz * 4 / 100;
            var dotsWidth = dotSz * 3 + dotGap * 2;
            var dotX = (sz - dotsWidth) / 2;
            var dotY = labelY + labelH + sz * 3 / 100;

            var gClr = wk > 0 ? new BitmapColor(30, 120, 50) : new BitmapColor(60, 65, 70);
            var yClr = w > 0 ? new BitmapColor(180, 160, 30) : new BitmapColor(60, 65, 70);
            var rClr = e > 0 ? new BitmapColor(180, 40, 40) : new BitmapColor(60, 65, 70);
            b.FillRectangle(dotX, dotY, dotSz, dotSz, gClr);
            b.FillRectangle(dotX + dotSz + dotGap, dotY, dotSz, dotSz, yClr);
            b.FillRectangle(dotX + (dotSz + dotGap) * 2, dotY, dotSz, dotSz, rClr);

            return b.ToImage();
        }
    }
}
