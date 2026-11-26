import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { world, rpc, asUser, newUser, teacherCode } from './helpers'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const hashOf = async (w: any, uid: string) =>
  ((await w.db.query(`select pw_hash from auth.users where id=$1`, [uid])).rows[0] as any).pw_hash

describe('Passwort neu setzen', () => {
  it('Lehrkraft bekommt ein zufälliges Übergangspasswort; es gilt für genau diese Person', async () => {
    const w = await world(2)
    const a: string = await rpc(w.db, w.teacher, 'teacher_reset_student_password', w.students.s1)
    expect(a).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/)
    expect(await hashOf(w, w.students.s1)).toBe(sha(a))
    expect(await hashOf(w, w.students.s2)).toBe('x')            // andere unberührt
    const b: string = await rpc(w.db, w.teacher, 'teacher_reset_student_password', w.students.s1)
    expect(b).not.toBe(a)
  })

  it('niemand sonst darf: Schüler, fremde Lehrkraft; Lehrkraft-Konten sind nie Ziel', async () => {
    const w = await world(2)
    const other = await newUser(w.db, 'other')
    await rpc(w.db, other, 'register_teacher', await teacherCode(w.db))
    for (const [caller, target] of [
      [w.students.s1, w.students.s2], [w.students.s1, w.students.s1], [other, w.students.s1],
      [w.teacher, other], [w.teacher, w.teacher], [w.students.s1, w.teacher],
    ]) {
      await expect(rpc(w.db, caller, 'teacher_reset_student_password', target)).rejects.toThrow(/forbidden/)
    }
    expect(await hashOf(w, w.students.s1)).toBe('x')
    expect(await hashOf(w, w.teacher)).toBe('x')
  })

  it('die interne Schreibfunktion ist für alle Clients gesperrt', async () => {
    const w = await world(1)
    await expect(rpc(w.db, w.teacher, 'set_auth_password', w.students.s1, 'hack-12345')).rejects.toThrow(/permission denied/)
    await expect(rpc(w.db, w.students.s1, 'set_auth_password', w.teacher, 'hack-12345')).rejects.toThrow(/permission denied/)
    await expect(asUser(w.db, w.students.s1, `select * from auth.users`)).rejects.toThrow(/permission denied/)
  })

  it('Schülerliste nur für die eigene Klasse', async () => {
    const w = await world(2)
    const list: any[] = await rpc(w.db, w.teacher, 'class_students', w.classId)
    expect(list.map(x => x.pseudonym)).toEqual(['s1', 's2'])
    await expect(rpc(w.db, w.students.s1, 'class_students', w.classId)).rejects.toThrow(/forbidden/)
  })
})
