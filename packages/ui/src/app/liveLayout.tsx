import type { ReactElement, ReactNode } from 'react'

// live ルート共通のレイアウト戦略。モックは 1440px 前提だが、ワイドディスプレイでは
// 右に死に余白ができるため、ヘッダー内容と本体を同一の max-width コンテナで中央寄せする。
//  - ヘッダーの下線は全幅(標準的なアプリの見た目)、中身は max-width に揃える
//  - 本体も同じ max-width + 同じ左右ガター(LIVE_GUTTER)で、ヘッダーと縦に揃う
//  - preview(/preview/*)はこの層を通らないため px ゲートに影響しない

export const LIVE_MAX_W = 1560
export const LIVE_GUTTER = 20
// Runs は desktop 専用レイアウト(モバイル版なし)。狭い画面でもこの最小幅で desktop 比率を保つ。
export const RUNS_MIN_W = 1240

// ヘッダー: 全幅の下線帯 + max-width 中央寄せの中身。
export function LiveHeaderShell({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      style={{
        width: '100%',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: LIVE_MAX_W,
          marginInline: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// Runs 専用の本体。広い画面では max-width 中央寄せ、狭い画面ではページ全体を横スクロール
// させず本体だけを内部で横スクロールさせる(min-width で desktop レイアウトを維持)。
// margin-inline:auto + overflow-x:auto の組み合わせは、余白ありでは中央寄せ、あふれ時は
// 左端から素直にスクロールする(flex center の左見切れを避ける)。
export function WideCenteredBody({ children }: { children: ReactNode }): ReactElement {
  return (
    // display:flex + align stretch で高さを伝播(h="fill" のカードが縦に伸びる)。
    // inner の margin-inline:auto は flex の auto-margin として働き、余白ありでは中央寄せ、
    // あふれ時は左端からスクロール(justify-content:center の左見切れを避ける)。
    <div style={{ flex: 1, minHeight: 0, width: '100%', overflowX: 'auto', display: 'flex' }}>
      <div
        style={{
          width: '100%',
          maxWidth: LIVE_MAX_W,
          minWidth: RUNS_MIN_W,
          marginInline: 'auto',
          minHeight: 0,
          display: 'flex',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// 本体: 残り高さを埋めつつ、max-width で中央寄せする。単一の伸長子(grow な Frame)を渡す。
export function CenteredBody({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: LIVE_MAX_W,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </div>
  )
}
