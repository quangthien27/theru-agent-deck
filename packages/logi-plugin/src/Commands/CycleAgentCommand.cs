namespace Loupedeck.AgentDeckPlugin.Commands
{
    using System;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Helpers;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Cycle through agents — rotates selection and focuses terminal.
    public class CycleAgentCommand : PluginDynamicCommand
    {
        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        public CycleAgentCommand()
            : base("Cycle Agent", "Select next agent and focus terminal", "Navigation") { }

        protected override void RunCommand(String actionParameter)
        {
            var agents = this.Plugin.State.Agents;
            if (agents.Count == 0) return;

            var idx = agents.FindIndex(a => a.Id == this.Plugin.State.SelectedAgentId);
            var next = (idx + 1) % agents.Count;
            this.Plugin.State.SelectedAgentId = agents[next].Id;
            _ = this.Plugin.BridgeClient.SendOpenTerminal(agents[next].Id);
            this.Plugin.ActiveFolder?.RefreshExternal();
            this.Plugin.RefreshAll();
        }

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var sz = TileRenderer.SizeFor(imageSize);
            var agent = this.Plugin.State.GetSelectedAgent();
            var label = agent != null ? agent.Name : "NEXT";
            return agent != null
                ? TileRenderer.TileCtrl("chevron-right", label, new BitmapColor(68, 136, 187), sz)
                : TileRenderer.TileCtrlDimmed("chevron-right", "NEXT", new BitmapColor(68, 136, 187), sz);
        }
    }
}
