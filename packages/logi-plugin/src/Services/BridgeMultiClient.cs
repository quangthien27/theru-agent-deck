namespace Loupedeck.AgentDeckPlugin.Services
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading;
    using System.Threading.Tasks;
    using Loupedeck.AgentDeckPlugin.Models;

    /// Manages connections to multiple VS Code windows (one BridgeClient per port).
    /// Merges agent state from all windows and routes commands to the correct window.
    public class BridgeMultiClient : IDisposable
    {
        private const Int32 PortBase = 9999;
        private const Int32 PortMax = 10008;

        private readonly Dictionary<Int32, BridgeClient> _clients = new();
        private readonly Dictionary<Int32, List<AgentSession>> _windowStates = new();
        private readonly Object _lock = new();
        private Boolean _disposed;
        private Int32 _lastFocusedPort;

        public event Action<PluginState> OnStateUpdate;
        public event Action<String, String> OnAgentEvent;
        public event Action<Boolean> OnSettingsUpdate;
        public event Action<String> OnActiveAgent; // agentId
        public event Action OnConnected;
        public event Action OnDisconnected;

        public Int32 ConnectedCount
        {
            get
            {
                lock (_lock)
                {
                    return _clients.Values.Count(c => c.IsConnected);
                }
            }
        }

        public void Start()
        {
            // Create a BridgeClient for each port in the range
            for (var port = PortBase; port <= PortMax; port++)
            {
                var client = new BridgeClient(port);
                WireClient(client, port);
                _clients[port] = client;
                client.Start();
            }

            PluginLog.Info($"BridgeMultiClient started — scanning ports {PortBase}-{PortMax}");
        }

        private void WireClient(BridgeClient client, Int32 port)
        {
            client.OnStateUpdate += (state) =>
            {
                lock (_lock)
                {
                    _windowStates[port] = state.Agents;
                }
                MergeAndBroadcast();
            };

            client.OnAgentEvent += (agentId, eventType) =>
            {
                OnAgentEvent?.Invoke(agentId, eventType);
            };

            client.OnSettingsUpdate += (worktreeEnabled) =>
            {
                OnSettingsUpdate?.Invoke(worktreeEnabled);
            };

            client.OnWindowFocus += (focusPort, _) =>
            {
                _lastFocusedPort = focusPort;
                PluginLog.Info($"Window focus → port {focusPort}");
            };

            client.OnActiveAgent += (agentId) =>
            {
                OnActiveAgent?.Invoke(agentId);
            };

            client.OnConnected += () =>
            {
                PluginLog.Info($"Connected to window on port {port}");
                OnConnected?.Invoke();
            };

            client.OnDisconnected += () =>
            {
                PluginLog.Info($"Disconnected from window on port {port}");
                lock (_lock)
                {
                    _windowStates.Remove(port);
                }
                MergeAndBroadcast();

                // If no connections remain, notify
                if (this.ConnectedCount == 0)
                {
                    OnDisconnected?.Invoke();
                }
            };
        }

        private void MergeAndBroadcast()
        {
            var merged = new PluginState
            {
                Phase = this.ConnectedCount > 0 ? PluginPhase.Connected : PluginPhase.Disconnected,
                ConnectedWindowCount = this.ConnectedCount
            };

            lock (_lock)
            {
                foreach (var agents in _windowStates.Values)
                {
                    merged.Agents.AddRange(agents);
                }
            }

            OnStateUpdate?.Invoke(merged);
        }

        /// Parse port from agent ID prefix: "w9999-agent-1" → 9999
        private Int32 ExtractPort(String agentId)
        {
            if (agentId != null && agentId.StartsWith("w"))
            {
                var dash = agentId.IndexOf('-');
                if (dash > 1 && Int32.TryParse(agentId.Substring(1, dash - 1), out var port))
                {
                    return port;
                }
            }
            return 0;
        }

        /// Get the BridgeClient that owns this agent
        private BridgeClient GetClientForAgent(String agentId)
        {
            var port = ExtractPort(agentId);
            if (port > 0 && _clients.TryGetValue(port, out var client) && client.IsConnected)
            {
                return client;
            }
            return null;
        }

        /// Get the client for the last focused window (for launch/settings commands)
        private BridgeClient GetFocusedOrPrimaryClient()
        {
            // Try last focused window
            if (_lastFocusedPort > 0 &&
                _clients.TryGetValue(_lastFocusedPort, out var focused) &&
                focused.IsConnected)
            {
                return focused;
            }

            // Fallback: lowest connected port
            lock (_lock)
            {
                for (var port = PortBase; port <= PortMax; port++)
                {
                    if (_clients.TryGetValue(port, out var client) && client.IsConnected)
                    {
                        return client;
                    }
                }
            }

            return null;
        }

        // ── Send methods — route to correct window ──────────────

        public async Task SendCommand(String agentId, String action, String payload = null)
        {
            var client = GetClientForAgent(agentId);
            if (client != null)
            {
                await client.SendCommand(agentId, action, payload);
            }
        }

        public async Task SendLaunch(String projectPath, String agent = "claude",
            String mode = null, String effort = null)
        {
            var client = GetFocusedOrPrimaryClient();
            if (client != null)
            {
                await client.SendLaunch(projectPath, agent, mode, effort);
            }
        }

        public async Task SendOpenTerminal(String agentId)
        {
            var client = GetClientForAgent(agentId);
            if (client != null)
            {
                await client.SendOpenTerminal(agentId);
            }
        }

        public async Task SendSkill(String agentId, String skillId, String customPrompt = null)
        {
            var client = GetClientForAgent(agentId);
            if (client != null)
            {
                await client.SendSkill(agentId, skillId, customPrompt);
            }
        }

        public async Task SendToggleWorktree()
        {
            var client = GetFocusedOrPrimaryClient();
            if (client != null)
            {
                await client.SendToggleWorktree();
            }
        }

        public async Task SendGetSettings()
        {
            var client = GetFocusedOrPrimaryClient();
            if (client != null)
            {
                await client.SendGetSettings();
            }
        }

        public async Task SendFocusView(String view, String agentId = null)
        {
            if (agentId != null)
            {
                var client = GetClientForAgent(agentId);
                if (client != null)
                {
                    await client.SendFocusView(view, agentId);
                }
            }
            else
            {
                var client = GetFocusedOrPrimaryClient();
                if (client != null)
                {
                    await client.SendFocusView(view, agentId);
                }
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            foreach (var client in _clients.Values)
            {
                client.Dispose();
            }
            _clients.Clear();
            _windowStates.Clear();
        }
    }
}
