namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using Loupedeck.AgentDeckPlugin.Helpers;

    /// One-tap launch of a specific agent type — dropdown selector in Options+.
    public class QuickLaunchCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        private static readonly (String id, String label, BitmapColor color)[] AgentTypes =
        {
            ("claude",   "Claude",   new BitmapColor(217, 119, 6)),
            ("gemini",   "Gemini",   new BitmapColor(26, 115, 232)),
            ("codex",    "Codex",    new BitmapColor(16, 163, 127)),
            ("aider",    "Aider",    new BitmapColor(230, 126, 34)),
            ("opencode", "OpenCode", new BitmapColor(106, 77, 186)),
        };

        public QuickLaunchCommand()
            : base("Launch Agent", "Launch Agent — Launch agent in workspace", "Agent Actions")
        {
            this.MakeProfileAction("tree");
        }

        protected override PluginProfileActionData GetProfileActionData()
        {
            var tree = new PluginProfileActionTree("Select agent to launch");
            tree.AddLevel("Mode");
            tree.AddLevel("Agent");

            // Mode first, then agent — so the leaf (agent name) shows as tile label
            var defaultNode = tree.Root.AddNode("Default");
            var worktreeNode = tree.Root.AddNode("Worktree");

            foreach (var a in AgentTypes)
            {
                defaultNode.AddItem($"{a.id}|default", $"New {a.label}", null);
                worktreeNode.AddItem($"{a.id}|worktree", $"New {a.label}", null);
            }

            return tree;
        }

        protected override void RunCommand(String actionParameter)
        {
            if (String.IsNullOrEmpty(actionParameter)) return;

            var parts = actionParameter.Split('|');
            var agentType = parts[0];
            var useWorktree = parts.Length > 1 && parts[1] == "worktree";

            if (useWorktree)
            {
                _ = this.Plugin.BridgeClient.SendToggleWorktree();
            }
            _ = this.Plugin.BridgeClient.SendLaunch(".", agentType);
        }

        protected override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) => "";

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            TileRenderer.EnsureLoaded();
            using var b = new BitmapBuilder(sz, sz);
            b.Clear(BitmapColor.Transparent);

            if (TileRenderer.LucideIconCache.TryGetValue("bot", out var icon))
            {
                var iconSz = sz * 70 / 100;
                var offset = (sz - iconSz) / 2;
                b.DrawImage(icon, offset, offset + sz * 5 / 100, iconSz, iconSz);
            }

            return b.ToImage();
        }
    }
}
