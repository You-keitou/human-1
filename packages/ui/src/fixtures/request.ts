import type { IconName } from '../components/Icon'

// 左カラム Request カードの決定的コンテンツ(Flow1 / Whiteboard 共有)。design-spec §2.4 / §4。
// preview 静的画面はこの fixture を実コンポーネント(RequestCard)へ流し込む。

export type RequestToolDef = { name: string; icon: IconName; sig: string }

export const requestTools: RequestToolDef[] = [
  { name: 'exec_command', icon: 'terminal', sig: '(cmd)' },
  { name: 'web_search', icon: 'search', sig: '(query, max_results?)' },
  { name: 'apply_patch', icon: 'diff', sig: '(patch)' },
  { name: 'view_image', icon: 'image', sig: '(path)' },
]

export const requestFixture = {
  sysPreview: '<system-reminder> あなたは訓練中の human-1。応答は thinking→tools→final の順で…',
  trainerLine:
    '前エポックの講評: DB分割の判断は良い(+1.5)。今回は EC サイトの注文システムを設計せよ。全体アーキテクチャと ER 図を含めること。',
  trainerXml: '<required>図は Whiteboard で作成し Mermaid で添付</required>',
  toolResult: {
    tool: 'exec_command · exit 0',
    body: 'schema.sql · 42 lines\nCREATE TABLE orders (id uuid PRIMARY KEY, user_id uuid, …',
  },
} as const
