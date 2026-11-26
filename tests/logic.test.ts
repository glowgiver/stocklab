import { describe, it, expect } from 'vitest'
import { studentEmail, isValidPseudonym, weightedPercent, toCsv, parsePriceLines } from '../src/lib/logic'

describe('logic', () => {
  it('Schüler-Adresse aus Klassencode und Pseudonym, ohne Umlaute/Sonderzeichen', () => {
    expect(studentEmail('ab3d-9x', 'Müller Fuchs')).toBe('mueller-fuchs.ab3d-9x@students.stocklab.invalid')
    expect(studentEmail(' ABCD1234 ', ' Fox ')).toBe('fox.abcd1234@students.stocklab.invalid')
  })
  it('Pseudonym-Regeln', () => {
    expect(isValidPseudonym('Fox')).toBe(true)
    expect(isValidPseudonym('x')).toBe(false)
    expect(isValidPseudonym('a@b.de')).toBe(false)
  })
  it('Bewertungsraster 40/20/20/20 (0–4)', () => {
    expect(weightedPercent({ reasoning: 4, evidence: 4, risk: 4, reflection: 4 })).toBe(100)
    expect(weightedPercent({ reasoning: 2, evidence: 2, risk: 2, reflection: 2 })).toBe(50)
    expect(weightedPercent({ reasoning: 4, evidence: 0, risk: 0, reflection: 0 })).toBe(40)
    expect(weightedPercent({ reasoning: 4, evidence: null, risk: 1, reflection: 1 })).toBeNull()
  })
  it('CSV schützt vor Formel-Injection und quotet korrekt', () => {
    const csv = toCsv([{ a: '=1+1', b: 'say "hi", ok' }])
    expect(csv).toBe(`a,b\n'=1+1,"say ""hi"", ok"`)
  })
  it('Kurszeilen einfügen: verschiedene Trennzeichen, Dezimalkomma, Müll wird übersprungen', () => {
    expect(parsePriceLines('AAPL 193.09\nmsft;421,50\nKO: 62\n\nirgendwas\nTSLA\t250')).toEqual({ AAPL: 193.09, MSFT: 421.5, KO: 62, TSLA: 250 })
  })
})
