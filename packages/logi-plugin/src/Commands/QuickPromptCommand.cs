namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Opens VS Code input box to send a custom message to the selected agent.
    public class QuickPromptCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public QuickPromptCommand()
            : base("Quick Prompt", "Send custom message to selected agent", "Controls") { }

        protected override void RunCommand(String actionParameter)
        {
            var agentId = this.Plugin.State.SelectedAgentId;
            if (!String.IsNullOrEmpty(agentId))
            {
                _ = this.Plugin.BridgeClient.SendSkill(agentId, "custom");
            }
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var hasSelected = !String.IsNullOrEmpty(this.Plugin.State.SelectedAgentId)
                && this.Plugin.State.Agents.Any(a => a.Id == this.Plugin.State.SelectedAgentId);
            return hasSelected
                ? TileRenderer.TileCtrl("terminal", "PROMPT", new BitmapColor(68, 136, 187), sz)
                : TileRenderer.TileCtrlDimmed("terminal", "PROMPT", new BitmapColor(68, 136, 187), sz);
        }
    }
}
