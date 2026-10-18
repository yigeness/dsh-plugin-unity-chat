// 唤醒器：把一段文本作为「用户回合」注入指定会话。
// 与官方 @deepseek-ai/dsh-schedule 相同的可靠路径：
//   sessionController.resolveAgent -> agent.followup(createUserMessage(...))
import { randomUUID } from 'node:crypto'

/**
 * 创建唤醒器。
 * @param {{ctx: any, sessionId: string}} options
 */
export function createWaker({ ctx, sessionId }) {
  /** @type {null | ((input: any) => any)} */
  let messageFactory = null

  /**
   * 取得官方消息构造器；取不到时退化为等价对象（不含冻结/校验）。
   * @returns {Promise<(input: any) => any>}
   */
  async function ensureFactory() {
    if (messageFactory) return messageFactory
    try {
      const mod = await import('@deepseek-ai/dsh-llm')
      if (typeof mod?.createUserMessage === 'function') {
        messageFactory = mod.createUserMessage
        return messageFactory
      }
    } catch (e) {
      ctx?.logger?.warn?.(`[unity-chat] 无法导入 dsh-llm，使用内置消息对象: ${e?.message ?? e}`)
    }
    messageFactory = (input) => ({ ...input, id: randomUUID(), role: 'user' })
    return messageFactory
  }

  /**
   * 唤醒会话并投递一条用户消息。
   * @param {string} text 消息正文
   * @returns {Promise<{id: string, role: string}>} 已投递的消息
   */
  async function wake(text) {
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if (resolved?.error) throw resolved.error

    const agent = resolved?.agent ?? resolved
    if (!agent || typeof agent.followup !== 'function') {
      throw new Error('resolveAgent 未返回可用 agent')
    }

    const make = await ensureFactory()
    const message = make({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    agent.followup(message)

    // 尽力落盘；失败不影响唤醒结果
    try {
      const sessions = typeof ctx.get === 'function' ? (ctx.get('sessions') ?? ctx.sessions) : ctx.sessions
      if (sessions && typeof sessions.flush === 'function') await sessions.flush(agent.session)
    } catch {}

    return message
  }

  return { wake }
}
