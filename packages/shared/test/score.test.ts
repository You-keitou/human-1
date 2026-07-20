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

  test('複数タグは最後のもの(トレーナーの訂正)を採用する', () => {
    expect(extractScore('前置き [SCORE: 6.0/10] 後書き [SCORE: 9/10]')).toEqual({
      value: 9,
      max: 10,
    })
  })

  test('max が 10 でなければ null(スケールは /10 固定)', () => {
    expect(extractScore('[SCORE: 1/2]')).toBeNull()
    expect(extractScore('[SCORE: 85/100]')).toBeNull()
  })

  test('範囲外の value は null', () => {
    expect(extractScore('[SCORE: 11/10]')).toBeNull()
  })

  test('負値は拾わず null', () => {
    expect(extractScore('[SCORE: -3/10]')).toBeNull()
  })

  test('末尾が負値タグなら最後の候補を検証して null(last-tag-wins を維持)', () => {
    // 負値を候補として捕捉できないと、手前の 2/10 が誤って残る。
    expect(extractScore('[SCORE: 2/10] としたが訂正 [SCORE: -3/10]')).toBeNull()
  })

  test('閉じ括弧前の空白を許容する', () => {
    expect(extractScore('[SCORE: 0 / 10 ]')).toEqual({ value: 0, max: 10 })
  })

  test('境界値 0/10・10/10 は採用する', () => {
    expect(extractScore('[SCORE: 0/10]')).toEqual({ value: 0, max: 10 })
    expect(extractScore('[SCORE: 10/10]')).toEqual({ value: 10, max: 10 })
  })
})
