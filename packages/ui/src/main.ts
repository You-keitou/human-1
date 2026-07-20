// M3 で React SPA に置き換える予定のプレースホルダ。
// 現時点はテスト基盤(Playwright スモーク / px 検証)を今日グリーンで回すための最小描画のみ。
const root = document.querySelector<HTMLDivElement>('#app')

if (root) {
  const heading = document.createElement('h1')
  heading.textContent = 'human-1'
  heading.dataset.testid = 'app-title'
  root.append(heading)
}
