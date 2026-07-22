// Runs 画面(`uG2hZ`)の決定的 fixture。第 2 段では DO ストレージからの
// run / rollout / score データに置き換わる。形は据え置きで data source だけ差し替える想定。

export type RunListItem = {
  /** live データ由来の run ID。静的 fixture には無い(クリック選択は live のみ)。 */
  id?: string
  title: string
  meta: string
  avg: string
  dot: 'accent' | 'tool' | 'warn'
  bars: number[]
  selected?: boolean
}

export type RolloutChip = { kind: 'thinking' | 'tool' | 'final'; label: string }
export type RolloutRow = {
  turn: string
  chips: RolloutChip[]
  score: string
  selected?: boolean
}

export type RubricItem = { name: string; score: string; desc: string }

export type RunsFixture = {
  header: { epoch: number; avg: string }
  list: RunListItem[]
  detail: {
    tag: string
    title: string
    meta: string
    growth: string
    currentScore: string
    curve: { label: string; value: string; bold?: boolean; height: number }[]
    tiles: { cap: string; val: string; valColor: string; hint: string }[]
    rolloutMeta: string
    rollout: RolloutRow[]
    rubricTrainer: string
    rubric: RubricItem[]
    total: string
  }
}

export const runsFixture: RunsFixture = {
  header: { epoch: 7, avg: '8.5' },
  list: [
    {
      title: 'ECサイト設計',
      meta: '7 epochs · 2h ago',
      avg: '6.1',
      dot: 'accent',
      bars: [6, 8.4, 10.8, 12, 14.4, 18, 20.4],
      selected: true,
    },
    {
      title: '決済基盤',
      meta: '5 epochs · 5h ago',
      avg: '7.2',
      dot: 'tool',
      bars: [12, 14.4, 16.8, 18, 19.2],
    },
    {
      title: '認証システム',
      meta: '6 epochs · 1d ago',
      avg: '5.4',
      dot: 'tool',
      bars: [7.2, 9.6, 12, 13.2, 14.4, 15.6],
    },
    {
      title: 'リアルタイム同期',
      meta: '4 epochs · 2d ago',
      avg: '4.8',
      dot: 'tool',
      bars: [7.2, 9.6, 12, 14.4],
    },
    {
      title: '検索基盤',
      meta: '8 epochs · 3d ago',
      avg: '6.7',
      dot: 'tool',
      bars: [4.8, 7.2, 9.6, 12, 14.4, 15.6, 16.8, 19.2],
    },
    {
      title: '通知配信',
      meta: '3 epochs · 4d ago',
      avg: '3.9',
      dot: 'warn',
      bars: [4.8, 8.4, 10.8],
    },
    {
      title: 'データ整合性',
      meta: '5 epochs · 6d ago',
      avg: '7.8',
      dot: 'tool',
      bars: [13.2, 15.6, 16.8, 19.2, 20.4],
    },
  ],
  detail: {
    tag: 'run #12',
    title: 'ECサイト設計',
    meta: 'trainer: claude -p · codex 殻 · 2026-07-19 · 7 epochs · 41 turns',
    growth: '+6.0 growth ↗',
    currentScore: '8.5',
    curve: [
      { label: 'ep1', value: '2.5', height: 37.5 },
      { label: 'ep2', value: '3.5', height: 52.5 },
      { label: 'ep3', value: '4.5', height: 67.5 },
      { label: 'ep4', value: '5.0', height: 75 },
      { label: 'ep5', value: '6.0', height: 90 },
      { label: 'ep6', value: '7.5', height: 112.5 },
      { label: 'ep7', value: '8.5', bold: true, height: 127.5 },
    ],
    tiles: [
      { cap: 'AVG SCORE', val: '6.1', valColor: 'var(--xml)', hint: '+2.3 vs ep1' },
      { cap: 'EPOCHS', val: '7', valColor: 'var(--text-primary)', hint: '41 turns total' },
      {
        cap: 'TOKENS',
        val: '48.2K',
        valColor: 'var(--text-primary)',
        hint: '12.4K in · 35.8K out',
      },
      { cap: 'BEST TURN', val: '8.5', valColor: 'var(--text-primary)', hint: 'turn 38 · ep7' },
    ],
    rolloutMeta: 'epoch 7 · 6 turns',
    rollout: [
      { turn: 'turn 34', chips: [c('thinking'), c('tool', 'tool ×2'), c('final')], score: '7.5' },
      { turn: 'turn 35', chips: [c('thinking'), c('tool', 'tool ×1'), c('final')], score: '7.0' },
      { turn: 'turn 36', chips: [c('thinking'), c('final')], score: '8.0' },
      { turn: 'turn 37', chips: [c('thinking'), c('tool', 'tool ×3'), c('final')], score: '8.0' },
      {
        turn: 'turn 38',
        chips: [c('thinking'), c('tool', 'tool ×1'), c('final')],
        score: '8.5',
        selected: true,
      },
      { turn: 'turn 39', chips: [c('thinking'), c('final')], score: '8.5' },
    ],
    rubricTrainer: 'claude -p',
    rubric: [
      { name: '正確性', score: '[SCORE: 8.5/10]', desc: '教師軌跡との差分は決済の冪等性のみ' },
      { name: '設計判断', score: '[SCORE: 7.0/10]', desc: '3サービス分割は妥当・境界づけが明快' },
      { name: 'tool 効率', score: '[SCORE: 8.0/10]', desc: '並列 exec / web_search を適切に活用' },
      { name: '説明の明快さ', score: '[SCORE: 9.0/10]', desc: 'Mermaid ER 図で設計意図を可視化' },
    ],
    total: '[SCORE: 8.0/10]',
  },
}

function c(kind: RolloutChip['kind'], label?: string): RolloutChip {
  return { kind, label: label ?? kind }
}
