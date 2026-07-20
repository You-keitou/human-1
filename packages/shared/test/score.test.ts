import { describe, expect, test } from 'bun:test'
import { extractScore } from '../src/score'

describe('extractScore', () => {
  test('[SCORE: 7.5/10] を抽出する', () => {
    expect(extractScore('よくできました。[SCORE: 7.5/10]')).toEqual({ value: 7.5, max: 10 })
  })

  test('整数と空白ゆらぎを許容する', () => {
    expect(extractScore('[SCORE:8/10]')).toEqual({ value: 8, max: 10 })
    expect(extractScore('[score: 3 / 10]')).toEqual({ value: 3, max: 10 })
  })

  test('タグがなければ null', () => {
    expect(extractScore('採点を忘れた講評')).toBeNull()
  })

  test('文中のどこにあっても最初の1つを拾う', () => {
    expect(extractScore('前置き [SCORE: 6.0/10] 後書き [SCORE: 9/10]')).toEqual({ value: 6, max: 10 })
  })
})
