import { expect, test } from 'claude-code/testing'

import { budget } from './register'

const week = { percentUsed: 14, resetsAt: '2026-11-12T10:00:00.000Z' }
const at = (iso: string) => Date.parse(iso)

test('the first day of the window allows one seventh of the week', () => {
  const { day, ceiling, nextDayAt } = budget(week, at('2026-11-05T19:00:00.000Z'))

  expect(day).toBe(1)
  expect(ceiling).toBe(14.3)
  expect(nextDayAt).toBe(at('2026-11-06T10:00:00.000Z'))
})

test('unused days roll over: day 4 allows four sevenths', () => {
  const { day, ceiling } = budget(week, at('2026-11-08T12:00:00.000Z'))

  expect(day).toBe(4)
  expect(ceiling).toBe(57.1)
})

test('the last day allows all of it, and the day never leaves 1 to 7', () => {
  expect(budget(week, at('2026-11-12T09:59:00.000Z')).ceiling).toBe(100)
  expect(budget(week, at('2026-11-13T00:00:00.000Z')).day).toBe(7)
  expect(budget(week, at('2026-11-01T00:00:00.000Z')).day).toBe(1)
})
