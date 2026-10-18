// 把插件内置的唯一一份 DSHChatWindow.cs 部署到指定 Unity 工程。
// 只在目标不存在或内容不同时才写，避免污染工程 / 触发无意义的重编译。
// 安全：写入目标必须位于配置的工程目录内，防止路径穿越把文件写到工程外。
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

/** 允许部署的相对路径（固定脚本位置）。 */
export const DEFAULT_TARGET_REL = 'Assets/Editor/DSHChatWindow.cs'

/** 插件自带的脚本源（唯一一份）。 */
export function canonicalScriptUrl() {
  return new URL('./assets/DSHChatWindow.cs', import.meta.url)
}

/**
 * 读取插件内置脚本内容。
 * @returns {Promise<string>}
 */
export async function readCanonicalScript() {
  return readFile(canonicalScriptUrl(), 'utf8')
}

/**
 * 判断 child 是否位于 parent 目录内（Windows 大小写不敏感）。
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
export function isPathInside(parent, child) {
  const base = resolve(parent) + sep
  const target = resolve(child)
  return process.platform === 'win32'
    ? target.toLowerCase().startsWith(base.toLowerCase())
    : target.startsWith(base)
}

/**
 * 确保某个工程里装有最新版对话窗脚本。
 * @param {{projectPath:string, source:string, targetRel?:string}} options
 * @returns {Promise<{projectPath:string, target:string, action:'created'|'updated'|'unchanged'|'skipped'|'error', error?:string}>}
 */
export async function deployScript({ projectPath, source, targetRel = DEFAULT_TARGET_REL }) {
  const target = resolve(projectPath, targetRel)
  // 防路径穿越：目标必须在工程目录内
  if (!isPathInside(projectPath, target)) {
    return { projectPath, target, action: 'skipped', error: '目标路径超出工程目录，已拒绝写入' }
  }
  // 只允许部署 .cs 文件（避免被利用写任意类型文件）
  if (!target.toLowerCase().endsWith('.cs')) {
    return { projectPath, target, action: 'skipped', error: '目标不是 .cs 脚本，已拒绝写入' }
  }
  try {
    const existing = await readFile(target, 'utf8').catch(() => null)
    if (existing === source) return { projectPath, target, action: 'unchanged' }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, source, 'utf8')
    return { projectPath, target, action: existing === null ? 'created' : 'updated' }
  } catch (e) {
    return { projectPath, target, action: 'error', error: e?.message ?? String(e) }
  }
}
