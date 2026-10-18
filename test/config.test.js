import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  normalizeConfig,
  normalizeProjects,
  chatFileForProject,
  sleepEnabled,
  DEFAULT_POLL_MS,
  DEFAULT_SLEEP_POLL_MS,
  DEFAULT_IDLE_MS,
  DEFAULT_CHAT_FILE
} from '../config.js'

const HOME = 'C:/fake-home'

test('解包 volatile 引用（否则会得到 [object Object]）', () => {
  const write = Symbol.for('cosmokit.volatile.write')
  const ref = { get: () => 'E:/real-project', [write]: () => {} }
  const c = normalizeConfig({ sessionId: 's', projects: [ref] }, { home: HOME })
  assert.deepEqual(c.projects, ['E:/real-project'])
})

test('嵌套 volatile 引用整体解包', () => {
  const write = Symbol.for('cosmokit.volatile.write')
  const wrap = (value) => ({ get: () => value, [write]: () => {} })
  const c = normalizeConfig(wrap({ sessionId: wrap('s'), projects: wrap([wrap('E:/p1')]) }), { home: HOME })
  assert.equal(c.sessionId, 's')
  assert.deepEqual(c.projects, ['E:/p1'])
})

test('非法工程路径被过滤（[object Object] / 相对路径）', () => {
  const list = normalizeProjects(['[object Object]', 'relative/path', 'E:/ok'])
  assert.deepEqual(list, ['E:/ok'])
})

test('缺少 sessionId 时降级并给出 issues（不抛错，保证插件可激活）', () => {
  const c = normalizeConfig({ projects: ['E:/p1'] }, { home: HOME })
  assert.equal(c.sessionId, '')
  assert.ok(c.issues.some((item) => item.includes('sessionId')))
})

test('缺少 projects 时降级并给出 issues（不抛错）', () => {
  const c = normalizeConfig({ sessionId: 's' }, { home: HOME })
  assert.deepEqual(c.projects, [])
  assert.ok(c.issues.some((item) => item.includes('projects')))
})

test('完全空配置也能激活（安装后默认状态）', () => {
  const c = normalizeConfig({}, { home: HOME })
  assert.equal(c.sessionId, '')
  assert.deepEqual(c.projects, [])
  assert.ok(c.issues.length >= 2)
  assert.equal(c.pollMs, DEFAULT_POLL_MS)
})

test('工程列表去空、去重、去尾斜杠', () => {
  const list = normalizeProjects(['E:\\p1\\', '', 'e:/P1', 'E:/p2'])
  assert.deepEqual(list, ['E:\\p1', 'E:/p2'])
})

test('默认值', () => {
  const c = normalizeConfig({ sessionId: 's', projects: ['E:/p1'] }, { home: HOME })
  assert.equal(c.pollMs, DEFAULT_POLL_MS)
  assert.equal(c.sleepPollMs, DEFAULT_SLEEP_POLL_MS)
  assert.equal(c.idleMs, DEFAULT_IDLE_MS)
  assert.equal(c.chatFile, DEFAULT_CHAT_FILE)
  assert.equal(c.deployScript, true)
  assert.equal(c.recentLimit, 3)
  assert.equal(c.heartbeatDir, join(HOME, '.dsh', 'unity-chat', 'heartbeats'))
  assert.equal(c.recentFile, join(HOME, '.dsh', 'unity-chat', 'recent-projects.json'))
})

test('deployScript=false 可关闭部署', () => {
  const c = normalizeConfig({ sessionId: 's', projects: ['E:/p1'], deployScript: false }, { home: HOME })
  assert.equal(c.deployScript, false)
})

test('越界/非法参数被修正', () => {
  const c = normalizeConfig(
    { sessionId: 's', projects: ['E:/p1'], pollMs: 10, sleepPollMs: 1, idleMs: -3 },
    { home: HOME }
  )
  assert.equal(c.pollMs, 300)
  assert.equal(c.sleepPollMs, 1000)
  assert.equal(c.idleMs, DEFAULT_IDLE_MS)
})

test('idleMs=0 关闭休眠', () => {
  const c = normalizeConfig({ sessionId: 's', projects: ['E:/p1'], idleMs: 0 }, { home: HOME })
  assert.equal(sleepEnabled(c), false)
})

test('聊天文件按工程拼接', () => {
  const joined = chatFileForProject('E:/proj', 'Library/DSH-Chat/chat.jsonl')
  assert.ok(joined.startsWith('E:/proj') || joined.startsWith('E:\\proj'))
  assert.ok(joined.endsWith('chat.jsonl'))
})
