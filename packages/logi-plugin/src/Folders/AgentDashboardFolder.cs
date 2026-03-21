namespace Loupedeck.AgentDeckPlugin.Folders
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using Loupedeck.AgentDeckPlugin.Models;

    public class AgentDashboardFolder : PluginDynamicFolder
    {
        private const Int32 AgentSlots = 5;

        private new AgentDeckPlugin Plugin => (AgentDeckPlugin)base.Plugin;

        private String _view = "dashboard";
        private Int32 _dashPage = 0;
        private Int32 _menuPage = 0;
        private Int32 _epoch = 0;

        // Icon caches (loaded from embedded resources)
        private static readonly Dictionary<String, BitmapImage> AgentIconCache = new();
        private static readonly Dictionary<String, BitmapImage> LucideCache = new();
        private static Boolean _iconsLoaded;

        private static readonly String[] AgentTypes = { "claude", "gemini", "codex", "aider", "opencode" };

        private static readonly (String id, String label, String lucide, BitmapColor color)[] Skills =
        {
            ("commit",   "Commit",   "check",      new BitmapColor(30, 120, 50)),
            ("fix",      "Fix",      "wrench",     new BitmapColor(180, 160, 30)),
            ("test",     "Test",     "test-tube",   new BitmapColor(45, 138, 78)),
            ("refactor", "Refactor", "refresh-cw",  new BitmapColor(68, 136, 187)),
            ("review",   "Review",   "eye",         new BitmapColor(136, 85, 187)),
            ("explain",  "Explain",  "lightbulb",   new BitmapColor(212, 176, 48)),
        };

        private static readonly (String id, String label, String lucide, BitmapColor color)[] MenuActions =
        {
            ("confirm-all",  "Confirm All",  "check",         new BitmapColor(30, 120, 50)),
            ("pause-all",    "Pause All",    "circle-pause",  new BitmapColor(136, 102, 34)),
            ("kill-all",     "End All",      "icon-x",        new BitmapColor(180, 40, 40)),
            ("show-waiting", "Wait First",   "circle-dot",    new BitmapColor(180, 160, 30)),
            ("show-errors",  "Err First",    "icon-x",        new BitmapColor(180, 40, 40)),
            ("focus-next",   "Next Wait",    "play",          new BitmapColor(212, 176, 48)),
        };

        private static readonly Dictionary<String, BitmapColor> AgentColors = new()
        {
            { "claude",   new BitmapColor(217, 119, 6) },
            { "gemini",   new BitmapColor(26, 115, 232) },
            { "codex",    new BitmapColor(16, 163, 127) },
            { "aider",    new BitmapColor(230, 126, 34) },
            { "opencode", new BitmapColor(106, 77, 186) },
        };

        public AgentDashboardFolder()
        {
            this.DisplayName = "AgentDeck";
            this.GroupName = "AgentDeck";
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
                "hash", "rotate-ccw", "wrench", "test-tube", "refresh-cw", "code",
                "eye", "lightbulb"
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
                case "approval":  OnApproval(pos); break;
                case "skills":    OnSkills(pos); break;
                case "new-agent": OnNewAgent(pos); break;
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
                "approval"   => DrawApproval(pos, sz),
                "skills"     => DrawSkills(pos, sz),
                "new-agent"  => DrawNewAgent(pos, sz),
                "menu"       => DrawMenu(pos, sz),
                _            => Empty(sz)
            };
        }

        // ══════════════════════════════════════════════════════════
        // DASHBOARD
        // ══════════════════════════════════════════════════════════

        private void OnDashboard(Int32 pos)
        {
            if (pos < AgentSlots)
            {
                var ai = _dashPage * AgentSlots + pos;
                var agents = this.Plugin.State.Agents;
                if (ai >= agents.Count) return;
                var agent = agents[ai];
                this.Plugin.State.SelectedAgentId = agent.Id;
                _ = this.Plugin.BridgeClient.SendOpenTerminal(agent.Id);
                if (agent.Status == AgentStatus.Waiting) _view = "approval";
                else if (agent.Status == AgentStatus.Idle || agent.Status == AgentStatus.Error) _view = "skills";
                Refresh();
            }
            else switch (pos)
            {
                case 5: _view = "new-agent"; Refresh(); break;
                case 6:
                    var p = Math.Max(1, (Int32)Math.Ceiling(this.Plugin.State.Agents.Count / (Double)AgentSlots));
                    _dashPage = (_dashPage + 1) % p;
                    Refresh();
                    break;
                case 7: _view = "menu"; _menuPage = 0; Refresh(); break;
            }
        }

        private BitmapImage DrawDashboard(Int32 pos, Int32 sz)
        {
            if (pos < AgentSlots)
            {
                var ai = _dashPage * AgentSlots + pos;
                var agents = this.Plugin.State.Agents;
                return ai < agents.Count ? TileAgent(agents[ai], sz) : Empty(sz);
            }
            return pos switch
            {
                5 => TileCtrl("plus", "NEW", new BitmapColor(40, 40, 60), sz),
                6 => TileStatus(sz),
                7 => TileCtrl("menu", "MENU", new BitmapColor(40, 50, 50), sz),
                _ => Empty(sz)
            };
        }

        // ══════════════════════════════════════════════════════════
        // APPROVAL
        //   [UP]  [CONT]  [PREV]  [DN]  [NXT]  [BACK]  [CFM]  [CXL]
        // ══════════════════════════════════════════════════════════

        private void OnApproval(Int32 pos)
        {
            var a = this.Plugin.State.GetSelectedAgent();
            if (a == null) { GoBack(); return; }
            switch (pos)
            {
                case 0: _ = this.Plugin.BridgeClient.SendCommand(a.Id, "nav_up"); break;
                case 1: _ = this.Plugin.BridgeClient.SendSkill(a.Id, "custom", "continue"); break;
                case 2: _ = this.Plugin.BridgeClient.SendCommand(a.Id, "nav_left"); break;
                case 3: _ = this.Plugin.BridgeClient.SendCommand(a.Id, "nav_down"); break;
                case 4: _ = this.Plugin.BridgeClient.SendCommand(a.Id, "nav_right"); break;
                case 5: GoBack(); break;
                case 6: _ = this.Plugin.BridgeClient.SendCommand(a.Id, "approve"); break;
                case 7: _ = this.Plugin.BridgeClient.SendCommand(a.Id, "reject"); GoBack(); break;
            }
        }

        private BitmapImage DrawApproval(Int32 pos, Int32 sz)
        {
            return pos switch
            {
                0 => TileCtrl("chevron-up", "UP", new BitmapColor(50, 50, 60), sz),
                1 => TileCtrl("play", "CONTINUE", new BitmapColor(45, 120, 90), sz),
                2 => TileCtrl("chevron-left", "PREV", new BitmapColor(50, 50, 60), sz),
                3 => TileCtrl("chevron-down", "DOWN", new BitmapColor(50, 50, 60), sz),
                4 => TileCtrl("chevron-right", "NEXT", new BitmapColor(50, 50, 60), sz),
                5 => TileCtrl("chevron-left", "BACK", new BitmapColor(50, 50, 50), sz),
                6 => TileCtrl("check", "CONFIRM", new BitmapColor(30, 120, 50), sz),
                7 => TileCtrl("icon-x", "CANCEL", new BitmapColor(180, 40, 40), sz),
                _ => Empty(sz)
            };
        }

        // ══════════════════════════════════════════════════════════
        // SKILLS
        //   [Cmt] [Fix] [Tst] [Ref] [Rev]  [BACK]  [Exp] [CUS]
        // ══════════════════════════════════════════════════════════

        private void OnSkills(Int32 pos)
        {
            var a = this.Plugin.State.GetSelectedAgent();
            if (a == null) { GoBack(); return; }
            // pos 0-4 = skills 0-4, pos 5 = BACK, pos 6 = skill 5 (explain), pos 7 = custom
            if (pos < 5) { _ = this.Plugin.BridgeClient.SendSkill(a.Id, Skills[pos].id); GoBack(); }
            else switch (pos)
            {
                case 5: GoBack(); break;
                case 6: _ = this.Plugin.BridgeClient.SendSkill(a.Id, Skills[5].id); GoBack(); break;
                case 7: _ = this.Plugin.BridgeClient.SendCommand(a.Id, "kill"); GoBack(); break;
            }
        }

        private BitmapImage DrawSkills(Int32 pos, Int32 sz)
        {
            if (pos < 5) { var s = Skills[pos]; return TileCtrl(s.lucide, s.label, s.color, sz); }
            return pos switch
            {
                5 => TileCtrl("chevron-left", "BACK", new BitmapColor(50, 50, 50), sz),
                6 => TileCtrl(Skills[5].lucide, Skills[5].label, Skills[5].color, sz),
                7 => TileCtrl("icon-x", "END", new BitmapColor(180, 40, 40), sz),
                _ => Empty(sz)
            };
        }

        // ══════════════════════════════════════════════════════════
        // NEW AGENT
        //   [cla] [gem] [cdx] [aid] [opc]  [BACK]  [--] [WKT]
        // ══════════════════════════════════════════════════════════

        private void OnNewAgent(Int32 pos)
        {
            if (pos < AgentTypes.Length) { _ = this.Plugin.BridgeClient.SendLaunch(".", AgentTypes[pos]); GoBack(); }
            else switch (pos)
            {
                case 5: GoBack(); break;
                case 7: _ = this.Plugin.BridgeClient.SendToggleWorktree(); this.Plugin.State.WorktreeEnabled = !this.Plugin.State.WorktreeEnabled; Refresh(); break;
            }
        }

        private BitmapImage DrawNewAgent(Int32 pos, Int32 sz)
        {
            if (pos < AgentTypes.Length)
            {
                var n = AgentTypes[pos];
                var c = AgentColors.TryGetValue(n, out var cl) ? cl : new BitmapColor(80, 80, 80);
                return TileNewAgent(Cap(n), n, c, sz);
            }
            return pos switch
            {
                5 => TileCtrl("chevron-left", "BACK", new BitmapColor(50, 50, 50), sz),
                7 => TileCtrl("git-branch",
                    this.Plugin.State.WorktreeEnabled ? "WORKTREE" : "NO WKTREE",
                    this.Plugin.State.WorktreeEnabled ? new BitmapColor(45, 138, 78) : new BitmapColor(90, 90, 90), sz),
                _ => Empty(sz)
            };
        }

        // ══════════════════════════════════════════════════════════
        // MENU
        //   [a0] [a1] [a2] [a3] [a4]  [BACK]  [a5] [PG]
        // ══════════════════════════════════════════════════════════

        private void OnMenu(Int32 pos)
        {
            // pos 0-4 = actions 0-4, pos 5 = BACK, pos 6 = action 5, pos 7 = PAGE
            if (pos < 5) { var ai = _menuPage * 6 + pos; if (ai < MenuActions.Length) ExecMenu(MenuActions[ai].id); return; }
            switch (pos)
            {
                case 5: GoBack(); break;
                case 6: { var ai = _menuPage * 6 + 5; if (ai < MenuActions.Length) ExecMenu(MenuActions[ai].id); } break;
                case 7: { var p = Math.Max(1, (Int32)Math.Ceiling(MenuActions.Length / 6.0)); _menuPage = (_menuPage + 1) % p; Refresh(); } break;
            }
        }

        private BitmapImage DrawMenu(Int32 pos, Int32 sz)
        {
            // pos 0-4 = page actions 0-4
            if (pos < 5) { var ai = _menuPage * 6 + pos; return ai < MenuActions.Length ? TileCtrl(MenuActions[ai].lucide, MenuActions[ai].label, MenuActions[ai].color, sz) : Empty(sz); }
            return pos switch
            {
                5 => TileCtrl("chevron-left", "BACK", new BitmapColor(50, 50, 50), sz),
                6 => DrawMenuAction(_menuPage * 6 + 5, sz),
                7 => TileCtrl("layers", "PAGE", new BitmapColor(50, 50, 60), sz),
                _ => Empty(sz)
            };
        }

        private static BitmapImage DrawMenuAction(Int32 ai, Int32 sz)
        {
            return ai < MenuActions.Length
                ? TileCtrl(MenuActions[ai].lucide, MenuActions[ai].label, MenuActions[ai].color, sz)
                : Empty(sz);
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
            }
            GoBack();
        }

        // ── Navigation & Refresh ────────────────────────────────

        private void GoBack() { _view = "dashboard"; Refresh(); }

        private void Refresh()
        {
            _epoch++;
            this.ButtonActionNamesChanged();
        }

        internal void OnStateChanged()
        {
            if (_view == "approval")
            {
                var a = this.Plugin.State.GetSelectedAgent();
                if (a == null || a.Status != AgentStatus.Waiting) _view = "dashboard";
            }
            Refresh();
        }

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

            // Name — large, upper area
            b.DrawText(Trn(agent.Name, 5), 0, 0, sz, sz / 2, BitmapColor.White, sz / 4);

            // Status text — medium, lower area
            b.DrawText(STxt(agent.Status), 0, sz * 50 / 100, sz, sz * 30 / 100,
                new BitmapColor(255, 255, 255, 200), sz / 6);

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
            AgentStatus.Waiting => "INPUT!",
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
