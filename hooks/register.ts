import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const WEEK_KEY = 'week'
const BYPASS_KEY = 'bypassUntil'

export type Week = { percentUsed: number; resetsAt: string }

/** Which day of the 7-day window it is, and how much of the week it may have used by its end. */
export const budget = (week: Week, now: number) => {
  const startedAt = Date.parse(week.resetsAt) - WEEK_MS
  const elapsedDays = Math.floor((now - startedAt) / DAY_MS)
  const day = Math.min(7, Math.max(1, elapsedDays + 1))

  return {
    day,
    ceiling: Math.round((day * 1000) / 7) / 10,
    nextDayAt: startedAt + day * DAY_MS,
  }
}

const toWeek = (limits: readonly SessionRateLimit[]): Week | null => {
  const week = limits.find(limit => limit.kind === 'seven_day')

  return week?.resetsAt
    ? { percentUsed: week.percentUsed, resetsAt: week.resetsAt }
    : null
}

/** The live window, else the last one this PC saw while it has not reset. */
const currentWeek = async ($: EngineInterface, now: number) => {
  const { rateLimits } = await $.session.usage()
  const live = toWeek(rateLimits)

  if (live) {
    await $.store.set(WEEK_KEY, live)

    return live
  }

  const saved = (await $.store.get(WEEK_KEY)) as Week | undefined

  return saved && Date.parse(saved.resetsAt) > now ? saved : null
}

const percent = (value: number) => `${value.toLocaleString('pt-BR')}%`

const time = (at: number) =>
  new Date(at).toLocaleString('pt-BR', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const describe = (week: Week, now: number) => {
  const { day, ceiling, nextDayAt } = budget(week, now)

  return `${percent(week.percentUsed)} da semana usados, teto de ${percent(ceiling)} no dia ${day} de 7. O teto sobe em ${time(nextDayAt)}.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'limite',
      description: 'Mostra o uso da semana e o teto de hoje',
    })
    await $.command.register({
      name: 'liberar-hoje',
      description: 'Desliga o bloqueio do limite diario ate o proximo dia da semana',
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const week = toWeek(e.rateLimits)

    if (week) {
      await $.store.set(WEEK_KEY, week)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // The desktop app delivers what the person types as `sdk`. Scheduled tasks,
    // notifications and peer sessions finish their work unblocked.
    const isTyped = ['composer', 'bridge', 'sdk'].includes(e.origin.kind)

    if (e.isMeta || e.command || !isTyped) {
      return next(e)
    }

    const now = await $.clock.now()
    const week = await currentWeek($, now)

    if (!week || week.percentUsed < budget(week, now).ceiling) {
      return next(e)
    }

    const bypassUntil = Number((await $.store.get(BYPASS_KEY)) ?? 0)

    if (now < bypassUntil) {
      return next(e)
    }

    return {
      drop: `Limite de hoje atingido: ${describe(week, now)} Para usar mesmo assim, rode /liberar-hoje.`,
    }
  })

  on('command.run', { command: 'limite' }, async $ => {
    const now = await $.clock.now()
    const week = await currentWeek($, now)

    return {
      text: week
        ? describe(week, now)
        : 'Ainda sem dados de uso. Eles chegam depois da primeira resposta da sessao.',
    }
  })

  on('command.run', { command: 'liberar-hoje' }, async $ => {
    const now = await $.clock.now()
    const week = await currentWeek($, now)

    if (!week) {
      return { text: 'Ainda sem dados de uso, entao nada foi bloqueado.' }
    }

    const { nextDayAt } = budget(week, now)
    await $.store.set(BYPASS_KEY, nextDayAt)

    return { text: `Bloqueio desligado ate ${time(nextDayAt)}.` }
  })
}
