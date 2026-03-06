namespace Loupedeck.AgentDeckPlugin.Services
{
    using System;
    using System.Diagnostics;
    using System.IO;
    using System.Runtime.InteropServices;

    public class DependencyResult
    {
        public Boolean TmuxInstalled { get; set; }
        public Boolean AgentDeckInstalled { get; set; }
        public Boolean AllReady { get; set; }
    }

    public static class DependencyChecker
    {
        public static DependencyResult Check()
        {
            var result = new DependencyResult
            {
                TmuxInstalled = CommandExists("tmux"),
                AgentDeckInstalled = CommandExists("agent-deck")
            };

            result.AllReady = result.TmuxInstalled && result.AgentDeckInstalled;
            return result;
        }

        private static Boolean CommandExists(String command)
        {
            try
            {
                var which = RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "where" : "which";
                var psi = new ProcessStartInfo
                {
                    FileName = which,
                    Arguments = command,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = Process.Start(psi);
                process.WaitForExit(5000);
                return process.ExitCode == 0;
            }
            catch
            {
                return false;
            }
        }
    }
}
