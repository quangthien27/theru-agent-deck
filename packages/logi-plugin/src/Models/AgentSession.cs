namespace Loupedeck.AgentDeckPlugin.Models
{
    using System;

    public enum AgentStatus
    {
        Idle,
        Working,
        Waiting,
        Error,
        Offline
    }

    public class ApprovalRequest
    {
        public String Type { get; set; } = "";
        public String Summary { get; set; } = "";
        public FileChange[] Files { get; set; }
        public String Command { get; set; }
        public String FullContent { get; set; } = "";
    }

    public class FileChange
    {
        public String Path { get; set; } = "";
        public String Diff { get; set; } = "";
        public Int32 LinesAdded { get; set; }
        public Int32 LinesRemoved { get; set; }
    }

    public class AgentSession
    {
        public String Id { get; set; } = "";
        public Int32 Slot { get; set; }
        public String Name { get; set; } = "";
        public String Agent { get; set; } = "";
        public AgentStatus Status { get; set; } = AgentStatus.Offline;
        public String ProjectPath { get; set; } = "";
        public String CreatedAt { get; set; } = "";
        public ApprovalRequest Approval { get; set; }

        public static AgentStatus ParseStatus(String status)
        {
            return status?.ToLowerInvariant() switch
            {
                "idle" => AgentStatus.Idle,
                "working" => AgentStatus.Working,
                "waiting" => AgentStatus.Waiting,
                "error" => AgentStatus.Error,
                _ => AgentStatus.Offline
            };
        }
    }
}
