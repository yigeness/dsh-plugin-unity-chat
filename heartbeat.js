// 工程心跳：读取各 Unity 工程写下的心跳文件，汇总"最近加载过对话窗的工程"。
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * 收集最近加载过对话窗的工程，按 loadedAt 倒序，去重，补空位到 limit。
 * @param {{heartbeatDir:string, limit?:number}} options
 * @returns {Promise<Array<null | {projectPath:string, projectName:string, unityVersion:string, loadedAt:string}>>}
 */
export async function collectRecentProjects({ heartbeatDir, limit = 3 }) {
  let names = []
  try {
    names = await readdir(heartbeatDir)
  } catch {
    names = []
  }

  /** @type {Array<{projectPath:string, projectName:string, unityVersion:string, loadedAt:string}>} */
  const items = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue
    try {
      const raw = await readFile(join(heartbeatDir, name), 'utf8')
      const hb = JSON.parse(raw)
      if (!hb || typeof hb.projectPath !== 'string' || !hb.projectPath) continue
      items.push({
        projectPath: hb.projectPath,
        projectName: String(hb.projectName ?? ''),
        unityVersion: String(hb.unityVersion ?? ''),
        loadedAt: String(hb.loadedAt ?? '')
      })
    } catch {
      // 坏文件跳过
    }
  }

  items.sort((a, b) => (Date.parse(b.loadedAt) || 0) - (Date.parse(a.loadedAt) || 0))

  const seen = new Set()
  const unique = []
  for (const item of items) {
    // 去重键：统一分隔符 + 小写（Windows 路径不区分大小写）
    const key = item.projectPath.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }

  const top = unique.slice(0, limit)
  while (top.length < limit) top.push(null)
  return top
}

/**
 * 把最近工程列表写入状态文件（供 DSH 侧查看）。
 * @param {string} file
 * @param {Array<null | object>} list
 */
export async function writeRecentProjects(file, list) {
  await mkdir(dirname(file), { recursive: true })
  const payload = { updatedAt: new Date().toISOString(), projects: list }
  await writeFile(file, JSON.stringify(payload, null, 2), 'utf8')
}
