namespace Loupedeck.AgentDeckPlugin.Folders
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Models;

    public class AgentDashboardFolder : PluginDynamicFolder
    {
        private const Int32 AgentSlots = 6;
        private const Int32 AgentStartPos = 2;

        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        internal String CurrentView => _view;

        private String _view = "dashboard";
        private String _previousView = "dashboard";
        private Int32 _dashPage = 0;
        private Int32 _epoch = 0;

        // Double-tap detection
        private Int32 _lastTapPos = -1;
        private DateTime _lastTapTime = DateTime.MinValue;
        private const Int32 DoubleTapMs = 400;

        // View-switch cooldown — blocks accidental third tap
        private DateTime _viewSwitchTime = DateTime.MinValue;
        private const Int32 CooldownMs = 700;

        // Persistent sort: null = insertion order, otherwise sort that status first
        private AgentStatus? _sortByStatus = null;

        // Icon caches (loaded from embedded resources)
        private static readonly Dictionary<String, BitmapImage> AgentIconCache = new();
        private static readonly Dictionary<String, BitmapImage> LucideCache = new();
        private static Boolean _iconsLoaded;

        private static readonly String[] AgentTypes = { "claude", "gemini", "codex", "aider", "opencode", "amp" };

        private static readonly (String id, String label, String lucide, BitmapColor color)[] Skills =
        {
            ("commit",     "Commit",    "check",       new BitmapColor(30, 120, 50)),
            ("review",     "Review",    "icon-code",        new BitmapColor(45, 130, 130)),
            // ("checkpoint", "Chkpt",     "hash",        new BitmapColor(50, 100, 180)),
            ("clear",      "Clear",     "eraser",      new BitmapColor(80, 80, 140)),
            ("diff",       "Diff",      "eye",         new BitmapColor(136, 85, 187)),
        };

        private static readonly (String id, String label, String lucide, BitmapColor color)[] MenuActions =
        {
            ("focus-next",   "Next Wait",    "play",           new BitmapColor(45, 130, 130)),
            ("confirm-all",  "Confirm All",  "check",          new BitmapColor(30, 120, 50)),
            ("pause-all",    "Pause All",    "circle-pause",   new BitmapColor(136, 102, 34)),
            ("kill-all",     "End All",      "icon-x",         new BitmapColor(180, 40, 40)),
            ("show-ready",   "Rdy 1st",      "arrow-up-down",  new BitmapColor(45, 55, 70)),
            ("show-waiting", "Wait 1st",     "arrow-up-down",  new BitmapColor(70, 65, 30)),
            ("show-errors",  "Err 1st",      "arrow-up-down",  new BitmapColor(75, 35, 40)),
        };

        private static readonly Dictionary<String, BitmapColor> AgentColors = new()
        {
            { "claude",   new BitmapColor(217, 119, 6) },
            { "gemini",   new BitmapColor(26, 115, 232) },
            { "codex",    new BitmapColor(16, 163, 127) },
            { "aider",    new BitmapColor(230, 126, 34) },
            { "opencode", new BitmapColor(106, 77, 186) },
            { "amp",      new BitmapColor(243, 78, 63) },
        };

        public AgentDashboardFolder()
        {
            this.DisplayName = "AgentDeck";
            this.GroupName = "Agents";
        }

        public override PluginDynamicFolderNavigation GetNavigationArea(DeviceType _)
            => PluginDynamicFolderNavigation.None;

        public override Boolean Activate()
        {
            _view = "dashboard";
            _dashPage = 0;
            this.Plugin.ActiveFolder = this;
            try { LoadIcons(); }
            catch (Exception ex) { PluginLog.Warning($"Icon load failed: {ex.Message}"); }
            PluginLog.Info($"[FOLDER] Activated, view={_view}, icons={AgentIconCache.Count}");
            return true;
        }

        public override Boolean Deactivate()
        {
            if (this.Plugin.ActiveFolder == this)
                this.Plugin.ActiveFolder = null;
            return true;
        }

        // ── Load agent icons from embedded resources ─────────────

        private static void LoadIcons()
        {
            if (_iconsLoaded) return;
            _iconsLoaded = true;

            // Load agent icons
            foreach (var agent in AgentTypes)
            {
                try { var i = PluginResources.ReadImage($"{agent}.png"); if (i != null) AgentIconCache[agent] = i; }
                catch { }
            }

            // Load Lucide icons
            var lucideNames = new[] {
                "plus", "menu", "chevron-left", "chevron-up", "chevron-down", "chevron-right",
                "check", "icon-x", "keyboard", "message-circle", "git-branch", "layers",
                "settings", "circle-pause", "terminal", "undo-2", "play", "circle-dot",
                "hash", "rotate-ccw", "eraser", "wrench", "test-tube", "refresh-cw", "icon-code",
                "eye", "lightbulb", "arrow-up-down"
            };
            foreach (var name in lucideNames)
            {
                try { var i = PluginResources.ReadImage($"{name}.png"); if (i != null) LucideCache[name] = i; }
                catch { }
            }

            PluginLog.Info($"Loaded {AgentIconCache.Count} agent icons, {LucideCache.Count} lucide icons");
        }

        // ── Button layout ────────────────────────────────────────

        public override IEnumerable<String> GetButtonPressActionNames(DeviceType _)
        {
            var names = new List<String>(9) { PluginDynamicFolder.NavigateUpActionName };
            for (var i = 0; i < 8; i++)
                names.Add(this.CreateCommandName($"{_view}_{_epoch}_{i}"));
            return names;
        }

        public override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) => "";

        // ── Command execution ────────────────────────────────────

        public override void RunCommand(String actionParameter)
        {
            var pos = ParsePos(actionParameter);
            if (pos < 0) return;

            switch (_view)
            {
                case "dashboard": OnDashboard(pos); break;
                case "skills":    OnSkills(pos); break;
                case "new-agent": OnNewAgent(pos); break;
                case "configs":   OnConfigs(pos); break;
                case "menu":      OnMenu(pos); break;
            }
        }

        // ── Tile rendering ───────────────────────────────────────

        public override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var pos = ParsePos(actionParameter);
            if (pos < 0) return null;

            var sz = SizeFor(imageSize);
            PluginLog.Verbose($"[TILE] pos={pos} imageSize={imageSize} sz={sz}");
            return _view switch
            {
                "dashboard"  => DrawDashboard(pos, sz),
                "skills"     => DrawSkills(pos, sz),
                "new-agent"  => DrawNewAgent(pos, sz),
                "configs"    => DrawConfigs(pos, sz),
                "menu"       => DrawMenu(pos, sz),
                _            => Empty(sz)
            };
        }

        // ══════════════════════════════════════════════════════════
        // DASHBOARD
        // ══════════════════════════════════════════════════════════

        private void OnDashboard(Int32 pos)
        {
            switch (pos)
            {
                case 0: _view = "new-agent"; Refresh(); return;
                case 1: _view = "menu"; Refresh(); return;
            }

            if (pos >= AgentStartPos && pos < AgentStartPos + AgentSlots)
            {
                var ai = _dashPage * AgentSlots + (pos - AgentStartPos);
                var agents = GetSortedAgents();
                if (ai >= agents.Count) return;
                var agent = agents[ai];
                this.Plugin.State.SelectedAgentId = agent.Id;

                // Double-tap detection: same agent tile within threshold → skills
                var now = DateTime.UtcNow;
                if (_lastTapPos == pos && (now - _lastTapTime).TotalMilliseconds < DoubleTapMs)
                {
                    _lastTapPos = -1;
                    _view = "skills";
                    _viewSwitchTime = DateTime.UtcNow;
                    Refresh();
                    return;
                }
                _lastTapPos = pos;
                _lastTapTime = now;

                // Single tap: focus terminal
                _ = this.Plugin.BridgeClient.SendOpenTerminal(agent.Id);
            }
        }

        private BitmapImage DrawDashboard(Int32 pos, Int32 sz)
        {
            switch (pos)
            {
                case 0: return TileCtrl("plus", "NEW", new BitmapColor(40, 40, 60), sz);
                case 1: return TileStatus(sz);
            }

            if (pos >= AgentStartPos && pos < AgentStartPos + AgentSlots)
            {
                var ai = _dashPage * AgentSlots + (pos - AgentStartPos);
                var agents = GetSortedAgents();
                return ai < agents.Count ? TileAgent(agents[ai], sz) : Empty(sz);
            }

            return Empty(sz);
        }

        // ══════════════════════════════════════════════════════════
        // SKILLS
        //   [BACK] [END] [Commit] [Review] [Clear]
        //   [Diff] [MODE] [Continue]
        // ══════════════════════════════════════════════════════════

        private void OnSkills(Int32 pos)
        {
            // Block input during cooldown to prevent accidental third-tap
            if ((DateTime.UtcNow - _viewSwitchTime).TotalMilliseconds < CooldownMs) return;

            var a = this.Plugin.State.GetSelectedAgent();
            if (a == null) { GoBack(); return; }
            // pos 0 = BACK, pos 1 = END, pos 2-5 = Skills[0-3], pos 6 = MODE, pos 7 = Continue
            if (pos == 0) { GoBack(); return; }
            if (pos == 1) { _ = this.Plugin.BridgeClient.SendCommand(a.Id, "kill"); GoBack(); return; }
            if (pos >= 2 && pos <= 5)
            {
                var skill = Skills[pos - 2];
                switch (skill.id)
                {
                    case "commit":
                        _ = this.Plugin.BridgeClient.SendSkill(a.Id, "commit"); GoBack(); break;
                    case "review":
                        _ = this.Plugin.BridgeClient.SendSkill(a.Id, "custom", "/simplify review the changes"); GoBack(); break;
                    // case "checkpoint":
                    //     _ = this.Plugin.BridgeClient.SendCommand(a.Id, "checkpoint"); break;
                    case "clear":
                        _ = this.Plugin.BridgeClient.SendSkill(a.Id, "custom", "/clear"); GoBack(); break;
                    case "diff":
                        _ = this.Plugin.BridgeClient.SendFocusView("diff", a.Id); break;
                }
                return;
            }
            switch (pos)
            {
                case 6: _ = this.Plugin.BridgeClient.SendCommand(a.Id, "cycle_mode"); break;
                case 7:
                    if (a.Status == AgentStatus.Waiting)
                        _ = this.Plugin.BridgeClient.SendCommand(a.Id, "approve");
                    else
                        _ = this.Plugin.BridgeClient.SendSkill(a.Id, "custom", "continue");
                    GoBack();
                    break;
            }
        }

        private BitmapImage DrawSkills(Int32 pos, Int32 sz)
        {
            if (pos == 0) return TileCtrl("chevron-left", "BACK", new BitmapColor(50, 50, 50), sz);
            if (pos == 1) return TileCtrl("icon-x", "END", new BitmapColor(180, 40, 40), sz);
            if (pos >= 2 && pos <= 5) { var s = Skills[pos - 2]; return TileCtrl(s.lucide, s.label, s.color, sz); }
            return pos switch
            {
                6 => TileCtrl("settings", "MODE", new BitmapColor(45, 138, 120), sz),
                7 => TileCtrl("play", "Continue", new BitmapColor(30, 120, 50), sz),
                _ => Empty(sz)
            };
        }

        // ══════════════════════════════════════════════════════════
        // NEW AGENT
        //   [BACK] [CONFIGS] [cla] [gem] [cdx] [aid] [opc] [amp]
        // ══════════════════════════════════════════════════════════

        private void OnNewAgent(Int32 pos)
        {
            if (pos == 0) { GoBack(); return; }
            if (pos == 1) { _previousView = "new-agent"; _view = "configs"; Refresh(); return; }
            var ai = pos - 2;
            if (ai >= 0 && ai < AgentTypes.Length)
            {
                var st = this.Plugin.State;
                _ = this.Plugin.BridgeClient.SendLaunch(".", AgentTypes[ai],
                    st.ModeOverride, st.EffortOverride);
                GoBack();
            }
        }

        private BitmapImage DrawNewAgent(Int32 pos, Int32 sz)
        {
            if (pos == 0) return TileCtrl("chevron-left", "BACK", new BitmapColor(50, 50, 50), sz);
            if (pos == 1) return TileCtrl("settings", "CONFIGS", new BitmapColor(60, 75, 100), sz);
            var ai = pos - 2;
            if (ai >= 0 && ai < AgentTypes.Length)
            {
                var n = AgentTypes[ai];
                var c = AgentColors.TryGetValue(n, out var cl) ? cl : new BitmapColor(80, 80, 80);
                return TileNewAgent(Cap(n), n, c, sz);
            }
            return Empty(sz);
        }

        // ══════════════════════════════════════════════════════════
        // CONFIGS
        //   [BACK] [WORKTREE] [MODE] [EFFORT]
        // ══════════════════════════════════════════════════════════

        private static readonly String[] ModeValues = { null, "plan", "auto", "bypassPermissions" };
        private static readonly String[] EffortValues = { null, "low", "medium", "high", "max" };

        private void OnConfigs(Int32 pos)
        {
            var st = this.Plugin.State;
            switch (pos)
            {
                case 0: GoBack(); return;
                case 1:
                    _ = this.Plugin.BridgeClient.SendToggleWorktree();
                    st.WorktreeEnabled = !st.WorktreeEnabled;
                    break;
                case 2: st.ModeOverride = CycleValue(st.ModeOverride, ModeValues); break;
                case 3: st.EffortOverride = CycleValue(st.EffortOverride, EffortValues); break;
                default: return;
            }
            Refresh();
        }

        private BitmapImage DrawConfigs(Int32 pos, Int32 sz)
        {
            var st = this.Plugin.State;
            var gray = new BitmapColor(90, 90, 90);
            return pos switch
            {
                0 => TileCtrl("chevron-left", "BACK", new BitmapColor(50, 50, 50), sz),
                1 => TileCtrl("git-branch",
                    st.WorktreeEnabled ? "WORKTREE" : "NO WKTREE",
                    st.WorktreeEnabled ? new BitmapColor(45, 138, 78) : gray, sz),
                2 => TileCtrl("settings",
                    FlagLabel(st.ModeOverride, "MODE"),
                    st.ModeOverride != null ? new BitmapColor(45, 138, 120) : gray, sz),
                3 => TileCtrl("layers",
                    FlagLabel(st.EffortOverride, "EFFORT"),
                    st.EffortOverride != null ? new BitmapColor(100, 80, 160) : gray, sz),
                _ => Empty(sz)
            };
        }

        private static String CycleValue(String current, String[] values)
        {
            var idx = Array.IndexOf(values, current);
            return values[(idx + 1) % values.Length];
        }

        private static String FlagLabel(String value, String defaultLabel)
        {
            if (value == null) return defaultLabel;
            if (value == "bypassPermissions") return "YOLO";
            return value.ToUpperInvariant();
        }

        // ══════════════════════════════════════════════════════════
        // MENU
        //   [BACK] [Confirm] [Pause] [End] [NextWait]
        //   [Wait1st] [Err1st] [Rdy1st]
        // ══════════════════════════════════════════════════════════

        private void OnMenu(Int32 pos)
        {
            // pos 0 = BACK, pos 1-7 = MenuActions[0-6]
            if (pos == 0) { GoBack(); return; }
            var ai = pos - 1;
            if (ai >= 0 && ai < MenuActions.Length) ExecMenu(MenuActions[ai].id);
        }

        private BitmapImage DrawMenu(Int32 pos, Int32 sz)
        {
            if (pos == 0) return TileCtrl("chevron-left", "BACK", new BitmapColor(50, 50, 50), sz);
            var ai = pos - 1;
            if (ai >= 0 && ai < MenuActions.Length)
                return TileCtrl(MenuActions[ai].lucide, MenuActions[ai].label, MenuActions[ai].color, sz);
            return Empty(sz);
        }

        private void ExecMenu(String id)
        {
            var agents = this.Plugin.State.Agents;
            switch (id)
            {
                case "confirm-all": foreach (var a in agents.Where(a => a.Status == AgentStatus.Waiting)) _ = this.Plugin.BridgeClient.SendCommand(a.Id, "approve"); break;
                case "pause-all": foreach (var a in agents) _ = this.Plugin.BridgeClient.SendCommand(a.Id, "pause"); break;
                case "kill-all": foreach (var a in agents) _ = this.Plugin.BridgeClient.SendCommand(a.Id, "kill"); break;
                case "focus-next":
                    var w = agents.FirstOrDefault(a => a.Status == AgentStatus.Waiting);
                    if (w != null) { this.Plugin.State.SelectedAgentId = w.Id; _ = this.Plugin.BridgeClient.SendOpenTerminal(w.Id); _view = "approval"; Refresh(); return; }
                    break;
                case "show-waiting":
                    SortAgentsFirst(AgentStatus.Waiting);
                    break;
                case "show-errors":
                    SortAgentsFirst(AgentStatus.Error);
                    break;
                case "show-ready":
                    SortAgentsFirst(AgentStatus.Idle);
                    break;
            }
            GoBack();
        }

        private void SortAgentsFirst(AgentStatus status)
        {
            _sortByStatus = status;
            _dashPage = 0;
        }

        /// Returns agents with persistent sort applied (if any).
        private List<AgentSession> GetSortedAgents()
        {
            var agents = this.Plugin.State.Agents;
            if (_sortByStatus is AgentStatus s)
                return agents.OrderByDescending(a => a.Status == s).ToList();
            return agents;
        }

        // ── Navigation & Refresh ────────────────────────────────

        private void GoBack() { _view = _previousView ?? "dashboard"; _previousView = "dashboard"; Refresh(); }

        private void Refresh()
        {
            _epoch++;
            this.ButtonActionNamesChanged();
        }

        internal void OnStateChanged()
        {
            Refresh();
        }

        /// Called by dial/roller adjustments to refresh tiles after selection change.
        internal void RefreshExternal() => Refresh();

        // ══════════════════════════════════════════════════════════
        // TILE RENDERERS — large text, consistent vertical layout
        // ══════════════════════════════════════════════════════════
        //
        // All tiles use the same 2-zone layout:
        //   Top zone  (0 → 55%): icon/number/name — large, centered
        //   Bot zone (55% → 100%): label — medium, centered
        //
        // This ensures everything aligns across all tile types.

        private static Int32 SizeFor(PluginImageSize s) => s switch
        {
            PluginImageSize.Width60 => 60,
            PluginImageSize.Width90 => 90,
            PluginImageSize.Width116 => 116,
            _ => (Int32)s  // Use the enum's numeric value directly
        };

        /// Agent status tile — name, status, icon
        private static BitmapImage TileAgent(AgentSession agent, Int32 sz)
        {
            using var b = new BitmapBuilder(sz, sz);
            b.Clear(SClr(agent.Status));

            // Name — upper area, 2 rows if needed
            var name = agent.Name?.ToUpperInvariant() ?? "?";
            var fontSize = sz * 17 / 100;  // ~20px at 116 — fits more chars without overflow
            var pad = sz * 10 / 100; // horizontal padding (~12px each side at 116)
            var tw = sz - pad * 2;   // text width
            var maxPerRow = 7; // fits visually within padded tile width
            var rowH = sz * 22 / 100;
            var topY = pad; // consistent top padding for 1 or 2 rows

            if (name.Length <= maxPerRow)
            {
                b.DrawText(name, pad, topY, tw, rowH, BitmapColor.White, fontSize);
            }
            else
            {
                // Split into 2 rows — prefer word boundary (space/hyphen)
                var split = -1;
                for (var i = Math.Min(name.Length - 1, maxPerRow); i > 0; i--)
                {
                    if (name[i] == ' ' || name[i] == '-') { split = i; break; }
                }
                if (split <= 0) split = Math.Min(maxPerRow, name.Length);

                var isSep = split < name.Length && (name[split] == ' ' || name[split] == '-');
                var row1 = name[..split].TrimEnd(' ', '-');
                var row2 = name[(split + (isSep ? 1 : 0))..];
                if (row2.Length > maxPerRow) row2 = row2[..maxPerRow];

                b.DrawText(row1, pad, topY, tw, rowH, BitmapColor.White, fontSize);
                b.DrawText(row2, pad, topY + rowH, tw, rowH, BitmapColor.White, fontSize);
            }

            // Status text — bottom-right
            var statusFont = sz / 6;
            var statusH = sz * 20 / 100;
            b.DrawText(STxt(agent.Status), sz * 35 / 100, sz - statusH - pad / 2, sz * 65 / 100 - pad, statusH,
                new BitmapColor(255, 255, 255, 200), statusFont);

            // Agent icon (bottom-left) or abbreviation fallback
            var agentType = agent.Agent?.ToLowerInvariant() ?? "";
            if (AgentIconCache.TryGetValue(agentType, out var icon))
            {
                var iconSz = sz / 4;
                b.DrawImage(icon, 2, sz - iconSz - 2, iconSz, iconSz);
            }
            else
            {
                var abbr = agent.Agent?[..Math.Min(2, agent.Agent?.Length ?? 0)]?.ToUpperInvariant() ?? "";
                b.DrawText(abbr, 2, sz - sz / 5, sz / 3, sz / 5,
                    new BitmapColor(255, 255, 255, 130), sz / 8);
            }

            return b.ToImage();
        }

        /// Control button — icon + label as tight centered unit
        private static BitmapImage TileCtrl(String lucideOrText, String label, BitmapColor bg, Int32 sz)
        {
            using var b = new BitmapBuilder(sz, sz);
            b.Clear(bg);

            var iconSz = sz * 34 / 100;
            var labelH = sz * 18 / 100;
            var gap = sz * 2 / 100;
            var totalH = iconSz + gap + labelH;
            var startY = (sz - totalH) / 2;

            if (LucideCache.TryGetValue(lucideOrText, out var icon))
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

        /// Info tile — two lines, both centered
        private static BitmapImage TileInfo(String top, String bottom, BitmapColor bg, Int32 sz)
        {
            using var b = new BitmapBuilder(sz, sz);
            b.Clear(bg);

            // Top text — centered in upper half
            b.DrawText(top, 0, 0, sz, sz / 2, BitmapColor.White, sz / 5);

            // Bottom text — centered in lower half
            b.DrawText(bottom ?? "", 0, sz / 2, sz, sz / 2,
                new BitmapColor(200, 200, 210), sz / 7);

            return b.ToImage();
        }

        /// New agent picker tile — icon + name, tight layout
        private static BitmapImage TileNewAgent(String name, String agentType, BitmapColor borderClr, Int32 sz)
        {
            using var b = new BitmapBuilder(sz, sz);
            b.Clear(new BitmapColor(28, 28, 38));
            b.DrawRectangle(0, 0, sz, sz, new BitmapColor(borderClr.R, borderClr.G, borderClr.B, 100));

            if (AgentIconCache.TryGetValue(agentType, out var icon))
            {
                var iconSz = sz * 36 / 100;
                var textH = sz * 18 / 100;
                var gap = sz * 2 / 100;
                var totalH = iconSz + gap + textH;
                var startY = (sz - totalH) / 2;
                b.DrawImage(icon, (sz - iconSz) / 2, startY, iconSz, iconSz);
                b.DrawText(name, 0, startY + iconSz + gap, sz, textH, BitmapColor.White, sz / 6);
            }
            else
            {
                b.DrawText(name, 0, 0, sz, sz, BitmapColor.White, sz / 4);
            }

            return b.ToImage();
        }

        /// Status/sessions tile — IDENTICAL zones and font sizes as TileCtrl
        private BitmapImage TileStatus(Int32 sz)
        {
            var agents = this.Plugin.State.Agents;
            var t = agents.Count;
            var w = agents.Count(a => a.Status == AgentStatus.Waiting);
            var wk = agents.Count(a => a.Status == AgentStatus.Working);
            var e = agents.Count(a => a.Status == AgentStatus.Error);

            using var b = new BitmapBuilder(sz, sz);
            b.Clear(new BitmapColor(40, 50, 60));

            // TileCtrl-matching layout with tighter number zone
            var iconSz = sz * 34 / 100;
            var labelH = sz * 18 / 100;
            var gap = sz * 2 / 100;
            var totalH = iconSz + gap + labelH;
            var startY = (sz - totalH) / 2;

            // Count number — draw in lower portion of icon zone so it sits close to label
            b.DrawText($"{t}", 0, startY + iconSz * 20 / 100, sz, iconSz * 80 / 100,
                new BitmapColor(200, 220, 255), sz / 3);

            // Label
            var labelY = startY + iconSz + gap;
            b.DrawText("SESSIONS", 0, labelY, sz, labelH,
                new BitmapColor(210, 210, 220), sz / 6);

            // Status dots — horizontal row below SESSIONS, in remaining bottom space
            var dotSz = sz * 6 / 100;
            var dotGap = sz * 4 / 100;
            var dotsWidth = dotSz * 3 + dotGap * 2;
            var dotX = (sz - dotsWidth) / 2;
            var dotY = labelY + labelH + sz * 3 / 100;

            var gClr = wk > 0 ? new BitmapColor(30, 120, 50) : new BitmapColor(60, 65, 70);
            var yClr = w > 0 ? new BitmapColor(180, 160, 30) : new BitmapColor(60, 65, 70);
            var rClr = e > 0 ? new BitmapColor(180, 40, 40) : new BitmapColor(60, 65, 70);
            b.FillRectangle(dotX, dotY, dotSz, dotSz, gClr);
            b.FillRectangle(dotX + dotSz + dotGap, dotY, dotSz, dotSz, yClr);
            b.FillRectangle(dotX + (dotSz + dotGap) * 2, dotY, dotSz, dotSz, rClr);

            return b.ToImage();
        }

        private static BitmapImage Empty(Int32 sz)
        {
            using var b = new BitmapBuilder(sz, sz);
            b.Clear(new BitmapColor(30, 30, 30));
            return b.ToImage();
        }

        // ── Helpers ─────────────────────────────────────────────

        private static BitmapColor SClr(AgentStatus s) => s switch
        {
            AgentStatus.Idle    => new BitmapColor(90, 90, 90),
            AgentStatus.Working => new BitmapColor(30, 120, 50),
            AgentStatus.Waiting => new BitmapColor(180, 160, 30),
            AgentStatus.Error   => new BitmapColor(180, 40, 40),
            _                   => new BitmapColor(50, 50, 50)
        };

        private static String STxt(AgentStatus s) => s switch
        {
            AgentStatus.Idle    => "ready",
            AgentStatus.Working => "running",
            AgentStatus.Waiting => "input !",
            AgentStatus.Error   => "error",
            _                   => "offline"
        };

        private static String Trn(String s, Int32 m) => String.IsNullOrEmpty(s) ? "?" : s.Length <= m ? s : s[..m];
        private static String Cap(String s) => String.IsNullOrEmpty(s) ? "" : Char.ToUpperInvariant(s[0]) + s[1..];

        private static Int32 ParsePos(String p)
        {
            if (String.IsNullOrEmpty(p)) return -1;
            var last = p.LastIndexOf('_');
            if (last < 0) return -1;
            return Int32.TryParse(p.AsSpan(last + 1), out var i) ? i : -1;
        }
    }
}
