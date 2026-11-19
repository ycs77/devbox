import { readdirSync, readFileSync } from 'node:fs'

const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()

export const identity = pid => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return {
      pid: Number(pid),
      boot,
      start: fields[19],
      parent: Number(fields[1]),
      status: fields[0],
    }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null
    throw error
  }
}

export const sameProcess = (owned, current = identity(owned.pid)) =>
  Boolean(current && owned.boot === current.boot && owned.start === current.start)

export const living = owned => {
  const current = identity(owned.pid)
  return sameProcess(owned, current) && !['Z', 'X'].includes(current.status)
}

// 只沿著仍符合 boot ID + start time 的自有祖先擴展，不以名稱或裸 PID 判斷。
export const descendants = owned => {
  const found = new Map(owned.map(item => [`${item.pid}:${item.start}:${item.boot}`, item]))
  const processes = readdirSync('/proc')
    .filter(name => /^\d+$/.test(name))
    .map(identity)
    .filter(Boolean)
  let changed = true
  while (changed) {
    changed = false
    for (const current of processes) {
      const key = `${current.pid}:${current.start}:${current.boot}`
      if (found.has(key)) continue
      if (
        [...found.values()].some(parent => parent.pid === current.parent && sameProcess(parent))
      ) {
        found.set(key, current)
        changed = true
      }
    }
  }
  return [...found.values()]
}
