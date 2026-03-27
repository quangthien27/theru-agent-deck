namespace Loupedeck.AgentDeckPlugin.Helpers
{
    using System;
    using System.Collections.Generic;

    /// Shared tile rendering for standalone commands — matches AgentDashboardFolder style.
    internal static class TileRenderer
    {
        internal static readonly Dictionary<String, BitmapImage> LucideIconCache = new();
        internal static readonly Dictionary<String, BitmapImage> AgentIconCache = new();
        private static Boolean _loaded;

        internal static void EnsureLoaded()
        {
            if (_loaded) return;
            _loaded = true;

            // Load agent icons
            foreach (var agent in new[] { "claude", "gemini", "codex", "aider", "opencode" })
            {
                try { var i = PluginResources.ReadImage($"{agent}.png"); if (i != null) AgentIconCache[agent] = i; }
                catch { }
            }

            var names = new[] {
                "check", "icon-x", "circle-dot", "circle-pause",
                "play", "chevron-right", "terminal", "menu", "eye",
                "rotate-ccw", "undo-2", "hash", "code", "settings", "plus", "bot"
            };
            foreach (var name in names)
            {
                try { var i = PluginResources.ReadImage($"{name}.png"); if (i != null) LucideIconCache[name] = i; }
                catch { }
            }
        }

        internal static Int32 SizeFor(PluginImageSize s) => s switch
        {
            PluginImageSize.Width60 => 60,
            PluginImageSize.Width90 => 90,
            PluginImageSize.Width116 => 116,
            _ => (Int32)s
        };

        /// Control tile — Lucide icon + label, vertically centered as a tight unit.
        internal static BitmapImage TileCtrl(String lucideOrText, String label, BitmapColor bg, Int32 sz)
        {
            EnsureLoaded();
            using var b = new BitmapBuilder(sz, sz);
            b.Clear(bg);

            var iconSz = sz * 34 / 100;
            var labelH = sz * 18 / 100;
            var gap = sz * 2 / 100;
            var totalH = iconSz + gap + labelH;
            var startY = (sz - totalH) / 2;

            if (LucideIconCache.TryGetValue(lucideOrText, out var icon))
            {
                b.DrawImage(icon, (sz - iconSz) / 2, startY, iconSz, iconSz);
            }
            else
            {
                b.DrawText(lucideOrText, 0, startY, sz, iconSz, BitmapColor.White, sz / 3);
            }

            b.DrawText(label, 0, startY + iconSz + gap, sz, labelH,
                new BitmapColor(210, 210, 220), sz / 6);

            return b.ToImage();
        }

        /// Dimmed variant — same layout but muted colors (for inactive/no-op state).
        internal static BitmapImage TileCtrlDimmed(String lucideOrText, String label, BitmapColor bg, Int32 sz)
        {
            EnsureLoaded();
            var dimBg = new BitmapColor(bg.R / 3, bg.G / 3, bg.B / 3);
            using var b = new BitmapBuilder(sz, sz);
            b.Clear(dimBg);

            var iconSz = sz * 34 / 100;
            var labelH = sz * 18 / 100;
            var gap = sz * 2 / 100;
            var totalH = iconSz + gap + labelH;
            var startY = (sz - totalH) / 2;

            if (LucideIconCache.TryGetValue(lucideOrText, out var icon))
            {
                b.DrawImage(icon, (sz - iconSz) / 2, startY, iconSz, iconSz);
            }
            else
            {
                b.DrawText(lucideOrText, 0, startY, sz, iconSz,
                    new BitmapColor(255, 255, 255, 80), sz / 3);
            }

            b.DrawText(label, 0, startY + iconSz + gap, sz, labelH,
                new BitmapColor(150, 150, 160), sz / 6);

            return b.ToImage();
        }
    }
}
