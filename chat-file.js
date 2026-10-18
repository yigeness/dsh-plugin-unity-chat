// 聊天文件读取：只负责「从 JSONL 里取出新的 user 消息」，不关心唤醒逻辑。
// 依赖可注入的 readFile，便于测试；大文件只读尾部，避免内存/CPU 被异常文件拖垮。
import { readFile, open, stat } from 'node:fs/promises'

/** 默认最多读取的字节数（4 MiB）；聊天文件正常远小于此值。 */
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024

/** 把原始文本切成非空行。 */
function splitLines(raw) {
  return String(raw ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/**
 * 读取文件内容；超过 maxBytes 时只读取尾部（聊天文件只需要最后一行）。
 * @param {string} file
 * @param {number} maxBytes
 * @param {(p:string, enc:string)=>Promise<string>} readFileImpl
 * @returns {Promise<string>}
 */
async function readTail(file, maxBytes, readFileImpl) {
  try {
    const info = await stat(file)
    if (info.size <= maxBytes) return await readFileImpl(file, 'utf8')
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      await handle.read(buffer, 0, maxBytes, info.size - maxBytes)
      return buffer.toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

/**
 * 创建一个聊天文件读取器（有状态：记住上次消费过的最后一行）。
 * @param {{file:string, readFileImpl?:(p:string,enc:string)=>Promise<string>, maxBytes?:number}} options
 */
export function createChatFileReader({ file, readFileImpl = readFile, maxBytes = DEFAULT_MAX_BYTES }) {
  let lastLine = null

  /** @returns {Promise<string[]>} 当前可见的非空行（超大文件为尾部片段） */
  async function readLines() {
    const raw = await readTail(file, maxBytes, readFileImpl)
    return splitLines(raw)
  }

  /**
   * 启动时记住最后一行，避免把历史消息当成新消息。
   * @returns {Promise<{lineCount:number}>}
   */
  async function prime() {
    const lines = await readLines()
    lastLine = lines.length > 0 ? lines[lines.length - 1] : null
    return { lineCount: lines.length }
  }

  /**
   * 取一条「新的 user 消息」；没有则返回 null。
   * 只有最后一行发生变化且 role=user 时才返回文本。
   * @returns {Promise<string|null>}
   */
  async function takeNewUserMessage() {
    const lines = await readLines()
    if (lines.length === 0) return null

    const tail = lines[lines.length - 1]
    if (tail === lastLine) return null
    lastLine = tail

    let msg
    try {
      msg = JSON.parse(tail)
    } catch {
      return null // 坏行（例如 Unity 正写到一半 / 尾部截断）直接忽略
    }

    if (!msg || msg.role !== 'user') return null
    if (typeof msg.text !== 'string' || msg.text.trim() === '') return null
    return msg.text.trim()
  }

  return { file, prime, takeNewUserMessage, readLines }
}
