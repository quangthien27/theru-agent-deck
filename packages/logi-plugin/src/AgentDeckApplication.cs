namespace Loupedeck.AgentDeckPlugin
{
    using System;

    /// <summary>
    /// Required by Logi Plugin Service even when HasNoApplication = true.
    /// </summary>
    public class AgentDeckApplication : ClientApplication
    {
        public AgentDeckApplication()
        {
        }

        protected override String GetProcessName() => "";

        protected override String GetBundleName() => "";
    }
}
