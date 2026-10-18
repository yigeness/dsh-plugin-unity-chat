// MCP 服务管理（集成"下载/安装 → 启动/停止"脚本能力）
// - 安装：从 mcpServerSource（本地已有的 gamedev-mcp-server.exe）复制到 ~/.dsh/unity-chat/bin/
// - 启动：以 MCP 环境变量拉起 gamedev-mcp-server（detached，退出插件后仍运行）
// - 卸载：停止进程
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** 只允许启动/安装这个可执行文件名，避免配置被篡改后执行任意程序。 */
const ALLOWED_EXE_NAME = /^gamedev-mcp-server(?:\.exe)?$/i

/**
 * 校验 MCP 可执行文件路径：必须是名为 gamedev-mcp-server.exe 的普通文件。
 * @param {string} filePath
 * @returns {boolean}
 */
export function isAllowedServerExecutable(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return false
  if (!ALLOWED_EXE_NAME.test(basename(filePath))) return false
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * @param {{ctx: any, cfg: any}} options
 */
export function createMcpManager({ ctx, cfg }) {
  const root = join(homedir(), '.dsh', 'unity-chat')
  const stateFile = join(root, 'mcp-server.json')
  const binDir = join(root, 'bin')
  const binExe = join(binDir, 'gamedev-mcp-server.exe')

  function readState() {
    try {
      return JSON.parse(readFileSync(stateFile, 'utf8'))
    } catch {
      return null
    }
  }

  function writeState(value) {
    try {
      mkdirSync(dirname(stateFile), { recursive: true })
      writeFileSync(stateFile, JSON.stringify(value, null, 2), 'utf8')
    } catch {}
  }

  function isAlive(pid) {
    if (typeof pid !== 'number' || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /**
   * 解析可执行文件路径。install=true 时才把来源复制到插件 bin 目录（"安装"步骤）；
   * 状态查询不得有副作用，否则一启动就会复制 100MB 文件。
   */
  function resolveExe(install = false) {
    if (cfg.mcpServerPath) {
      if (isAllowedServerExecutable(cfg.mcpServerPath)) return cfg.mcpServerPath
      ctx.logger.warn(
        `[unity-chat] 拒绝使用非法的 MCP 可执行文件（必须是名为 gamedev-mcp-server.exe 的普通文件）：${cfg.mcpServerPath}`
      )
    }
    if (existsSync(binExe) && isAllowedServerExecutable(binExe)) return binExe
    if (install && cfg.mcpServerSource) {
      if (!isAllowedServerExecutable(cfg.mcpServerSource)) {
        ctx.logger.warn(
          `[unity-chat] 拒绝安装：mcpServerSource 必须是名为 gamedev-mcp-server.exe 的普通文件：${cfg.mcpServerSource}`
        )
        return ''
      }
      try {
        mkdirSync(binDir, { recursive: true })
        copyFileSync(cfg.mcpServerSource, binExe)
        ctx.logger.info(`[unity-chat] MCP 服务已安装: ${binExe}`)
        return binExe
      } catch (e) {
        ctx.logger.warn(`[unity-chat] 安装 MCP 服务失败: ${e?.message ?? e}`)
      }
    }
    return ''
  }

  function status() {
    const state = readState()
    const exePath = resolveExe()
    return {
      enabled: cfg.mcpEnabled === true,
      exePath,
      installed: exePath !== '',
      running: isAlive(state?.pid),
      pid: isAlive(state?.pid) ? state.pid : null,
      port: cfg.mcpPort
    }
  }

  function start() {
    if (cfg.mcpEnabled !== true) return status()
    const exePath = resolveExe(true)
    if (!exePath) {
      ctx.logger.warn(
        '[unity-chat] MCP 服务未安装：请配置 mcpServerSource（本地 gamedev-mcp-server.exe 路径）或 mcpServerPath'
      )
      return status()
    }
    const current = readState()
    if (isAlive(current?.pid)) return status()

    const env = {
      ...process.env,
      UNITY_MCP_CONNECTION_MODE: 'Custom',
      UNITY_MCP_HOST: `http://127.0.0.1:${cfg.mcpPort}`,
      UNITY_MCP_START_SERVER: 'true',
      UNITY_MCP_TRANSPORT: 'streamableHttp'
    }
    let child
    try {
      child = spawn(exePath, [], { env, detached: true, stdio: 'ignore' })
      child.unref()
    } catch (e) {
      ctx.logger.warn(`[unity-chat] MCP 服务启动失败: ${e?.message ?? e}`)
      return status()
    }
    writeState({ pid: child.pid, exePath, port: cfg.mcpPort, startedAt: new Date().toISOString() })
    ctx.logger.info(`[unity-chat] MCP 服务已启动 pid=${child.pid} port=${cfg.mcpPort}`)
    return status()
  }

  function stop() {
    const current = readState()
    if (!isAlive(current?.pid)) {
      writeState({ pid: null, stoppedAt: new Date().toISOString() })
      return status()
    }
    try {
      process.kill(current.pid)
      ctx.logger.info(`[unity-chat] MCP 服务已停止 pid=${current.pid}`)
    } catch (e) {
      ctx.logger.warn(`[unity-chat] 停止 MCP 服务失败: ${e?.message ?? e}`)
    }
    writeState({ pid: null, stoppedAt: new Date().toISOString() })
    return status()
  }

  return { status, start, stop }
}
