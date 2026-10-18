// DSH Unity 对话桥插件（bundle 版）
// - 内置唯一一份 DSHChatWindow.cs，启动时幂等部署到配置的每个 Unity 工程
// - 每个工程独立聊天文件；出现新的 role=user 消息 → 作为用户回合注入会话
// - Unity 启动写心跳 → 汇总"最近加载过聊天框的工程"
// - 暴露 unity_chat_status 工具，便于在 DSH 内查看状态
import Schema from '@deepseek-ai/schemastery'
import { normalizeConfig, chatFileForProject, sleepEnabled, unwrapConfigValue } from './config.js'
import { createChatFileReader } from './chat-file.js'
import { createWaker } from './waker.js'
import { readCanonicalScript, deployScript } from './deploy.js'
import { collectRecentProjects, writeRecentProjects } from './heartbeat.js'
import { createMcpManager } from './mcp.js'

export const name = 'unity-chat'
export const inject = ['sessionController']

const TAG = '[unity-chat]'

/**
 * 插件配置 schema：DSH 设置页据此自动生成表单。
 * 注意：每个字段都必须 .volatile()——否则该设置命名空间不会出现在 describe() 里，
 * 设置页会报"未找到设置命名空间"。volatile 写入由 Loader 就地更新配置（不重跑 apply），
 * 我们通过监听 loader/volatile-update 事件刷新 cfg。
 */
export const Config = Schema.object({
  sessionId: Schema.string().default('').volatile().description('要唤醒的 DSH 会话 ID'),
  projects: Schema.array(Schema.string())
    .default([])
    .volatile()
    .description('Unity 工程根路径列表；打开这些工程时会自动弹出 DSH 对话窗'),
  chatFile: Schema.string()
    .default('Library/DSH-Chat/chat.jsonl')
    .volatile()
    .description('聊天文件相对工程根的路径（每个工程各自独立）'),
  pollMs: Schema.number().default(1800).volatile().description('活跃期检查间隔（毫秒），默认 1800'),
  sleepPollMs: Schema.number().default(30000).volatile().description('休眠期低频检查间隔（毫秒），默认 30000'),
  idleMs: Schema.number().default(300000).volatile().description('空闲多久进入休眠（毫秒），0 = 永不休眠'),
  deployScript: Schema.boolean().default(true).volatile().description('是否自动把对话窗脚本部署到各工程'),
  recentLimit: Schema.number().default(3).volatile().description('"最近工程"保留数量'),
  mcpEnabled: Schema.boolean().default(false).volatile().description('是否启用 MCP 服务（启用后自动安装并启动 gamedev-mcp-server）'),
  mcpPort: Schema.number().default(8080).volatile().description('MCP 服务端口（默认 8080）'),
  mcpServerPath: Schema.string().default('').volatile().description('已安装的 gamedev-mcp-server.exe 路径（留空则用插件 bin 目录）'),
  mcpServerSource: Schema.string().default('').volatile().description('用于安装的 gamedev-mcp-server.exe 来源路径（首次启用时复制到插件 bin）'),
  recentProjects: Schema.array(Schema.string())
    .default([])
    .volatile()
    .description('最近加载过对话窗的工程（插件自动维护，只读；不足补空位）')
})

/**
 * @param {any} ctx
 * @param {any} rawConfig
 */
export function apply(ctx, rawConfig) {
  let cfg
  try {
    cfg = normalizeConfig(rawConfig)
  } catch (e) {
    // 理论上不会发生：normalizeConfig 已改为"记录 issues 而非抛错"。
    ctx.logger.warn(`${TAG} 配置解析失败，已按默认值降级: ${e?.message ?? e}`)
    cfg = normalizeConfig({})
  }
  for (const issue of cfg.issues ?? []) ctx.logger.warn(`${TAG} 配置提示：${issue}`)

  function buildReaders() {
    return cfg.projects.map((projectPath) => ({
      projectPath,
      projectName: projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath,
      reader: createChatFileReader({ file: chatFileForProject(projectPath, cfg.chatFile) })
    }))
  }

  let waker = createWaker({ ctx, sessionId: cfg.sessionId })
  const mcp = createMcpManager({ ctx, cfg })
  /** @type {Array<{projectPath:string, projectName:string, reader:any}>} */
  let readers = buildReaders()

  /** 供 unity_chat_status 工具读取的运行时状态。 */
  const status = {
    projects: readers.map((r) => ({
      projectName: r.projectName,
      projectPath: r.projectPath,
      chatFile: chatFileForProject(r.projectPath, cfg.chatFile)
    })),
    recentProjects: /** @type {Array<null | object>} */ ([]),
    sleeping: false,
    startedAt: new Date().toISOString(),
    lastWakeAt: null
  }

  let timer = null
  let warnedNoSession = false
  let heartbeatTimer = null
  let busy = false
  let sleeping = false
  let lastMessageAt = Date.now()
  let lastRecentJson = ''

  function nextDelay() {
    return sleeping ? cfg.sleepPollMs : cfg.pollMs
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule() {
    clearTimer()
    timer = setTimeout(() => { void tick() }, nextDelay())
    if (typeof timer.unref === 'function') timer.unref()
  }

  /**
   * 设置页的 volatile 写入：Loader 就地更新 rawConfig，不重跑 apply。
   * 这里刷新配置快照，并在关键项（工程/聊天路径/会话/节奏/MCP）变化时重建依赖。
   */
  async function onVolatileUpdate() {
    const keys = (c) => JSON.stringify([c.projects, c.chatFile, c.sessionId, c.pollMs, c.sleepPollMs, c.mcpEnabled, c.mcpPort])
    const before = keys(cfg)
    try {
      Object.assign(cfg, normalizeConfig(rawConfig))
    } catch (e) {
      ctx.logger.warn(`${TAG} 应用新配置失败: ${e?.message ?? e}`)
      return
    }
    if (keys(cfg) === before) {
      schedule()
      return
    }
    readers = buildReaders()
    status.projects = readers.map((r) => ({
      projectName: r.projectName,
      projectPath: r.projectPath,
      chatFile: chatFileForProject(r.projectPath, cfg.chatFile)
    }))
    waker = createWaker({ ctx, sessionId: cfg.sessionId })
    for (const item of readers) await item.reader.prime()
    await deployAll()
    try {
      if (cfg.mcpEnabled) mcp.start()
      else mcp.stop()
    } catch {}
    schedule()
    ctx.logger.info(`${TAG} 配置已热更新（volatile）`)
  }

  async function deployAll() {
    if (!cfg.deployScript) return
    let source
    try {
      source = await readCanonicalScript()
    } catch (e) {
      ctx.logger.warn(`${TAG} 读取内置脚本失败: ${e?.message ?? e}`)
      return
    }
    for (const projectPath of cfg.projects) {
      const r = await deployScript({ projectPath, source })
      if (r.action === 'created' || r.action === 'updated') {
        ctx.logger.info(`${TAG} 已部署脚本(${r.action}): ${r.target}`)
      } else if (r.action === 'error') {
        ctx.logger.warn(`${TAG} 脚本部署失败: ${r.target} | ${r.error}`)
      }
    }
  }

  /**
   * 把「最近工程」写回本插件自己的配置字段（只读展示用）。
   * 用官方 configEditor.edit；写入会触发本插件热重载，但值一致时会跳过，不会循环。
   */
  async function persistRecent(list) {
    const display = []
    for (let i = 0; i < cfg.recentLimit; i += 1) {
      const item = list[i]
      display.push(item ? `${item.projectName} (${item.unityVersion})` : '')
    }
    const current = Array.isArray(cfg.recentProjects) ? cfg.recentProjects : []
    if (JSON.stringify(display) === JSON.stringify(current)) return
    try {
      const editor = typeof ctx.get === 'function' ? ctx.get('configEditor', false) : undefined
      if (!editor || typeof editor.configuration !== 'function' || typeof editor.edit !== 'function') return
      const row = editor.configuration().find((candidate) => candidate?.entry?.options?.id === 'unity-chat')
      if (!row) return
      // raw 是运行时配置：volatile 字段是引用包装对象，必须先解包再写回，否则会把 [object Object] 写进配置
      await editor.edit(row.entry, (raw) => ({ ...(unwrapConfigValue(raw) ?? {}), recentProjects: display }))
      ctx.logger.info(`${TAG} 最近工程已写入配置: ${display.filter(Boolean).join(', ') || '(空)'}`)
    } catch (e) {
      ctx.logger.warn(`${TAG} 写入最近工程配置失败: ${e?.message ?? e}`)
    }
  }

  async function refreshRecent(force = false) {
    try {
      const list = await collectRecentProjects({ heartbeatDir: cfg.heartbeatDir, limit: cfg.recentLimit })
      status.recentProjects = list
      const json = JSON.stringify(list)
      if (!force && json === lastRecentJson) return
      lastRecentJson = json
      await writeRecentProjects(cfg.recentFile, list)
      await persistRecent(list)
      const names = list.filter(Boolean).map((x) => `${x.projectName}(${x.unityVersion})`).join(', ')
      ctx.logger.info(`${TAG} 最近加载的工程: ${names || '(空)'}`)
    } catch (e) {
      ctx.logger.warn(`${TAG} 刷新最近工程失败: ${e?.message ?? e}`)
    }
  }

  async function tick() {
    if (busy) {
      schedule()
      return
    }
    busy = true
    try {
      for (const item of readers) {
        const text = await item.reader.takeNewUserMessage()
        if (!text) continue

        lastMessageAt = Date.now()
        status.lastWakeAt = new Date().toISOString()
        if (sleeping) {
          sleeping = false
          status.sleeping = false
          ctx.logger.info(`${TAG} 检测到新消息，退出休眠`)
        }

        const file = chatFileForProject(item.projectPath, cfg.chatFile)
        if (!cfg.sessionId) {
          if (!warnedNoSession) {
            warnedNoSession = true
            ctx.logger.warn(`${TAG} 收到消息但未配置 sessionId，已忽略唤醒：${file}`)
          }
          continue
        }
        const prompt =
          `【来自 Unity 对话框 · ${item.projectName}】用户说：\n${text}\n\n` +
          `（处理完后，把回复以一行 {"role":"assistant","text":"...","ts":"..."} 追加到文件：${file}）`
        await waker.wake(prompt)
        ctx.logger.info(`${TAG} 已唤醒会话（工程: ${item.projectName}）`)
      }

      if (!sleeping && sleepEnabled(cfg) && Date.now() - lastMessageAt >= cfg.idleMs) {
        sleeping = true
        status.sleeping = true
        ctx.logger.info(`${TAG} 进入休眠（每 ${cfg.sleepPollMs}ms 低频检查）`)
      }
    } catch (e) {
      ctx.logger.warn(`${TAG} 唤醒失败: ${e?.message ?? String(e)}`)
    } finally {
      busy = false
      schedule()
    }
  }

  /** 注册状态工具（tools 服务不可用时静默跳过）。 */
  async function registerStatusTool() {
    const tools = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools
    if (!tools || typeof tools.register !== 'function') {
      ctx.logger.info(`${TAG} tools 服务不可用，跳过 unity_chat_status 工具`)
      return null
    }
    try {
      const { defineTool } = await import('@deepseek-ai/dsh-tools')
      return tools.register(
        defineTool({
          name: 'unity_chat_status',
          description:
            '查看 Unity 对话桥状态：DSH 配置的 Unity 工程、最近加载过聊天框的工程（最多 3 个）、当前是否休眠。',
          parameters: {},
          output: {
            // 注意：这里必须是「纯 JSON Schema 对象」，不能用 schemastery 实例
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: { type: 'string', required: true, description: '当前状态 JSON 文本' }
              }
            },
            render: (_args, value) => [{ type: 'text', text: value.text }]
          },
          async execute() {
            return { text: JSON.stringify(status, null, 2) }
          }
        })
      )
    } catch (e) {
      ctx.logger.warn(`${TAG} 注册状态工具失败: ${e?.message ?? e}`)
      return null
    }
  }

  ctx.effect(() => {
    let disposed = false
    let toolDisposer = null
    let volatileDisposer = null
    ctx.logger.info(
      `${TAG} 已加载：${cfg.projects.length} 个工程, poll=${cfg.pollMs}, sleep=${cfg.sleepPollMs}, idle=${cfg.idleMs}`
    )

    // 设置页写入走 volatile 通道：配置就地更新，不重跑 apply，需要主动刷新
    try {
      if (typeof ctx.on === 'function') {
        volatileDisposer = ctx.on('loader/volatile-update', () => { void onVolatileUpdate() })
      }
    } catch (e) {
      ctx.logger.warn(`${TAG} 订阅 volatile 更新失败: ${e?.message ?? e}`)
    }

    void (async () => {
      toolDisposer = await registerStatusTool()

      // MCP 服务：启用则安装+启动，禁用则停止
      try {
        status.mcp = cfg.mcpEnabled ? mcp.start() : mcp.stop()
      } catch (e) {
        ctx.logger.warn(`${TAG} MCP 服务处理失败: ${e?.message ?? e}`)
      }

      await deployAll()
      if (disposed) return
      for (const item of readers) await item.reader.prime()
      await refreshRecent(true)
      if (disposed) return
      schedule()
      heartbeatTimer = setInterval(() => {
        void refreshRecent()
        status.mcp = mcp.status()
      }, 15000)
      if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref()
    })()

    return () => {
      disposed = true
      clearTimer()
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      if (typeof toolDisposer === 'function') toolDisposer()
      if (typeof volatileDisposer === 'function') volatileDisposer()
    }
  })
}
