import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectRecentProjects, writeRecentProjects } from '../heartbeat.js'

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-hb-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function hb(projectPath, projectName, loadedAt) {
  return JSON.stringify({ projectPath, projectName, unityVersion: '6000.4.10f1', loadedAt })
}

test('按时间倒序、去重、补空位', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, 'a.json'), hb('E:/p1', 'p1', '2026-10-18T01:00:00Z'), 'utf8')
    await writeFile(join(dir, 'b.json'), hb('E:/p2', 'p2', '2026-10-18T02:00:00Z'), 'utf8')
    // 同一工程的旧心跳（大小写/分隔符不同）应被去重
    await writeFile(join(dir, 'c.json'), hb('E:\\P1', 'p1-old', '2026-10-18T00:00:00Z'), 'utf8')

    const list = await collectRecentProjects({ heartbeatDir: dir, limit: 3 })
    assert.equal(list.length, 3)
    assert.equal(list[0].projectName, 'p2')
    assert.equal(list[1].projectName, 'p1')
    assert.equal(list[2], null)
  })
})

test('没有心跳时返回空位', async () => {
  await withDir(async (dir) => {
    const list = await collectRecentProjects({ heartbeatDir: dir, limit: 3 })
    assert.deepEqual(list, [null, null, null])
  })
})

test('坏 JSON 被跳过', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, 'bad.json'), '{ not json', 'utf8')
    await writeFile(join(dir, 'ok.json'), hb('E:/p', 'p', '2026-10-18T03:00:00Z'), 'utf8')
    const list = await collectRecentProjects({ heartbeatDir: dir, limit: 3 })
    assert.equal(list[0].projectName, 'p')
    assert.equal(list[1], null)
  })
})

test('写出状态文件', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'state', 'recent.json')
    const list = [{ projectPath: 'E:/p', projectName: 'p', unityVersion: '6000', loadedAt: '2026-10-18T03:00:00Z' }, null, null]
    await writeRecentProjects(file, list)
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(parsed.projects.length, 3)
    assert.equal(parsed.projects[0].projectName, 'p')
    assert.ok(parsed.updatedAt)
  })
})
