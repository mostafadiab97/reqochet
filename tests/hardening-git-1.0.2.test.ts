// 1.0.2 hardening Lows in the Git area, with real Git and local bare repositories as remotes:
// A-07 (a .tmp file is never committed), A-25 (only "already exists" means a baseline name is taken), SEC-WP3-04 (a remote
// name that Git would read as an option is refused), B-06 (fork setup: the branch and baselines go where Git pushes),
// A-08 (an unexpected merge analysis failure is explained, not thrown), A-10 (a refused switch with "discard" keeps the edits).
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createSystemGitAdapter } from '../src/modules/git-adapter'
import { createSqliteIndexCache } from '../src/modules/index-cache'
import { createFileRepositoryStore } from '../src/modules/repository-store'
import { generateItems } from '../src/modules/sample-data'
import { cacheFileName, createWorkspace } from '../src/modules/workspace'

const schemaFile = join(__dirname, '..', 'config', 'default-schema.yaml')
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined }
const temps: string[] = []
const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'rq-hard-git-'))
  temps.push(d)
  return d
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true })
})
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main']
const sh = (cwd: string, ...a: string[]): string => execFileSync('git', [...ID, ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const bare = (): string => {
  const d = temp()
  sh(d, 'init', '-q', '--bare', '-b', 'main')
  return d
}

/** A project with 20 items committed on main, and a workspace on it. */
async function project(setup?: (root: string) => void) {
  const base = temp()
  const root = join(base, 'repo')
  const store = createFileRepositoryStore(schemaFile)
  const repo = await store.initialize(root)
  for (const item of generateItems(repo.schema, { count: 20 })) await repo.writeItem(item)
  sh(root, 'init', '-q', '-b', 'main')
  sh(root, 'config', 'user.name', 't')
  sh(root, 'config', 'user.email', 't@example.invalid')
  sh(root, 'add', '-A')
  sh(root, 'commit', '-q', '-m', 'all')
  setup?.(root)
  const userDir = join(base, 'user')
  const ws = createWorkspace({
    store,
    git: createSystemGitAdapter(),
    openIndex: (r: string) => createSqliteIndexCache(join(userDir, 'cache', cacheFileName(r))),
    userDir,
    log: quiet,
    watchFiles: false
  } as Parameters<typeof createWorkspace>[0])
  await ws.open(root)
  return { root, ws }
}

describe('Git adapter hardening (1.0.2)', () => {
  const git = createSystemGitAdapter()

  it('A-07: a kept .tmp file is never committed with the requirements', async () => {
    const root = temp()
    sh(root, 'init', '-q', '-b', 'main')
    mkdirSync(join(root, 'requirements', 'items'), { recursive: true })
    writeFileSync(join(root, 'requirements', 'items', 'REQ-1.md'), 'one\n')
    writeFileSync(join(root, 'requirements', 'items', 'REQ-1.md.a1b2c3d4.tmp'), 'kept after a failed rename\n')
    sh(root, 'config', 'user.name', 't')
    sh(root, 'config', 'user.email', 't@example.invalid')
    await git.commit(root, 'requirements', 'save')
    expect(sh(root, 'ls-files').split('\n')).toEqual(['requirements/items/REQ-1.md'])
  })

  it('SEC-WP3-04: a remote name starting with "-" never reaches the command line', async () => {
    const root = temp()
    sh(root, 'init', '-q', '-b', 'main')
    sh(root, 'commit', '-q', '--allow-empty', '-m', 'x')
    await expect(git.push(root, { remote: '--receive-pack=evil', branch: 'main' })).rejects.toThrow(/push-bad-remote/)
    await expect(git.pushBaselines(root, '-x', ['b1'])).rejects.toThrow(/push-bad-remote/)
  })

  it('A-25: "already exists" marks the name taken; a hook refusal is an error, not "taken"', async () => {
    const remote = bare()
    const root = temp()
    sh(root, 'init', '-q', '-b', 'main')
    sh(root, 'commit', '-q', '--allow-empty', '-m', 'one')
    sh(root, 'remote', 'add', 'origin', remote)
    sh(root, 'push', '-q', 'origin', 'main')
    // a colleague's baseline of the same name on another commit
    sh(root, 'tag', '-a', '-m', 'theirs', 'baseline/taken', 'HEAD')
    sh(root, 'push', '-q', 'origin', 'refs/tags/baseline/taken')
    sh(root, 'tag', '-d', 'baseline/taken')
    sh(root, 'commit', '-q', '--allow-empty', '-m', 'two')
    sh(root, 'tag', '-a', '-m', 'mine', 'baseline/taken', 'HEAD')
    expect(await git.pushBaselines(root, 'origin', ['taken'])).toEqual(['taken'])
    // a server rule refuses every tag
    const hook = join(remote, 'hooks', 'pre-receive')
    writeFileSync(hook, '#!/bin/sh\necho "tags are protected" >&2\nexit 1\n')
    chmodSync(hook, 0o755)
    sh(root, 'tag', '-a', '-m', 'new', 'baseline/fresh', 'HEAD')
    await expect(git.pushBaselines(root, 'origin', ['fresh'])).rejects.toThrow(/declined|protected/)
  })
})

describe('workspace Git hardening (1.0.2)', () => {
  it('B-06: in a fork setup the branch and its baselines go where Git pushes, not to the upstream', async () => {
    const team = bare()
    const fork = bare()
    const { root, ws } = await project((r) => {
      sh(r, 'remote', 'add', 'origin', team)
      sh(r, 'push', '-q', '-u', 'origin', 'main')
      sh(r, 'remote', 'add', 'mine', fork)
      sh(r, 'config', 'remote.pushDefault', 'mine')
    })
    try {
      // up to date with the team: "ahead" is 0, but the fork has nothing yet
      const b = await ws.createBaseline({ name: 'review-1', note: 'first review' })
      expect(b.ok).toBe(true)
      const r = await ws.push()
      expect(r.ok).toBe(true)
      expect(sh(fork, 'for-each-ref', '--format=%(refname)').split('\n')).toEqual(expect.arrayContaining(['refs/heads/main', 'refs/tags/baseline/review-1']))
      expect(sh(team, 'for-each-ref', '--format=%(refname)', 'refs/tags')).toBe('')
      expect(sh(root, 'rev-parse', 'HEAD')).toBe(sh(fork, 'rev-parse', 'main'))
    } finally {
      await ws.close?.()
    }
  }, 60_000)

  it('A-08: a branch with unrelated history: the pull explains the problem instead of throwing', async () => {
    const { ws } = await project((r) => {
      sh(r, 'switch', '-q', '--orphan', 'alien')
      mkdirSync(join(r, 'requirements', 'items'), { recursive: true })
      writeFileSync(join(r, 'requirements', 'items', 'REQ-ALIEN01.md'), '---\nid: REQ-ALIEN01\ntitle: Alien\n---\n')
      sh(r, 'add', 'requirements/items/REQ-ALIEN01.md')
      sh(r, 'commit', '-q', '-m', 'alien')
      sh(r, 'switch', '-q', 'main')
    })
    try {
      const r = await ws.pullFrom('alien')
      expect(r.ok).toBe(false)
      expect(typeof r.message).toBe('string')
    } finally {
      await ws.close?.()
    }
  }, 60_000)

  it('A-10: switching with "discard" that Git then refuses keeps the edits', async () => {
    const { root, ws } = await project((r) => {
      // the other branch tracks a file outside requirements/ that is an untracked file here: the switch is refused
      sh(r, 'switch', '-q', '-c', 'other')
      writeFileSync(join(r, 'notes.txt'), 'on other\n')
      sh(r, 'add', 'notes.txt')
      sh(r, 'commit', '-q', '-m', 'notes')
      sh(r, 'switch', '-q', 'main')
      writeFileSync(join(r, 'notes.txt'), 'my own untracked notes\n')
    })
    try {
      const one = ws.query({ limit: 1, offset: 3 }).items[0]
      const got = one ? await ws.getItem(one.id) : null
      if (!got) throw new Error('no item')
      expect((await ws.saveItem({ ...got.item, title: 'my unsaved edit' }, got.revision)).ok).toBe(true)
      const file = join(root, 'requirements', ws.query({ text: 'my unsaved edit', limit: 1 }).items[0]!.path)
      const edited = readFileSync(file, 'utf8')
      expect(edited).toContain('my unsaved edit')
      const r = await ws.switchBranch('other', 'discard')
      expect(r.ok).toBe(false)
      expect(sh(root, 'branch', '--show-current')).toBe('main')
      // the edit is still on disk, and the untracked file that blocked the switch is untouched
      expect(readFileSync(file, 'utf8')).toBe(edited)
      expect(readFileSync(join(root, 'notes.txt'), 'utf8')).toBe('my own untracked notes\n')
    } finally {
      await ws.close?.()
    }
  }, 60_000)
})
