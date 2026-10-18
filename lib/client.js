// DSH Unity 对话桥 —— 设置页「Unity-Chat」
// 注册到 设置 → settings.section 槽位；配置读写走官方 remote.settings（describe/mutate）。
// 格式：DSH Web 客户端的 ModuleLoader 包，无需构建。
window.__ModuleLoader__.load({
  id: "dsh-plugin-unity-chat",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    const React = require("react")
    const { jsx, jsxs } = require("react/jsx-runtime")

    /** 与 bundle patch 插入的 entry id 一致，也是设置命名空间。 */
    const NS = "unity-chat"

    const EMPTY = {
      sessionId: "",
      projects: "",
      pollMs: "",
      sleepPollMs: "",
      idleMs: "",
      deployScript: true,
      recentLimit: "",
      mcpEnabled: false,
      mcpPort: "",
      mcpServerPath: "",
      mcpServerSource: "",
      recentProjects: []
    }

    function text(value) {
      return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)
    }

    function num(value) {
      return typeof value === "number" ? String(value) : ""
    }

    /** namespace 描述符 → 表单状态（合并 base / value / user 三层，user 覆盖优先） */
    function readForm(source) {
      const base = (source && source.base) || {}
      const value = (source && source.value) || {}
      const user = (source && source.user) || {}
      const section = { ...base, ...value, ...user }
      console.info("[unity-chat] 设置命名空间", {
        ns: source && source.ns,
        revision: source && source.revision,
        baseKeys: Object.keys(base),
        valueKeys: Object.keys(value),
        userKeys: Object.keys(user),
        recentProjects: section.recentProjects
      })
      return {
        sessionId: text(section.sessionId),
        projects: Array.isArray(section.projects) ? section.projects.join("\n") : "",
        pollMs: num(section.pollMs),
        sleepPollMs: num(section.sleepPollMs),
        idleMs: num(section.idleMs),
        deployScript: section.deployScript !== false,
        recentLimit: num(section.recentLimit),
        mcpEnabled: section.mcpEnabled === true,
        mcpPort: num(section.mcpPort),
        mcpServerPath: text(section.mcpServerPath),
        mcpServerSource: text(section.mcpServerSource),
        // 只读：由宿主自动写回
        recentProjects: Array.isArray(section.recentProjects)
          ? section.recentProjects.map((item) => text(item))
          : []
      }
    }

    function parseNumber(raw, min, max) {
      const trimmed = String(raw).trim()
      if (trimmed === "") return { kind: "clear" }
      const parsed = Number(trimmed)
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) return { kind: "invalid" }
      return { kind: "set", value: parsed }
    }

    function validate(state) {
      if (state.sessionId.trim() === "") return "会话 ID 不能为空。"
      if (state.projects.trim() === "") return "至少填写一个 Unity 工程路径（每行一个）。"
      const checks = [
        ["活跃期间隔", state.pollMs, 300, 2147483647],
        ["休眠期间隔", state.sleepPollMs, 1000, 2147483647],
        ["空闲阈值", state.idleMs, 0, 2147483647],
        ["最近工程数量", state.recentLimit, 1, 100],
        ["MCP 端口", state.mcpPort === "" ? "8080" : state.mcpPort, 1, 65535]
      ]
      for (const [label, raw, min, max] of checks) {
        if (parseNumber(raw, min, max).kind === "invalid") return `${label} 取值不合法（${min} ~ ${max}）。`
      }
      return undefined
    }

    /** 表单状态 → settings.mutate 的 ops */
    function buildOps(state) {
      const ops = []
      const set = (path, value) => ops.push({ op: "set", path, value })
      const maybe = (path, raw) => {
        const trimmed = String(raw).trim()
        if (trimmed === "") ops.push({ op: "unset", path })
        else set(path, trimmed)
      }

      set(["sessionId"], state.sessionId.trim())
      set(
        ["projects"],
        state.projects
          .split(/[\n;]+/)
          .map((item) => item.trim())
          .filter((item) => item !== "")
      )
      const numbers = [
        [["pollMs"], state.pollMs, 1800],
        [["sleepPollMs"], state.sleepPollMs, 30000],
        [["idleMs"], state.idleMs, 300000],
        [["recentLimit"], state.recentLimit, 3],
        [["mcpPort"], state.mcpPort, 8080]
      ]
      for (const [path, raw, fallback] of numbers) {
        const parsed = parseNumber(raw, 0, 2147483647)
        set(path, parsed.kind === "set" ? parsed.value : fallback)
      }
      set(["deployScript"], Boolean(state.deployScript))
      set(["mcpEnabled"], Boolean(state.mcpEnabled))
      maybe(["mcpServerPath"], state.mcpServerPath)
      maybe(["mcpServerSource"], state.mcpServerSource)
      return ops
    }

    // ---------------- UI ----------------

    // 样式只用宿主主题 token（--dsw-alias-*），不写死颜色，保证明暗主题一致。
    const T = {
      labelPrimary: "var(--dsw-alias-label-primary)",
      labelSecondary: "var(--dsw-alias-label-secondary)",
      labelError: "var(--dsw-alias-label-error)",
      border: "var(--dsw-alias-border-l2)",
      success: "var(--dsw-alias-state-success-primary)"
    }

    const styles = {
      wrap: { display: "flex", flexDirection: "column", gap: 18, maxWidth: 860, fontSize: 13, color: T.labelPrimary },
      section: { display: "flex", flexDirection: "column", gap: 10 },
      title: { margin: "6px 0", fontSize: 14, fontWeight: 600, color: T.labelPrimary },
      field: { display: "flex", flexDirection: "column", gap: 4 },
      label: { fontWeight: 600, color: T.labelPrimary },
      hint: { color: T.labelSecondary, lineHeight: 1.5 },
      input: {
        padding: "6px 8px",
        fontSize: 13,
        borderRadius: 6,
        border: `1px solid ${T.border}`,
        background: "transparent",
        color: T.labelPrimary
      },
      textarea: {
        padding: "6px 8px",
        fontSize: 13,
        minHeight: 72,
        borderRadius: 6,
        border: `1px solid ${T.border}`,
        background: "transparent",
        color: T.labelPrimary,
        fontFamily: "inherit"
      },
      row: { display: "flex", alignItems: "flex-start", gap: 8 },
      actions: { display: "flex", alignItems: "center", gap: 10, marginTop: 4 },
      button: {
        padding: "6px 14px",
        fontSize: 13,
        borderRadius: 6,
        border: `1px solid ${T.border}`,
        background: "transparent",
        color: T.labelPrimary,
        cursor: "pointer"
      },
      ok: { color: T.success },
      err: { color: T.labelError }
    }

    function Field(props) {
      return jsxs("label", {
        style: styles.field,
        children: [
          jsx("span", { style: styles.label, children: props.label }),
          jsx("input", {
            style: styles.input,
            type: props.numeric ? "number" : "text",
            value: props.value,
            placeholder: props.placeholder || "",
            disabled: props.disabled,
            onChange: (event) => props.onChange(event.target.value)
          }),
          props.hint ? jsx("span", { style: styles.hint, children: props.hint }) : null
        ]
      })
    }

    function Toggle(props) {
      return jsxs("label", {
        style: { ...styles.row, cursor: props.disabled ? "default" : "pointer" },
        children: [
          jsx("input", {
            type: "checkbox",
            checked: Boolean(props.checked),
            disabled: props.disabled,
            onChange: (event) => props.onChange(event.target.checked)
          }),
          jsxs("span", {
            children: [
              jsx("span", { style: styles.label, children: props.label }),
              props.hint ? jsx("div", { style: styles.hint, children: props.hint }) : null
            ]
          })
        ]
      })
    }

    function UnityChatSettingsPanel(props) {
      const remote = props && props.remote
      console.info("[unity-chat] 设置面板已挂载", {
        hasRemote: remote !== undefined,
        hasSettings: !!(remote && remote.settings),
        propsKeys: props ? Object.keys(props) : []
      })
      return jsx(PanelBoundary, { children: jsx(PanelBody, { remote }) })
    }

    /** 渲染错误会被捕获并显示在页面上，避免"空白无提示"。 */
    class PanelBoundaryInner extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: undefined }
      }
      static getDerivedStateFromError(error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
      componentDidCatch(error, info) {
        console.error("[unity-chat] 设置面板渲染失败", error, info)
      }
      render() {
        if (this.state.error !== undefined) {
          return jsxs("div", {
            style: { padding: 12, color: T.labelError, fontSize: 13, lineHeight: 1.6 },
            children: [
              jsx("div", { children: "Unity-Chat 设置面板渲染失败：" }),
              jsx("pre", { style: { whiteSpace: "pre-wrap" }, children: this.state.error })
            ]
          })
        }
        return this.props.children
      }
    }

    function PanelBoundary(props) {
      return jsx(PanelBoundaryInner, { children: props.children })
    }

    function PanelBody({ remote }) {
      const [state, setState] = React.useState(EMPTY)
      const [loaded, setLoaded] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [message, setMessage] = React.useState(undefined)
      const revision = React.useRef(undefined)

      /** 读取当前配置（也用于「刷新」按钮获取宿主写回的最近工程） */
      const load = React.useCallback(async () => {
        if (remote === undefined) {
          setMessage({ kind: "err", text: "设置服务不可用。" })
          setLoaded(true)
          return
        }
        try {
          const res = await remote.settings.describe()
          if (!res || !res.ok || res.value === undefined) {
            setMessage({ kind: "err", text: (res && res.error && res.error.message) || "读取设置失败。" })
            setLoaded(true)
            return
          }
          const source = res.value.namespaces.find((row) => row.ns === NS)
          if (source === undefined) {
            const available = res.value.namespaces.map((row) => String(row.ns)).join(", ") || "(none)"
            setMessage({ kind: "err", text: `未找到设置命名空间 "${NS}"。可用：${available}` })
            setLoaded(true)
            return
          }
          revision.current = typeof source.revision === "number" ? source.revision : undefined
          setState(readForm(source))
          setLoaded(true)
        } catch (error) {
          setMessage({ kind: "err", text: error instanceof Error ? error.message : String(error) })
          setLoaded(true)
        }
      }, [remote])

      React.useEffect(() => {
        void load()
      }, [load])

      // 设置页打开期间每 10 秒自动刷新一次，让"最近工程"接近实时（宿主每 15s 汇总心跳）
      React.useEffect(() => {
        const timer = setInterval(() => { void load() }, 10000)
        return () => clearInterval(timer)
      }, [load])

      const patch = (changes) => {
        setState((prev) => ({ ...prev, ...changes }))
        setMessage(undefined)
      }

      const save = async () => {
        if (remote === undefined) return
        const problem = validate(state)
        if (problem !== undefined) {
          setMessage({ kind: "err", text: problem })
          return
        }
        setSaving(true)
        try {
          const res = await remote.settings.mutate(NS, buildOps(state), revision.current)
          if (!res || !res.ok) {
            setMessage({ kind: "err", text: (res && res.error && res.error.message) || "保存失败。" })
            return
          }
          if (res.value && typeof res.value.revision === "number") revision.current = res.value.revision
          setMessage({ kind: "ok", text: "已保存并热生效。" })
        } catch (error) {
          setMessage({ kind: "err", text: error instanceof Error ? error.message : String(error) })
        } finally {
          setSaving(false)
        }
      }

      if (!loaded && message === undefined) {
        return jsx("div", { style: styles.hint, children: "加载设置中…" })
      }

      const disabled = saving
      return jsxs("div", {
        style: styles.wrap,
        children: [
          jsxs("div", {
            children: [
              jsx("h2", { style: { margin: "0 0 4px", fontSize: 16 }, children: "Unity-Chat" }),
              jsx("div", {
                style: styles.hint,
                children: "Unity 对话框与 DSH 的连接。工程打开时会自动弹出对话框；每个工程使用自己的聊天文件。"
              })
            ]
          }),
          jsxs("section", {
            style: styles.section,
            children: [
              jsx("h3", { style: styles.title, children: "对话桥" }),
              jsx(Field, {
                label: "DSH 会话 ID",
                value: state.sessionId,
                disabled,
                hint: "Unity 里的消息会作为用户回合注入这个会话。",
                onChange: (value) => patch({ sessionId: value })
              }),
              jsx("label", {
                style: styles.field,
                children: [
                  jsx("span", { style: styles.label, children: "Unity 工程路径（每行一个）" }),
                  jsx("textarea", {
                    style: styles.textarea,
                    value: state.projects,
                    placeholder: "E:\\Games\\MyProject",
                    disabled,
                    onChange: (event) => patch({ projects: event.target.value })
                  }),
                  jsx("span", {
                    style: styles.hint,
                    children: "插件会把这些工程的 Assets/Editor/DSHChatWindow.cs 自动部署好。"
                  })
                ]
              }),
              jsx(Toggle, {
                label: "自动部署对话窗脚本",
                checked: state.deployScript,
                disabled,
                hint: "关闭后只监听聊天文件，不修改工程。",
                onChange: (value) => patch({ deployScript: value })
              })
            ]
          }),
          jsxs("section", {
            style: styles.section,
            children: [
              jsx("h3", { style: styles.title, children: "轮询与休眠" }),
              jsx(Field, {
                label: "活跃期检查间隔（毫秒）",
                numeric: true,
                value: state.pollMs,
                disabled,
                hint: "默认 1800；越小时响应越快。",
                onChange: (value) => patch({ pollMs: value })
              }),
              jsx(Field, {
                label: "休眠期检查间隔（毫秒）",
                numeric: true,
                value: state.sleepPollMs,
                disabled,
                hint: "默认 30000；空闲后降频但仍可被唤醒。",
                onChange: (value) => patch({ sleepPollMs: value })
              }),
              jsx(Field, {
                label: "空闲多久进入休眠（毫秒）",
                numeric: true,
                value: state.idleMs,
                disabled,
                hint: "默认 300000；填 0 表示永不休眠。",
                onChange: (value) => patch({ idleMs: value })
              }),
              jsx(Field, {
                label: "「最近工程」保留数量",
                numeric: true,
                value: state.recentLimit,
                disabled,
                hint: "默认 3。最近工程会显示在下方，也可通过对外的 unity_chat_status 工具查看。",
                onChange: (value) => patch({ recentLimit: value })
              })
            ]
          }),
          jsxs("section", {
            style: styles.section,
            children: [
              jsxs("div", {
                style: { display: "flex", alignItems: "center", gap: 10 },
                children: [
                  jsx("h3", { style: { ...styles.title, margin: 0 }, children: "最近加载过对话窗的工程" }),
                  jsx("button", { style: styles.button, onClick: () => void load(), children: "刷新" })
                ]
              }),
              jsx("div", {
                style: { display: "flex", flexDirection: "column", gap: 6 },
                children: (Array.isArray(state.recentProjects) && state.recentProjects.length > 0 ? state.recentProjects : ["", "", ""]).map((name, index) =>
                  jsx(
                    "div",
                    {
                      style: {
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: `1px dashed ${T.border}`,
                        color: name === "" ? T.labelSecondary : T.labelPrimary
                      },
                      children: name === "" ? "（空白）" : name
                    },
                    `recent-item-${index}`
                  )
                )
              }),
              jsx("div", {
                style: styles.hint,
                children: "由 Unity 启动时写入的心跳自动汇总；本页每 10 秒自动刷新，不足 3 个时以空白占位。"
              })
            ]
          }),
          jsxs("section", {
            style: styles.section,
            children: [
              jsx("h3", { style: styles.title, children: "MCP 服务（安装 / 启停）" }),
              jsx(Toggle, {
                label: "启用 MCP 服务",
                checked: state.mcpEnabled,
                disabled,
                hint: "开启后自动安装（如需要）并启动 gamedev-mcp-server，供 DSH 操作 Unity 场景与截图；关闭则停止服务。",
                onChange: (value) => patch({ mcpEnabled: value })
              }),
              jsx(Field, {
                label: "MCP 端口",
                numeric: true,
                value: state.mcpPort,
                disabled,
                hint: "默认 8080，需要与 DSH 的 mcp-unity 客户端端口一致。",
                onChange: (value) => patch({ mcpPort: value })
              }),
              jsx(Field, {
                label: "gamedev-mcp-server.exe 来源路径（安装用）",
                value: state.mcpServerSource,
                disabled,
                placeholder: "E:\\...\\gamedev-mcp-server.exe",
                hint: "首次启用时复制到 ~/.dsh/unity-chat/bin/；留空则需在下方指定已安装路径。",
                onChange: (value) => patch({ mcpServerSource: value })
              }),
              jsx(Field, {
                label: "已安装的 gamedev-mcp-server.exe 路径",
                value: state.mcpServerPath,
                disabled,
                hint: "留空使用插件 bin 目录。",
                onChange: (value) => patch({ mcpServerPath: value })
              })
            ]
          }),
          jsxs("div", {
            style: styles.actions,
            children: [
              jsx("button", { style: styles.button, disabled, onClick: save, children: saving ? "保存中…" : "保存" }),
              message !== undefined
                ? jsx("span", { style: message.kind === "ok" ? styles.ok : styles.err, children: message.text })
                : null
            ]
          })
        ]
      })
    }

    // ---------------- 客户端插件注册 ----------------

    const name = "unity-chat-client"
    // 与官方 dsh-set-model 客户端插件一致：必须注入 remote 及其命名空间，
    // 否则拿不到 remote.settings，设置面板不会渲染。
    const inject = ["slots", "remote", "remote.settings"]

    function apply(ctx) {
      const injectRemote = () => {
        try {
          const remote = ctx.get("remote", false)
          return remote === undefined ? {} : { remote }
        } catch {
          return {}
        }
      }
      try {
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            {
              name: "settings.section",
              id: "unity-chat",
              order: 145,
              label: () => "Unity-Chat",
              inject: injectRemote
            },
            UnityChatSettingsPanel
          )
        )
        console.info("[unity-chat] settings.section 已注册")
      } catch (error) {
        console.error("[unity-chat] settings.section 注册失败", error)
      }
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = name
    return module.exports
  }
})
