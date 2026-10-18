// 配置规范化：多工程、轮询/休眠参数、脚本部署开关。
// 纯函数，便于单测。
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_POLL_MS = 1800
export const DEFAULT_SLEEP_POLL_MS = 30000
export const DEFAULT_IDLE_MS = 300000
export const DEFAULT_CHAT_FILE = 'Library/DSH-Chat/chat.jsonl'
export const DEFAULT_RECENT_LIMIT = 3

const MIN_POLL_MS = 300
const MIN_SLEEP_POLL_MS = 1000
const MAX_MS = 2147483647

/**
 * 校验并规范化聊天文件相对路径：只允许工程内的相对路径（禁止绝对路径与 `..`）。
 * 失败时回退默认值并返回 rejected 标记，供上层记录配置提示。
 * @param {unknown} value
 * @returns {{value:string, rejected:boolean}}
 */
export function sanitizeChatRelPath(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return { value: DEFAULT_CHAT_FILE, rejected: false }
  const normalized = raw.replace(/\\/g, '/')
  const isAbsolute = /^(?:[A-Za-z]:|\/)/.test(normalized)
  const hasParentSegment = normalized.split('/').some((segment) => segment === '..')
  if (isAbsolute || hasParentSegment) return { value: DEFAULT_CHAT_FILE, rejected: true }
  return { value: normalized.replace(/\/+$/, '') || DEFAULT_CHAT_FILE, rejected: false }
}

function positive(value, fallback, min) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(MAX_MS, Math.max(min, Math.floor(n)))
}

function nonNegative(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(MAX_MS, Math.floor(n))
}

/** volatile 配置引用的写标记（cosmokit 用 Symbol.for 跨包共享）。 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * 解包 volatile 配置引用。
 * DSH 会把 `.volatile()` 字段包装成 { get(), [VOLATILE_WRITE] } 的引用对象，
 * 直接 String()/展开会得到 [object Object] 或把包装对象写回配置。
 * @param {unknown} value
 * @returns {any}
 */
export function unwrapConfigValue(value) {
  if (value !== null && typeof value === 'object') {
    if (typeof value.get === 'function' && VOLATILE_WRITE in value) return unwrapConfigValue(value.get())
    if (Array.isArray(value)) return value.map((item) => unwrapConfigValue(item))
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = unwrapConfigValue(item)
    return out
  }
  return value
}

/**
 * 判断字符串是否像 Unity 工程路径（Windows 盘符 / UNC / POSIX）。
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikeProjectPath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\//.test(value)
}

/**
 * 规范化工程列表：解包、去空、去重、去尾部斜杠、过滤非法路径。
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeProjects(raw) {
  const unwrapped = unwrapConfigValue(raw)
  const list = Array.isArray(unwrapped) ? unwrapped : unwrapped == null ? [] : [unwrapped]
  const seen = new Set()
  const out = []
  for (const item of list) {
    const p = String(item ?? '').trim().replace(/[\\/]+$/, '')
    if (!p || p.includes('[object Object]') || !looksLikeProjectPath(p)) continue
    // 用于去重的规范化键：统一分隔符 + 小写（Windows 路径不区分大小写）
    const key = p.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

/**
 * 规范化插件配置。
 * @param {object|undefined} raw
 * @param {{home?: string}} [env]
 */
export function normalizeConfig(rawInput, env = {}) {
  const home = env.home ?? homedir()
  // 关键：volatile 字段在运行时是引用包装对象，先整体解包再取值
  const raw = unwrapConfigValue(rawInput)

  // 注意：默认配置必须能成功激活插件（DSH 会用 Config 校验入口配置）。
  // 缺少关键项时不抛错，而是记录 issues，由 index.js 打警告并降级运行。
  const issues = []
  const sessionId = String(raw?.sessionId ?? '').trim()
  if (!sessionId) issues.push('未配置 sessionId：Unity 消息不会唤醒任何会话')

  const projects = normalizeProjects(raw?.projects)
  if (projects.length === 0) issues.push('未配置 projects：不会部署/监听任何 Unity 工程')

  const chatRel = sanitizeChatRelPath(raw?.chatFile)
  const chatFile = chatRel.value
  if (chatRel.rejected) {
    issues.push(`chatFile 非法（只允许工程内相对路径，禁止绝对路径与 ..），已回退为 ${DEFAULT_CHAT_FILE}`)
  }

  return {
    issues,
    sessionId,
    projects,
    chatFile,
    pollMs: positive(raw?.pollMs, DEFAULT_POLL_MS, MIN_POLL_MS),
    sleepPollMs: positive(raw?.sleepPollMs, DEFAULT_SLEEP_POLL_MS, MIN_SLEEP_POLL_MS),
    idleMs: nonNegative(raw?.idleMs, DEFAULT_IDLE_MS),
    deployScript: raw?.deployScript !== false,
    recentLimit: positive(raw?.recentLimit, DEFAULT_RECENT_LIMIT, 1),
    heartbeatDir: String(raw?.heartbeatDir ?? join(home, '.dsh', 'unity-chat', 'heartbeats')),
    recentFile: String(raw?.recentFile ?? join(home, '.dsh', 'unity-chat', 'recent-projects.json')),
    // MCP 服务（集成安装/启停）
    mcpEnabled: raw?.mcpEnabled === true,
    mcpPort: positive(raw?.mcpPort, 8080, 1),
    mcpServerPath: String(raw?.mcpServerPath ?? '').trim(),
    mcpServerSource: String(raw?.mcpServerSource ?? '').trim(),
    // 由宿主自动维护（只读展示用）：最近加载过对话窗的工程，长度 = recentLimit，空位为 ''
    recentProjects: Array.isArray(raw?.recentProjects)
      ? raw.recentProjects.map((item) => String(item ?? '')).slice(0, 16)
      : []
  }
}

/** 某工程的聊天文件绝对路径。 */
export function chatFileForProject(projectPath, chatRelPath) {
  return join(projectPath, chatRelPath)
}

/** 休眠是否启用。 */
export function sleepEnabled(cfg) {
  return cfg.idleMs > 0
}
