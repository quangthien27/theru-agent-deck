namespace Loupedeck.AgentDeckPlugin.Services
{
    using System;
    using System.Net.WebSockets;
    using System.Text;
    using System.Text.Json;
    using System.Text.Json.Serialization;
    using System.Threading;
    using System.Threading.Tasks;
    using Loupedeck.AgentDeckPlugin.Models;

    public class BridgeClient : IDisposable
    {
        private const String DefaultUrl = "ws://localhost:9999";
        private const Int32 ReconnectDelayMs = 3000;
        private const Int32 BufferSize = 8192;

        private ClientWebSocket _socket;
        private CancellationTokenSource _cts;
        private Boolean _disposed;
        private readonly String _url;
        private readonly JsonSerializerOptions _jsonOptions;

        public event Action<PluginState> OnStateUpdate;
        public event Action<String, String> OnAgentEvent; // agentId, eventType
        public event Action OnConnected;
        public event Action OnDisconnected;

        public Boolean IsConnected => _socket?.State == WebSocketState.Open;

        public BridgeClient(String url = null)
        {
            _url = url ?? DefaultUrl;
            _jsonOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
            };
        }

        public void Start()
        {
            _cts = new CancellationTokenSource();
            _ = ConnectLoop(_cts.Token);
        }

        public void Stop()
        {
            _cts?.Cancel();
            _socket?.Dispose();
        }

        private async Task ConnectLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    _socket = new ClientWebSocket();
                    await _socket.ConnectAsync(new Uri(_url), ct);
                    PluginLog.Info("Connected to bridge");
                    OnConnected?.Invoke();
                    await ReceiveLoop(ct);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    PluginLog.Warning(ex, "Bridge connection failed, retrying...");
                    OnDisconnected?.Invoke();
                }

                if (!ct.IsCancellationRequested)
                {
                    try
                    {
                        await Task.Delay(ReconnectDelayMs, ct);
                    }
                    catch (OperationCanceledException)
                    {
                        break;
                    }
                }
            }
        }

        private async Task ReceiveLoop(CancellationToken ct)
        {
            var buffer = new Byte[BufferSize];
            var messageBuilder = new StringBuilder();

            while (_socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await _socket.ReceiveAsync(new ArraySegment<Byte>(buffer), ct);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    PluginLog.Info("Bridge closed connection");
                    OnDisconnected?.Invoke();
                    break;
                }

                messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

                if (result.EndOfMessage)
                {
                    var json = messageBuilder.ToString();
                    messageBuilder.Clear();
                    HandleMessage(json);
                }
            }
        }

        private void HandleMessage(String json)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                var type = doc.RootElement.GetProperty("type").GetString();

                switch (type)
                {
                    case "state":
                        var state = ParseStateUpdate(doc.RootElement);
                        OnStateUpdate?.Invoke(state);
                        break;

                    case "event":
                        var agentId = doc.RootElement.GetProperty("agentId").GetString();
                        var eventType = doc.RootElement.GetProperty("event").GetString();
                        OnAgentEvent?.Invoke(agentId, eventType);
                        break;
                }
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, "Failed to parse bridge message");
            }
        }

        private PluginState ParseStateUpdate(JsonElement root)
        {
            var state = new PluginState { Phase = PluginPhase.Connected };
            var agents = root.GetProperty("agents");

            foreach (var agentEl in agents.EnumerateArray())
            {
                var agent = new AgentSession
                {
                    Id = agentEl.GetProperty("id").GetString(),
                    Slot = agentEl.GetProperty("slot").GetInt32(),
                    Name = agentEl.GetProperty("name").GetString(),
                    Agent = agentEl.GetProperty("agent").GetString(),
                    Status = AgentSession.ParseStatus(agentEl.GetProperty("status").GetString()),
                    ProjectPath = agentEl.GetProperty("projectPath").GetString(),
                    CreatedAt = agentEl.GetProperty("createdAt").GetString()
                };

                if (agentEl.TryGetProperty("approval", out var approvalEl) &&
                    approvalEl.ValueKind != JsonValueKind.Null)
                {
                    agent.Approval = new ApprovalRequest
                    {
                        Type = approvalEl.GetProperty("type").GetString(),
                        Summary = approvalEl.GetProperty("summary").GetString(),
                        FullContent = approvalEl.GetProperty("fullContent").GetString()
                    };

                    if (approvalEl.TryGetProperty("command", out var cmdEl) &&
                        cmdEl.ValueKind != JsonValueKind.Null)
                    {
                        agent.Approval.Command = cmdEl.GetString();
                    }

                    if (approvalEl.TryGetProperty("files", out var filesEl) &&
                        filesEl.ValueKind == JsonValueKind.Array)
                    {
                        var files = new System.Collections.Generic.List<FileChange>();
                        foreach (var fileEl in filesEl.EnumerateArray())
                        {
                            files.Add(new FileChange
                            {
                                Path = fileEl.GetProperty("path").GetString(),
                                Diff = fileEl.GetProperty("diff").GetString(),
                                LinesAdded = fileEl.GetProperty("linesAdded").GetInt32(),
                                LinesRemoved = fileEl.GetProperty("linesRemoved").GetInt32()
                            });
                        }

                        agent.Approval.Files = files.ToArray();
                    }
                }

                state.Agents.Add(agent);
            }

            return state;
        }

        public async Task SendCommand(String agentId, String action, String payload = null)
        {
            if (_socket?.State != WebSocketState.Open)
            {
                return;
            }

            var message = new
            {
                type = "command",
                agentId,
                action,
                payload
            };

            var json = JsonSerializer.Serialize(message, _jsonOptions);
            var bytes = Encoding.UTF8.GetBytes(json);

            try
            {
                await _socket.SendAsync(
                    new ArraySegment<Byte>(bytes),
                    WebSocketMessageType.Text,
                    true,
                    _cts?.Token ?? CancellationToken.None);
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, "Failed to send command to bridge");
            }
        }

        public async Task SendLaunch(String projectPath, String agent = "claude")
        {
            if (_socket?.State != WebSocketState.Open)
            {
                return;
            }

            var message = new
            {
                type = "launch",
                projectPath,
                agent
            };

            var json = JsonSerializer.Serialize(message, _jsonOptions);
            var bytes = Encoding.UTF8.GetBytes(json);

            try
            {
                await _socket.SendAsync(
                    new ArraySegment<Byte>(bytes),
                    WebSocketMessageType.Text,
                    true,
                    _cts?.Token ?? CancellationToken.None);
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, "Failed to send launch to bridge");
            }
        }

        public async Task SendOpenTerminal(String agentId)
        {
            if (_socket?.State != WebSocketState.Open)
            {
                return;
            }

            var message = new
            {
                type = "open_terminal",
                agentId
            };

            var json = JsonSerializer.Serialize(message, _jsonOptions);
            var bytes = Encoding.UTF8.GetBytes(json);

            try
            {
                await _socket.SendAsync(
                    new ArraySegment<Byte>(bytes),
                    WebSocketMessageType.Text,
                    true,
                    _cts?.Token ?? CancellationToken.None);
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, "Failed to send open_terminal to bridge");
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
            _cts?.Dispose();
            _socket?.Dispose();
        }
    }
}
