namespace Loupedeck.AgentDeckPlugin.Services
{
    using System;
    using System.Diagnostics;
    using System.IO;

    public class BridgeLauncher : IDisposable
    {
        private Process _bridgeProcess;
        private Boolean _disposed;

        public Boolean IsRunning => _bridgeProcess != null && !_bridgeProcess.HasExited;

        public void Start(String pluginDirectory)
        {
            if (this.IsRunning)
            {
                return;
            }

            var bridgeBinary = Path.Combine(pluginDirectory, "Assets", "bridge", "bridge");

            if (!File.Exists(bridgeBinary))
            {
                PluginLog.Warning($"Bridge binary not found at {bridgeBinary}");
                return;
            }

            try
            {
                _bridgeProcess = Process.Start(new ProcessStartInfo
                {
                    FileName = bridgeBinary,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                });

                _bridgeProcess.OutputDataReceived += (s, e) =>
                {
                    if (e.Data != null)
                    {
                        PluginLog.Verbose($"[bridge] {e.Data}");
                    }
                };

                _bridgeProcess.ErrorDataReceived += (s, e) =>
                {
                    if (e.Data != null)
                    {
                        PluginLog.Warning($"[bridge] {e.Data}");
                    }
                };

                _bridgeProcess.BeginOutputReadLine();
                _bridgeProcess.BeginErrorReadLine();

                PluginLog.Info($"Bridge started (PID {_bridgeProcess.Id})");
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, "Failed to start bridge");
            }
        }

        public void Stop()
        {
            if (_bridgeProcess == null || _bridgeProcess.HasExited)
            {
                return;
            }

            try
            {
                _bridgeProcess.Kill();
                _bridgeProcess.WaitForExit(3000);
                PluginLog.Info("Bridge stopped");
            }
            catch (Exception ex)
            {
                PluginLog.Warning(ex, "Failed to stop bridge cleanly");
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            Stop();
            _bridgeProcess?.Dispose();
        }
    }
}
