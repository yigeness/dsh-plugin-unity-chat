import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatFileReader } from '../chat-file.js'

const line = (role, text) => JSON.stringify({ role, text, ts: new Date().toISOString() })

async function withFile(initial, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chat-'))
  const file = join(dir, 'chat.jsonl')
  await writeFile(file, initial, 'utf8')
  try {
    await fn(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('prime 后能识别新 user 消息', async () => {
  await withFile(line('assistant', 'hi') + '\n', async (file) => {
    const reader = createChatFileReader({ file })
    const p = await reader.prime()
    assert.equal(p.lineCount, 1)
    assert.equal(await reader.takeNewUserMessage(), null)

    await appendFile(file, line('user', 'do it') + '\n', 'utf8')
    assert.equal(await reader.takeNewUserMessage(), 'do it')
  })
})

test('同一条消息不会重复触发', async () => {
  await withFile('', async (file) => {
    const reader = createChatFileReader({ file })
    await reader.prime()
    await appendFile(file, line('user', 'once') + '\n', 'utf8')
    assert.equal(await reader.takeNewUserMessage(), 'once')
    assert.equal(await reader.takeNewUserMessage(), null)
  })
})

test('assistant 结尾不触发', async () => {
  await withFile('', async (file) => {
    const reader = createChatFileReader({ file })
    await reader.prime()
    await appendFile(file, line('assistant', 'reply') + '\n', 'utf8')
    assert.equal(await reader.takeNewUserMessage(), null)
  })
})

test('坏行被忽略且不抛错', async () => {
  await withFile('', async (file) => {
    const reader = createChatFileReader({ file })
    await reader.prime()
    await appendFile(file, '{"role":"user","text":"半截\n', 'utf8')
    assert.equal(await reader.takeNewUserMessage(), null)
  })
})

test('空文本不触发', async () => {
  await withFile('', async (file) => {
    const reader = createChatFileReader({ file })
    await reader.prime()
    await appendFile(file, line('user', '   ') + '\n', 'utf8')
    assert.equal(await reader.takeNewUserMessage(), null)
  })
})

test('文件不存在时安全返回', async () => {
  const reader = createChatFileReader({ file: join(tmpdir(), 'definitely-missing-xyz.jsonl') })
  assert.deepEqual(await reader.readLines(), [])
  assert.equal(await reader.takeNewUserMessage(), null)
})
