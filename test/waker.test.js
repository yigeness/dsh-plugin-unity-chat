import test from 'node:test'
import assert from 'node:assert/strict'
import { createWaker } from '../waker.js'

function fakeCtx({ error = null } = {}) {
  const captured = []
  const ctx = {
    logger: { info() {}, warn() {} },
    sessionController: {
      resolveAgent: async () => {
        if (error) return { error }
        return {
          agent: {
            session: { id: 's-1' },
            followup: (m) => captured.push(m)
          }
        }
      }
    },
    sessions: { flush: async () => true },
    get: () => undefined
  }
  return { ctx, captured }
}

test('wake 会投递一条 user 消息', async () => {
  const { ctx, captured } = fakeCtx()
  const waker = createWaker({ ctx, sessionId: 's-1' })
  const msg = await waker.wake('hello unity')

  assert.equal(captured.length, 1)
  assert.equal(captured[0].role, 'user')
  assert.equal(captured[0].content[0].type, 'text')
  assert.equal(captured[0].content[0].text, 'hello unity')
  assert.ok(msg.id, '消息应带唯一 id')
})

test('resolveAgent 返回 error 时抛出', async () => {
  const { ctx } = fakeCtx({ error: new Error('boom') })
  const waker = createWaker({ ctx, sessionId: 's-1' })
  await assert.rejects(() => waker.wake('x'), /boom/)
})

test('没有可用 agent 时抛出可读错误', async () => {
  const ctx = {
    logger: { info() {}, warn() {} },
    sessionController: { resolveAgent: async () => ({}) },
    get: () => undefined
  }
  const waker = createWaker({ ctx, sessionId: 's-1' })
  await assert.rejects(() => waker.wake('x'), /未返回可用 agent/)
})
