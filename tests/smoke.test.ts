import { it, expect } from 'vitest'
import { freshDb } from './helpers'

it('migrations load', async () => {
  const db = await freshDb()
  const r = await db.query<{ n: string }>('select count(*)::text n from assets')
  expect(r.rows[0].n).toBe('9')
})
