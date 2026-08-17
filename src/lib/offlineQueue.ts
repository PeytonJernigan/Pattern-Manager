export interface QueuedMutation {
  id: string
  kind: 'annotation_upsert' | 'annotation_delete' | 'session_upsert' | 'counter_delta'
  payload: Record<string, unknown>
  attempts: number
  createdAt: string
}

interface StoredMutation extends QueuedMutation {
  key: string
  recordType: 'mutation'
  userId: string
}

interface QueueState {
  key: string
  recordType: 'state'
  userId: string
  paused: boolean
}

type OfflineRecord = StoredMutation | QueueState

const databaseName = 'pattern-manager-offline'
const storeName = 'outbox'
const mutationKey = (userId: string, mutationId: string) => `mutation:${userId}:${mutationId}`
const stateKey = (userId: string) => `state:${userId}`
const lockTails = new Map<string, Promise<void>>()
export const maxSyncAttempts = 8
let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase() {
  if (databasePromise) return databasePromise
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Offline storage could not be opened.'))
    request.onblocked = () => reject(new Error('Offline storage is blocked by another tab.'))
  })
  return databasePromise
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, complete: (value: T) => void, fail: (reason: unknown) => void) => void,
) {
  const database = await openDatabase()
  return await new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    let result: T
    let hasResult = false
    const complete = (value: T) => { result = value; hasResult = true }
    const fail = (reason: unknown) => { try { transaction.abort() } catch { /* transaction already ended */ }; reject(reason) }
    transaction.oncomplete = () => hasResult ? resolve(result) : reject(new Error('Offline storage operation did not complete.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline storage transaction failed.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline storage transaction was cancelled.'))
    try { operation(store, complete, fail) } catch (reason) { fail(reason) }
  })
}

function toQueuedMutation(record: StoredMutation): QueuedMutation {
  return { id: record.id, kind: record.kind, payload: record.payload, attempts: record.attempts, createdAt: record.createdAt }
}

async function withNamedLock<T>(name: string, callback: () => Promise<T>): Promise<T> {
  if ('locks' in navigator) return navigator.locks.request(name, callback)
  const previous = lockTails.get(name) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.catch(() => undefined).then(() => gate)
  lockTails.set(name, tail)
  await previous.catch(() => undefined)
  try { return await callback() }
  finally {
    release()
    if (lockTails.get(name) === tail) lockTails.delete(name)
  }
}

export async function readOutbox(userId: string): Promise<QueuedMutation[]> {
  return runTransaction<QueuedMutation[]>('readonly', (store, complete, fail) => {
    const request = store.getAll()
    request.onsuccess = () => complete((request.result as OfflineRecord[])
      .filter((record): record is StoredMutation => record.recordType === 'mutation' && record.userId === userId)
      .map(toQueuedMutation)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)))
    request.onerror = () => fail(request.error)
  })
}

export async function enqueueMutation(userId: string, mutation: Omit<QueuedMutation, 'attempts' | 'createdAt'>) {
  return runTransaction<boolean>('readwrite', (store, complete, fail) => {
    const stateRequest = store.get(stateKey(userId))
    stateRequest.onerror = () => fail(stateRequest.error)
    stateRequest.onsuccess = () => {
      if ((stateRequest.result as QueueState | undefined)?.paused) { complete(false); return }
      const key = mutationKey(userId, mutation.id)
      const existingRequest = store.get(key)
      existingRequest.onerror = () => fail(existingRequest.error)
      existingRequest.onsuccess = () => {
        if (!existingRequest.result) store.put({ ...mutation, key, recordType: 'mutation', userId, attempts: 0, createdAt: new Date().toISOString() } satisfies StoredMutation)
        complete(true)
      }
    }
  })
}

export async function removeMutation(userId: string, id: string) {
  return runTransaction<void>('readwrite', (store, complete) => {
    store.delete(mutationKey(userId, id))
    complete(undefined)
  })
}

export async function markMutationAttempt(userId: string, id: string) {
  return runTransaction<number>('readwrite', (store, complete, fail) => {
    const request = store.get(mutationKey(userId, id))
    request.onerror = () => fail(request.error)
    request.onsuccess = () => {
      const record = request.result as StoredMutation | undefined
      if (!record) { complete(0); return }
      const attempts = Math.min(maxSyncAttempts, record.attempts + 1)
      store.put({ ...record, attempts })
      complete(attempts)
    }
  })
}

export async function clearOfflineData(userId: string) {
  return runTransaction<void>('readwrite', (store, complete, fail) => {
    const request = store.getAllKeys()
    request.onerror = () => fail(request.error)
    request.onsuccess = () => {
      for (const key of request.result) if (String(key).startsWith(`mutation:${userId}:`)) store.delete(key)
      complete(undefined)
    }
  })
}

export async function pauseOfflineQueue(userId: string) {
  return runTransaction<void>('readwrite', (store, complete) => {
    store.put({ key: stateKey(userId), recordType: 'state', userId, paused: true } satisfies QueueState)
    complete(undefined)
  })
}

export async function resumeOfflineQueue(userId: string) {
  return runTransaction<void>('readwrite', (store, complete) => {
    store.put({ key: stateKey(userId), recordType: 'state', userId, paused: false } satisfies QueueState)
    complete(undefined)
  })
}

export async function retryStalledMutations(userId: string) {
  return runTransaction<void>('readwrite', (store, complete, fail) => {
    const request = store.getAll()
    request.onerror = () => fail(request.error)
    request.onsuccess = () => {
      for (const record of request.result as OfflineRecord[]) {
        if (record.recordType === 'mutation' && record.userId === userId && record.attempts > 0) store.put({ ...record, attempts: 0 })
      }
      complete(undefined)
    }
  })
}

export async function withSyncLock<T>(userId: string, callback: () => Promise<T>): Promise<T> {
  return withNamedLock(`pattern-manager-sync:${userId}`, callback)
}
