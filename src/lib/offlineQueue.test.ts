import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearOfflineData,
  enqueueMutation,
  markMutationAttempt,
  maxSyncAttempts,
  pauseOfflineQueue,
  readOutbox,
  removeMutation,
  resumeOfflineQueue,
  retryStalledMutations,
} from './offlineQueue'

const testUsers = new Set<string>()
const userId = () => {
  const id = `test-user-${crypto.randomUUID()}`
  testUsers.add(id)
  return id
}

afterEach(async () => {
  await Promise.all([...testUsers].map(async (id) => {
    await resumeOfflineQueue(id)
    await clearOfflineData(id)
  }))
  testUsers.clear()
})

describe('offline mutation queue', () => {
  it('serializes rapid enqueues without losing records', async () => {
    const owner = userId()
    await Promise.all(Array.from({ length: 40 }, (_, index) => enqueueMutation(owner, {
      id: `mutation-${index}`,
      kind: 'counter_delta',
      payload: { counterId: 'counter', delta: 1 },
    })))
    expect(await readOutbox(owner)).toHaveLength(40)
  })

  it('keeps each account isolated', async () => {
    const first = userId()
    const second = userId()
    await enqueueMutation(first, { id: 'first-only', kind: 'session_upsert', payload: { page: 2 } })
    await enqueueMutation(second, { id: 'second-only', kind: 'session_upsert', payload: { page: 8 } })
    expect((await readOutbox(first)).map((item) => item.id)).toEqual(['first-only'])
    expect((await readOutbox(second)).map((item) => item.id)).toEqual(['second-only'])
  })

  it('pauses new writes during sign-out and resumes safely', async () => {
    const owner = userId()
    await pauseOfflineQueue(owner)
    expect(await enqueueMutation(owner, { id: 'blocked', kind: 'annotation_upsert', payload: {} })).toBe(false)
    await resumeOfflineQueue(owner)
    expect(await enqueueMutation(owner, { id: 'allowed', kind: 'annotation_upsert', payload: {} })).toBe(true)
    expect((await readOutbox(owner)).map((item) => item.id)).toEqual(['allowed'])
  })

  it('persists the sign-out gate across independent app contexts', async () => {
    const owner = userId()
    await pauseOfflineQueue(owner)
    vi.resetModules()
    const secondContext = await import('./offlineQueue')
    expect(await secondContext.enqueueMutation(owner, { id: 'cross-tab', kind: 'annotation_upsert', payload: {} })).toBe(false)
    await secondContext.resumeOfflineQueue(owner)
    expect(await enqueueMutation(owner, { id: 'after-resume', kind: 'annotation_upsert', payload: {} })).toBe(true)
  })

  it('caps failed retries, supports a deliberate retry, and preserves concurrent writes', async () => {
    const owner = userId()
    await enqueueMutation(owner, { id: 'stalled', kind: 'annotation_delete', payload: { id: 'note' } })
    await Promise.all([
      ...Array.from({ length: maxSyncAttempts + 4 }, () => markMutationAttempt(owner, 'stalled')),
      enqueueMutation(owner, { id: 'newer', kind: 'counter_delta', payload: { delta: 1 } }),
    ])
    const stalled = (await readOutbox(owner)).find((item) => item.id === 'stalled')
    expect(stalled?.attempts).toBe(maxSyncAttempts)
    expect(await readOutbox(owner)).toHaveLength(2)
    await retryStalledMutations(owner)
    expect((await readOutbox(owner)).every((item) => item.attempts === 0)).toBe(true)
    await removeMutation(owner, 'stalled')
    expect((await readOutbox(owner)).map((item) => item.id)).toEqual(['newer'])
  })
})
