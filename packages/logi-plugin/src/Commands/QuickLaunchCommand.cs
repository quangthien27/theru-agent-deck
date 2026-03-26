namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Collections.Generic;
    using Loupedeck.AgentDeckPlugin.Helpers;

    /// One-tap launch of a specific agent type in the current workspace.
    public class QuickLaunchCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        private static readonly (String id, String label, BitmapColor color)[] Agents =
        {
            ("claude",   "Claude",   new BitmapColor(217, 119, 6)),
            ("gemini",   "Gemini",   new BitmapColor(26, 115, 232)),
            ("codex",    "Codex",    new BitmapColor(16, 163, 127)),
            ("aider",    "Aider",    new BitmapColor(230, 126, 34)),
            ("opencode", "OpenCode", new BitmapColor(106, 77, 186)),
        };

        public QuickLaunchCommand()
            : base("Quick Launch", "Launch agent in current workspace", "Agents")
        {
            foreach (var a in Agents)
            {
                this.AddParameter($"launch_{a.id}", $"Launch {a.label}", $"Launch {a.label} agent");
            }
        }

        protected override void RunCommand(String actionParameter)
        {
            if (String.IsNullOrEmpty(actionParameter)) return;
            var agentType = actionParameter.Replace("launch_", "");
            _ = this.Plugin.BridgeClient.SendLaunch(".", agentType);
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            if (String.IsNullOrEmpty(actionParameter)) return TileRenderer.TileCtrlDimmed("play", "LAUNCH", new BitmapColor(80, 80, 80), sz);

            var agentType = actionParameter.Replace("launch_", "");

            // Find agent info
            BitmapColor color = new BitmapColor(80, 80, 80);
            String label = "LAUNCH";
            foreach (var a in Agents)
            {
                if (a.id == agentType) { color = a.color; label = a.label; break; }
            }

            TileRenderer.EnsureLoaded();
            using var b = new BitmapBuilder(sz, sz);
            b.Clear(new BitmapColor(28, 28, 38));
            b.DrawRectangle(0, 0, sz, sz, new BitmapColor(color.R, color.G, color.B, 100));

            var iconSz = sz * 34 / 100;
            var labelH = sz * 18 / 100;
            var gap = sz * 2 / 100;
            var totalH = iconSz + gap + labelH;
            var startY = (sz - totalH) / 2;

            if (TileRenderer.AgentIconCache.TryGetValue(agentType, out var icon))
            {
                b.DrawImage(icon, (sz - iconSz) / 2, startY, iconSz, iconSz);
            }
            else
            {
                b.DrawText(label[..Math.Min(2, label.Length)].ToUpperInvariant(), 0, startY, sz, iconSz, BitmapColor.White, sz / 3);
            }

            b.DrawText(label, 0, startY + iconSz + gap, sz, labelH,
                new BitmapColor(210, 210, 220), sz / 6);

            return b.ToImage();
        }
    }
}
