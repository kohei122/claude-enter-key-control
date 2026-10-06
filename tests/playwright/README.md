# Claude Mock DOM Browser Tests

## 目的と対象

実サービスに接続せず、公開用 content.js を Chromium に unpacked extension として読み込み、
最小 DOM 上でキーボード・chrome.storage・送信候補判定の統合動作を確認します。
実 Claude UI の再現や現在の UI rollout との一致を保証するものではありません。

導入前は package.json / lockfile / 自動単体テストがありませんでした。
本番は content.js と popup.js / popup.html で構成され、service worker はありません。
popup は設定・言語表示・対象タブへの再注入を担当します。popup UI 自体は今回の Browser 対象外です。
リリース候補は1.4.1です。1.4.0からの本番変更はcontent.jsの送信DOM判定とmanifestのversionだけです。権限・popup・アセットは変更していません。

## 実装から確認した DOM 契約

- keydown の target から closest で入力欄を解決します。
  data-testid="chat-input" が優先され、代替は DIV[contenteditable="true"][role="textbox"]。
  ProseMirror クラスやライブラリには依存しません。fallback fixture のクラスは装飾です。
  マーカーを持たない textarea や role のない contenteditable は対象外です。
  data-testid 分岐は contenteditable / DIV を必須にしないため、すべての textarea を
  非対応と断定するものではありません。
- 入力欄の親から最大10階層、button が1〜8個ある最初の領域を採用します。
  html / body / main 自体は composer root にしません。document 全体の探索はしません。
- 候補は HTMLButtonElement、disabled でなく aria-disabled != "true"、
  getClientRects().length > 0。添付メニュー、モデル、録音、feedback 等は除外されます。
- 既知の送信 aria-label を持つ強い候補が1個なら採用します。
  強い候補が一意でなければ送信しません。未知の単一候補fallbackはありません。
  CSS class / 大きさ / 右寄せの加点だけでは強い候補になりません。
- 有効な入力欄の Enter は insertParagraph、設定 shortcut は候補の click を実行します。
  未許可の修飾 Enter は抑止します。IME中、設定未読込、無効設定、untrusted event は介入しません。

## 送信の安全契約

修正前は入力候補を収集せず、event targetに近いrootのボタンを選んでいました。
さらに、強い送信候補がなくても「除外後の候補が1個」で採用するfallbackがありました。
shared-inputsはどちらの入力欄からも同じボタンを、single-unknownは未知ボタンをクリックしていました。

修正後は次の条件を満たす場合だけshortcut送信します。

1. document.activeElementを既存の入力解決処理に渡し、event側の論理入力と一致すること。
2. 選ばれたroot内の既存selectorに一致する要素を同じ処理で論理入力へ正規化し、
   重複をSetで除去します。矩形を持ち、disabled / readOnly / aria-disabledでない候補が
   一意で、event側の入力と一致すること。
3. 従来の除外・disabled・可視性判定を通った既知の送信候補が一意であること。
   既存の多言語aria-label条件を維持し、未知の単一候補fallbackは削除しました。
   class・サイズ・位置の加点だけでは100点に達せず、送信できません。

共有rootに有効な入力欄が2個ある場合、フォーカスはイベント発生元を特定しても
共通ボタンとの対応までは証明しないため、どちらからのshortcutも0回です。
独立したcomposerは各rootで一意性が成立するため、フォーカスした側だけ送信できます。
同一rootでも非表示・無効・readOnlyの古い候補は数えず、有効な入力を維持します。
入れ子のマーカーが同じ論理入力に解決される場合も二重計数しません。

新しいselectorや本番test分岐は追加していません。
Enter改行、shortcutモード判定、IME処理、root探索の上限は変更していません。

### 残る保証範囲

可視性は従来同様getClientRectsの存在による判定です。
opacity:0 / visibility:hidden / ゼロサイズ等を一律に排除する保証ではありません。
認識できない入力への非介入は、実ホスト自身の送信抑止を意味しません。
実Claude UIやOS IMEの完全再現ではなく、ここに記載したDOM契約の回帰テストです。

## Fixture一覧（14 HTML）

| fixture | 構造・期待 |
| --- | --- |
| current | chat-input + 一意な送信ボタン |
| fallback | role=textbox contenteditable DIV、data-testidなし |
| no-input | 入力欄なし、クリック0 |
| no-send | 入力欄のみ、改行あり・クリック0 |
| multiple-send | 既知送信候補2個、クリック0 |
| hidden-only | 非表示composerのみ、フォーカス不可・クリック0 |
| stale-valid | 非表示の古いcomposerと有効composer、有効側だけ1回 |
| multiple-composers | 独立した2つのcomposer、フォーカスした側だけ送信 |
| shared-inputs | 同一rootに2入力欄、両方から送信0 |
| unknown-root | main直下の入力欄とボタン、クリック0 |
| unknown-input | roleもdata-testidもないcontenteditable、非介入 |
| textarea | マーカーなしtextarea、非介入 |
| single-unknown | 未知の単一ボタン、送信0 |
| exclusions | 添付・モデル・録音・feedback除外 + イタリア語送信ラベル |

currentを変形してdisabled / aria-disabled / hidden / 除外ラベル、
強い候補と弱い候補の併存、9ボタン、探索深さ超過も確認します。
全buttonクリックをID付きで計数するため、誤候補のクリックも検出できます。

## テスト構成

- Playwright 1.63.0固定、bundled Chromium、headless、persistent context。
- workers=1、retries=0。固定sleepなし。trace / screenshot / videoは無効。
- OS一時ディレクトリへ本番ファイルをそのままコピーし、コピー側manifestだけを
  localhost matchesへ変更。chrome.storage操作用のテストworkerを追加します。
  本番の送信処理を差し替えず、storage値も実APIで設定します。
- enabledを文字列として投入し、本番loadSettingsがbooleanへ保存するのをpollして
  settingsLoaded完了を待ちます。初期化markerとfixture読込完了も確認します。
- HTTP serverは127.0.0.1のランダムportへbind。対象origin以外のweb requestは遮断・失敗判定。
  DNS制限、background networking無効、CSPでも外部通信を制限します。
- Claude hostnameの差し替えは不要です。content.jsにhostname分岐はありません。
- JS例外 / console error / 想定外通信 / Cookie有無を検査します。
- 終了時はfinallyでcontext・serverを閉じ、当該テストの一時拡張とprofileを削除します。
  Cookie/sessionの投入・保存、storageState、login、実Claude接続は行いません。
- page.jsはクリックとホストへ届いたEnterの観測のみです。
  送信候補選定・shortcut送信・改行の代替実装はありません。
- 通常系は入力→Enter→firstとsecondの別行・段落DOM→クリック0→shortcut→クリック1。
  無効設定の対照試験は改行せずキーがhostへ届くことを確認します。

## UnitとBrowserの分担

Unit 50件（既存30件を維持、送信安全判定20件を追加）。Node標準test / vmのみで、追加のUnit依存はありません。
実content.jsを読み、VM内だけでclosureへのテスト用参照を追加します。
テスト実行時には本番ファイルを書き換えず、設定正規化、Windows/Mac全修飾組合せ、
Enter/NumpadEnter、無効/未読込、isTrusted、IME等を検証します。
12件のモードテストはそれぞれ16修飾組合せ（合計192組）を検証します。

IMEはisComposing / keyCode229 / compositionstart/end / 猶予0,79,80,81msを
Unitの制御時計で検証します。Browserはcompositionstart後の実キー操作に介入しないことだけを確認。
実OS IME、Macの実キーボード、ProseMirrorエンジンの全挙動、実Claude UIは保証対象外です。

Browserは40件（既存32件維持、うち2件を送信0へ変更、8件追加）。WindowsのShift / Ctrl / Both(両方) / Shift+Ctrlを確認します。
実行環境はWindows、Node22.16.0、npm10.9.2です。

## 実行方法

Node20以上を使用します。依存取得時以外はネットワーク不要です。

```powershell
npm ci
npx playwright install chromium
npm run test:unit
npm run test:browser
npm run test:all
```

npm test は新規Unitの実行です。既存npm testはありませんでした。
3回連続確認は npm run test:browser を3回、各終了コード0を確認します。
依存はdevDependencyのみ。lockfile固定。ブラウザを公開ZIPへ含めないでください。
公開パッケージ作成時はtests、node_modules、package関連ファイル等を除外してください。

## 過去コードに対する検出確認

修正commit: 550f74fb29e5aee43fac9b2fe2cfdd821d7a774f (1.4.0)
修正前: 724228b9f4754dd5d59e8993417dcb62f2b1cd8c (1.3.1)

旧content.jsをgit showで取得し、一時コピーのcontent.jsだけを差し替えて、
同じ unknown-root テストを実行しました。本体working treeは変更していません。

- 現在コード: 改行成功、クリック0、PASS。
- 旧コード: 改行成功、その後main内の送信ボタンを1回クリックしFAIL。
- 旧探索がmain/body等へ広がる挙動を、現在のroot制限テストが検出しました。
- 履歴とコードから確認した回帰検出であり、実Claude上の事故再現や旧リリース全体の試験ではありません。
- 一時コピーと出力は検証後削除しました。

再検証する場合も、本番ファイルを上書きせずOS一時ディレクトリに本番ファイル・tests・configをコピーし、
git show 724228b9f4754dd5d59e8993417dcb62f2b1cd8c:content.js の出力をそのコピーだけへ配置します。
nodeのPlaywright CLIで --grep unknown-root を実行し、失敗箇所がクリック数であることを確認します。

## 初期検証時の修正と不安定性

初期fixtureの空のp要素がPlaywright fill後にも残り、改行後innerTextが二重改行になりました。
これは毎回同じ期待値不一致で、タイミング依存ではありません。
不要な初期空段落を除去し、実insertParagraph後のDOMも厳密に確認する形へ修正しました。
retriesや待ち時間追加で回避していません。

## Oopsへの将来接続

この作業ではOopsを変更しません。推奨は以下です。

- unit: ["npm", "run", "test:unit"]、timeout 60秒
- browser: ["npm", "run", "test:browser"]、timeout 180秒

CIはnpm ciとbundled Chromiumの準備が必要です。
ChatGPT/Geminiと同じPlaywright版なのでブラウザキャッシュを共用可能です。
共有rootの曖昧な入力と未知の単一ボタンを送信0回にする回帰ゲートとして接続できます。

## 今回の安全判定修正の検出確認

追加Unitのうち共有rootの2入力・未知単一ボタンの2件を、HEAD 550f74fb29e5aee43fac9b2fe2cfdd821d7a774f
の修正前content.jsに対して一時コピーで実行し、2/2 FAILを確認しました。
今回の修正後は同じ2件がPASSします。テスト用コピーは削除済みです。

入れ子contenteditableの新規Browserテストではfillだけでは内側へフォーカスしなかったため、
tabindexと明示的focus操作を設定し、toBeFocusedで確認してから実キーを押しています。
初期の失敗は操作前提の不一致であり、retryや固定sleepで回避していません。


## fail closed強化後の最終検証（2026-10-06）

- Unit: 既存30 + 追加20 = 50/50 PASS。既存Unitは削除・変更していません。
- Browser: 既存32（安全期待値2件更新）+ 追加8 = 40/40 PASS。
- test:all: Unit 50 + Browser 40 PASS、終了コード0。
- Browser連続3回: 40 + 40 + 40 = 120/120 PASS、各約24秒、flakyなし。
- shared-inputs / single-unknown: クリック0。
- current / fallback / stale-valid: shortcutクリック1回。独立composerと多言語ラベルも維持。
- IME・Enter改行・全Windows shortcutの回帰なし。
- Oops manifest: PASS。
- Oops permissions --require-baseline --strict: PASS。
- Oops check --require-baseline --strict: 終了コード0。
  ZIP未指定のPACKAGE_NOT_CHECKED INFOのみ。WARNING / FAILなし。
- 本番差分はcontent.jsだけ（23行追加・15行削除）。
  manifest 1.4.0 / permissions / host_permissions / optional_permissions /
  optional_host_permissions / content_scripts.matches / popup / assetsは変更なし。
- 今回の変更: content.js、README.md、tests/playwright/claude.spec.cjs、
  tests/playwright/README.md、追加tests/unit/send-safety.test.cjsの5ファイル。
  前回Playwright導入分も未commitのまま残します。
- Oopsおよび他アプリrepoは変更なし。この安全強化の検証段階ではstage / commit / pushを実施していません。
- 依存とlockfileは前回から変更なし。secret候補検出なし、node_modules追跡なし。
- テスト成果物と一時profile / 拡張 / 旧コードコピーは最終監査時に削除確認します。

指定された2つの安全条件を満たし、テストと本番修正を人間レビューへ回せる安定点です。
Oops Test Runner / CIには、上記の保証範囲で接続できます。
実Claudeへのアクセス、Store API、upload / publishは行っていません。

## v1.4.1 release candidate

manifest / package / lockfileのversionを1.4.1へ揃えています。
上記の1.4.0表記は安全修正段階の検証履歴です。公開baselineは1.4.0のまま維持します。
実Claudeでの人間による最終確認は、この作業時点で確認されていません。
HUMAN_BROWSER_CHECK_REQUIRED: 公開前に通常入力、各shortcut、IME、実composerの送信を確認してください。
自動テストはlocalhost Mock DOMだけを使用します。Store upload / publishは行いません。

1.4.1候補の再検証結果（2026-10-06）:
- Unit 50/50 PASS、Browser初回40/40 PASS。
- Browser追加3回連続120/120 PASS、flakyなし。
- test:allはUnit 50 + Browser 40 PASS、終了コード0。
- Oops Manifest Validation / Permission RegressionはPASS。
- --require-baseline --strictは終了コード0、ZIP未指定INFOのみ。
- 公開baseline 1.4.0との差分はmanifestのversionのみ。
- HUMAN_BROWSER_CHECK_REQUIRED。Store upload / publishは行っていません。
