using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace DSH.Chat
{
    /// <summary>一条聊天消息，序列化为 JSONL 的一行。</summary>
    [Serializable]
    public class ChatMessage
    {
        public string role;   // "user" | "assistant"
        public string text;
        public string ts;     // ISO-8601
    }

    /// <summary>
    /// Unity 内的 DSH 对话窗。
    ///
    /// 机制：消息以 JSONL 形式落在 &lt;工程&gt;/Library/DSH-Chat/chat.jsonl。
    ///   - 你在窗口里输入 → 追加一行 {role:"user"}  → DSH 侧轮询读取后回复
    ///   - DSH 回复      → 追加一行 {role:"assistant"} → 本窗口轮询文件后显示
    /// 这样 DSH 不需要接管 Unity 线程，Unity 也不需要网络服务。
    /// </summary>
    public class DSHChatWindow : EditorWindow
    {
        private const string DirName = "DSH-Chat";
        private const string FileName = "chat.jsonl";

        private static string ChatDir
        {
            get { return Path.Combine(Path.GetDirectoryName(Application.dataPath), "Library", DirName); }
        }

        private static string ChatFile
        {
            get { return Path.Combine(ChatDir, FileName); }
        }

        private readonly List<ChatMessage> _messages = new List<ChatMessage>();
        private string _input = string.Empty;
        private Vector2 _scroll;
        private double _lastPollTime;
        private long _lastLength = -1;
        private bool _scrollToBottom = true;
        private bool _sendOnEnter = true;

        [MenuItem("Tools/DSH 对话窗 %#d")]
        public static void Open()
        {
            WriteHeartbeat();
            var win = GetWindow<DSHChatWindow>("DSH 对话");
            win.minSize = new Vector2(380f, 460f);
            win.Show();
        }

        // ---------------- 工程心跳（供 DSH 插件统计"最近加载过的工程"） ----------------

        /// <summary>心跳文件默认目录：%USERPROFILE%\.dsh\unity-chat\heartbeats</summary>
        private static string HeartbeatDir
        {
            get
            {
                string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                return Path.Combine(home, ".dsh", "unity-chat", "heartbeats");
            }
        }

        [Serializable]
        private class ProjectHeartbeat
        {
            public string projectPath;
            public string projectName;
            public string unityVersion;
            public string loadedAt;
        }

        /// <summary>稳定的短哈希（FNV-1a），用于生成工程心跳文件名。</summary>
        private static string StableHash(string text)
        {
            unchecked
            {
                uint hash = 2166136261u;
                foreach (char c in text)
                {
                    hash ^= c;
                    hash *= 16777619u;
                }
                return hash.ToString("x8");
            }
        }

        private static string SanitizeName(string name)
        {
            var sb = new StringBuilder();
            foreach (char c in name)
            {
                sb.Append(char.IsLetterOrDigit(c) ? c : '_');
            }
            string s = sb.ToString();
            return s.Length > 40 ? s.Substring(0, 40) : s;
        }

        /// <summary>写入/更新本工程的心跳，让 DSH 插件知道"这个工程加载过对话窗"。</summary>
        private static void WriteHeartbeat()
        {
            try
            {
                string projectPath = Path.GetDirectoryName(Application.dataPath);
                string projectName = Path.GetFileName(projectPath);
                Directory.CreateDirectory(HeartbeatDir);

                var hb = new ProjectHeartbeat
                {
                    projectPath = projectPath,
                    projectName = projectName,
                    unityVersion = Application.unityVersion,
                    loadedAt = DateTime.UtcNow.ToString("o")
                };

                string file = Path.Combine(
                    HeartbeatDir,
                    SanitizeName(projectName) + "-" + StableHash(projectPath) + ".json");
                File.WriteAllText(file, JsonUtility.ToJson(hb), new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[DSH-Chat] 心跳写入失败: " + ex.Message);
            }
        }

        // ---------------- 随 Unity 启动自动打开 ----------------

        /// <summary>自动打开开关的 EditorPrefs 键（按工程路径隔离，避免多工程互相影响）。</summary>
        private static string AutoOpenPrefKey
        {
            get { return "DSH.Chat.AutoOpen:" + Application.dataPath; }
        }

        /// <summary>是否已开启"启动时自动打开"，默认开启。</summary>
        private static bool AutoOpenEnabled
        {
            get { return EditorPrefs.GetBool(AutoOpenPrefKey, true); }
            set { EditorPrefs.SetBool(AutoOpenPrefKey, value); }
        }

        /// <summary>Unity 加载该工程时自动弹出对话窗（可在菜单里关闭）。</summary>
        [InitializeOnLoadMethod]
        private static void AutoOpenOnLoad()
        {
            WriteHeartbeat();
            if (!AutoOpenEnabled) return;
            EditorApplication.delayCall += () =>
            {
                try
                {
                    if (EditorWindow.HasOpenInstances<DSHChatWindow>()) return;
                    Open();
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[DSH-Chat] 自动打开失败: " + ex.Message);
                }
            };
        }

        [MenuItem("Tools/DSH 对话窗设置/启动时自动打开", false, 1)]
        private static void ToggleAutoOpen()
        {
            AutoOpenEnabled = !AutoOpenEnabled;
            Debug.Log("[DSH-Chat] 启动时自动打开: " + (AutoOpenEnabled ? "已开启" : "已关闭"));
        }

        [MenuItem("Tools/DSH 对话窗设置/启动时自动打开", true)]
        private static bool ToggleAutoOpenValidate()
        {
            Menu.SetChecked("Tools/DSH 对话窗设置/启动时自动打开", AutoOpenEnabled);
            return true;
        }

        private void OnEnable()
        {
            EnsureFile();
            Reload();
        }

        private void Update()
        {
            if (EditorApplication.timeSinceStartup - _lastPollTime < 0.5) return;
            _lastPollTime = EditorApplication.timeSinceStartup;
            Reload();
        }

        private void OnGUI()
        {
            DrawHeader();
            EditorGUILayout.Space(2f);
            DrawMessages();
            EditorGUILayout.Space(2f);
            DrawComposer();
        }

        private void DrawHeader()
        {
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField("DSH 协作对话", EditorStyles.boldLabel);
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("刷新", GUILayout.Width(52f))) Reload();
            if (GUILayout.Button("清空", GUILayout.Width(52f)))
            {
                if (EditorUtility.DisplayDialog("清空对话", "确定要删除 chat.jsonl 里的所有消息吗？", "清空", "取消"))
                {
                    TryWriteAll(string.Empty);
                    _messages.Clear();
                    _lastLength = -1;
                    Reload();
                }
            }
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.LabelField("消息文件: " + ChatFile, EditorStyles.miniLabel);
            EditorGUILayout.LabelField(
                "用法：在下面输入并发送 → DSH 侧事件桥监听文件，约 2 秒内回复（无需轮询）",
                EditorStyles.miniLabel);
        }

        private void DrawMessages()
        {
            if (_scrollToBottom)
            {
                _scroll.y = float.MaxValue;
                _scrollToBottom = false;
            }

            _scroll = EditorGUILayout.BeginScrollView(_scroll, GUILayout.ExpandHeight(true));
            if (_messages.Count == 0)
            {
                EditorGUILayout.HelpBox("还没有消息。在下面输入第一句吧。", MessageType.Info);
            }
            else
            {
                for (int i = 0; i < _messages.Count; i++)
                {
                    DrawMessage(_messages[i]);
                }
            }
            EditorGUILayout.EndScrollView();
        }

        private void DrawMessage(ChatMessage m)
        {
            bool isUser = m != null && m.role == "user";
            string who = isUser ? "你" : "DSH";
            string body = m == null ? string.Empty : (m.text ?? string.Empty);

            var style = new GUIStyle(EditorStyles.label) { wordWrap = true, richText = false };
            var header = new GUIStyle(EditorStyles.miniBoldLabel);
            header.normal.textColor = isUser ? new Color(0.25f, 0.55f, 0.95f) : new Color(0.30f, 0.72f, 0.42f);

            EditorGUILayout.LabelField(who, header);
            EditorGUILayout.LabelField(body, style);
            EditorGUILayout.Space(4f);
        }

        private void DrawComposer()
        {
            EditorGUILayout.BeginHorizontal();
            _input = EditorGUILayout.TextField(_input, GUILayout.ExpandWidth(true));
            GUI.enabled = !string.IsNullOrWhiteSpace(_input);
            if (GUILayout.Button("发送", GUILayout.Width(60f))) Send();
            GUI.enabled = true;
            EditorGUILayout.EndHorizontal();

            _sendOnEnter = EditorGUILayout.ToggleLeft("回车发送（Shift+回车换行不可用，此为单行输入）", _sendOnEnter);

            var e = Event.current;
            if (_sendOnEnter && e != null && e.type == EventType.KeyDown && (e.keyCode == KeyCode.Return || e.keyCode == KeyCode.KeypadEnter))
            {
                if (!string.IsNullOrWhiteSpace(_input))
                {
                    Send();
                    e.Use();
                }
            }

            EditorGUILayout.LabelField(
                "最近同步: " + DateTime.Now.ToString("HH:mm:ss") + " ｜ 消息数: " + _messages.Count,
                EditorStyles.miniLabel);
        }

        private void Send()
        {
            string text = (_input ?? string.Empty).Trim();
            if (text.Length == 0) return;

            var msg = new ChatMessage
            {
                role = "user",
                text = text,
                ts = DateTime.UtcNow.ToString("o")
            };

            if (TryAppend(msg))
            {
                _input = string.Empty;
                _scrollToBottom = true;
                // 不在 OnGUI 里立刻重载（会让布局组前后不一致）；Update() 会在 0.5s 内轮询到
                Repaint();
            }
            else
            {
                EditorUtility.DisplayDialog("发送失败", "无法写入消息文件，请检查路径权限:\n" + ChatFile, "好");
            }
        }

        // ---------------- 文件读写 ----------------

        private static void EnsureFile()
        {
            try
            {
                if (!Directory.Exists(ChatDir)) Directory.CreateDirectory(ChatDir);
                if (!File.Exists(ChatFile)) File.WriteAllText(ChatFile, string.Empty, new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[DSH-Chat] 初始化消息文件失败: " + ex.Message);
            }
        }

        private static bool TryAppend(ChatMessage msg)
        {
            for (int attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    EnsureFile();
                    string line = JsonUtility.ToJson(msg) + "\n";
                    using (var fs = new FileStream(ChatFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
                    using (var sw = new StreamWriter(fs, new UTF8Encoding(false)))
                    {
                        sw.Write(line);
                    }
                    return true;
                }
                catch (IOException)
                {
                    System.Threading.Thread.Sleep(80);
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[DSH-Chat] 写入失败: " + ex.Message);
                    return false;
                }
            }
            return false;
        }

        private static bool TryWriteAll(string content)
        {
            try
            {
                EnsureFile();
                File.WriteAllText(ChatFile, content ?? string.Empty, new UTF8Encoding(false));
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[DSH-Chat] 清空失败: " + ex.Message);
                return false;
            }
        }

        private void Reload()
        {
            try
            {
                EnsureFile();
                long len = new FileInfo(ChatFile).Length;
                if (len == _lastLength) return;
                _lastLength = len;

                var list = new List<ChatMessage>();
                string raw;
                using (var fs = new FileStream(ChatFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var sr = new StreamReader(fs, new UTF8Encoding(false)))
                {
                    raw = sr.ReadToEnd();
                }

                foreach (var line in raw.Split('\n'))
                {
                    string t = line.Trim();
                    if (t.Length == 0) continue;
                    try
                    {
                        var m = JsonUtility.FromJson<ChatMessage>(t);
                        if (m != null) list.Add(m);
                    }
                    catch { /* 跳过坏行 */ }
                }

                if (list.Count != _messages.Count) _scrollToBottom = true;
                _messages.Clear();
                _messages.AddRange(list);
                Repaint();
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[DSH-Chat] 读取失败: " + ex.Message);
            }
        }
    }
}
