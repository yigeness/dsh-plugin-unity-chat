import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeConfig, sanitizeChatRelPath, DEFAULT_CHAT_FILE } from '../config.js'
import { deployScript, isPathInside } from '../deploy.js'
import { isAllowedServerExecutable } from '../mcp.js'
import { createChatFileReader } from '../chat-file.js'

const HOME = 'C:/fake-home'

test('chatFile：允许工程内相对路径', () => {
  assert.deepEqual(sanitizeChatRelPath('Library/DSH-Chat/chat.jsonl'), {
    value: 'Library/DSH-Chat/chat.jsonl',
    rejected: false
  })
  assert.equal(sanitizeChatRelPath('').value, DEFAULT_CHAT_FILE)
})

test('chatFile：拒绝绝对路径与 ..（防目录穿越）', () => {
  assert.deepEqual(sanitizeChatRelPath('C:/Windows/evil.jsonl'), {
    value: DEFAULT_CHAT_FILE,
    rejected: true
  })
  assert.deepEqual(sanitizeChatRelPath('../outside.jsonl'), { value: DEFAULT_CHAT_FILE, rejected: true })
  assert.deepEqual(sanitizeChatRelPath('a/../../b.jsonl'), { value: DEFAULT_CHAT_FILE, rejected: true })
})

test('normalizeConfig 对非法 chatFile 给出提示并回退默认值', () => {
  const c = normalizeConfig({ sessionId: 's', projects: ['E:/p'], chatFile: 'C:/x/y.jsonl' }, { home: HOME })
  assert.equal(c.chatFile, DEFAULT_CHAT_FILE)
  assert.ok(c.issues.some((item) => item.includes('chatFile')))
})

test('isPathInside 判断目录包含关系', () => {
  assert.equal(isPathInside('E:/proj', 'E:/proj/Assets/Editor/a.cs'), true)
  assert.equal(isPathInside('E:/proj', 'E:/proj-evil/a.cs'), false)
})

test('deployScript：正常目标写入工程内', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-deploy-'))
  try {
    const r = await deployScript({ projectPath: dir, source: '// script' })
    assert.equal(r.action, 'created')
    assert.equal(await readFile(r.target, 'utf8'), '// script')
    // 再次部署内容不变 → unchanged
    const again = await deployScript({ projectPath: dir, source: '// script' })
    assert.equal(again.action, 'unchanged')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('deployScript：拒绝路径穿越与非法扩展名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-deploy-'))
  try {
    const escaped = await deployScript({ projectPath: dir, source: 'x', targetRel: '../evil.cs' })
    assert.equal(escaped.action, 'skipped')
    const notCs = await deployScript({ projectPath: dir, source: 'x', targetRel: 'Assets/Editor/evil.txt' })
    assert.equal(notCs.action, 'skipped')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('MCP 可执行文件白名单：只接受 gamedev-mcp-server.exe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-'))
  try {
    const good = join(dir, 'gamedev-mcp-server.exe')
    await writeFile(good, 'binary', 'utf8')
    const other = join(dir, 'evil.exe')
    await writeFile(other, 'binary', 'utf8')

    assert.equal(isAllowedServerExecutable(good), true)
    assert.equal(isAllowedServerExecutable(other), false)
    assert.equal(isAllowedServerExecutable(join(dir, 'not-exists.exe')), false)
    assert.equal(isAllowedServerExecutable(''), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('聊天文件超大时只读尾部（仍能取到最后一条 user 消息）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chat-'))
  try {
    const file = join(dir, 'chat.jsonl')
    const filler = Array.from({ length: 200 }, (_, i) =>
      JSON.stringify({ role: 'assistant', text: `filler-${i}-${'x'.repeat(50)}` })
    ).join('\n')
    // 先有历史，prime 记住历史最后一行
    const history = `${filler}\n${JSON.stringify({ role: 'assistant', text: 'history-tail' })}\n`
    await writeFile(file, history, 'utf8')

    const reader = createChatFileReader({ file, maxBytes: 512 })
    await reader.prime()
    assert.equal(await reader.takeNewUserMessage(), null)

    // 再追加一条 user 消息（文件远超 maxBytes，仍然只能看到尾部）
    const last = JSON.stringify({ role: 'user', text: 'tail-message' })
    const { appendFile } = await import('node:fs/promises')
    await appendFile(file, `${last}\n`, 'utf8')

    assert.equal(await reader.takeNewUserMessage(), 'tail-message')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
