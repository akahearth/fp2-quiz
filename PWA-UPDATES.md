# PWA更新処理の修正記録

確認日：2026年10月12日。アプリ版1.5.0。公開版識別子はversion.jsonに記録します。

## 調査結果

旧sw.jsは390リソースをcache.addAllで一括取得していました。過去問の画像360枚・PDF6件だけで28,104,593バイト（約28.1MB）です。1件のHTTP失敗や容量不足でもinstallが失敗し、旧SWが残る構造です。利用者のiPhoneの実際の失敗ログは未採取なので、全端末の直接原因だったとは断定していません。

旧app.jsには復帰時の明示的update()、手動確認、redundant状態の失敗表示がありませんでした。register時点で既にinstallingのworkerの監視が不足し、controllerchange時には更新操作の有無と演習状態を再確認せず再読み込みする場合がありました。

代表的な検証記録・画像・PDFはHTTP 200で配信されていました。現在の欠落は確認していません。

修正前のGitHub Pages配信は2026-10-12-v19-past-three-sets、sw.jsのHTTP Cache-Controlはmax-age=600でした。SW更新はupdateViaCache:none、公開版情報はno-storeと確認用クエリーで取得します。

## 状態の区別

| 状態 | 判定と対応 |
| --- | --- |
| 更新確認失敗 | register・update・版情報取得失敗、タイムアウト。保存済み問題と履歴を継続できる旨を表示 |
| 新版インストール中 | registration.installing、state=installing。必須ファイルの取得中と表示 |
| 新版インストール失敗 | state=redundant、必須取得失敗、時間超過。失敗と再試行を案内 |
| 新版有効化待ち | registration.waiting、state=installed。インストール完了と更新操作を明記 |
| 別画面で有効化済み | controllerchange。演習を再読み込みせず、安全な画面切替え待ちを表示 |
| 最新版 | 公開版と現在コードが一致し、installing・waitingがない。確認日時とともに表示 |

update()の成功だけではinstall成功と扱いません。既にinstalling・waitingだったworkerも監視します。初回のinstalled→active遷移を更新待ちと誤認する競合も修正しています。

## 更新確認と安全な切替え

- 起動、visibilitychangeによる復帰、pageshow、online復帰時に、オンラインなら更新確認。同時の確認を1処理にまとめます。
- 更新通知と「データ・設定」に「最新版を確認」を設置。
- install時はskipWaitingを呼びません。利用者が「更新する」を押すとACTIVATE_UPDATEを送り、skipWaitingで有効化します。
- 新しいcontrollerへの切替え後、本人が更新操作をしており、安全条件を再確認できた場合だけ1回再読み込みします。
- 他画面での有効化や、更新要求後に演習が開始された場合は、再読み込みを止めます。
- 別の級を含む途中保存、両級の過去問、未保存の成績、破損データ保護、別タブ競合、確認画面、追加保存中を確認します。
- 更新処理はlocalStorage・sessionStorageの削除・初期化・書換えを行いません。既存の保存キー・形式・問題データ・履歴を維持します。

## キャッシュの分離

必須キャッシュは17ファイル。画面、JS、問題JSON、アイコン、公開版情報、追加一覧だけをinstall時に取得します。PDF・問題画像・検証記録は追加キャッシュ375件へ分離しました。

追加コンテンツは閲覧時に保存します。設定では1回分61件、または過去問全6回366件を事前保存できます。2件ずつ取得し、進捗・保存数・失敗数を表示。部分失敗時も保存済み分を保持し、再試行では既存分を再利用します。容量不足で保存できなくても、取得済みのオンライン表示は返します。

追加キャッシュのキーは内容のSHA-256を含みます。版が変わっても同じ内容を再利用し、異なる旧画像を誤採用しません。旧390件の一括キャッシュを消さず、内容が一致する画像・PDFを必要時に再利用するため、旧版で保存済みの過去問もオフラインで取得できます。

旧必須キャッシュは前の1版を保持し、それより古い必須版だけを整理。install失敗時は失敗した新しい必須キャッシュだけを破棄します。追加キャッシュ、旧一括キャッシュ、他アプリのキャッシュ、学習記録を削除しません。

「基本問題はオフライン利用可」と「過去問の図表・PDF保存済み」を区別します。新規利用者が未保存の過去問をオフラインで開いた場合は、その回の保存方法を通知します。

## iPhoneホーム画面PWAと既存利用者

Safariタブとホーム画面PWAの保存場所が異なる可能性があります。更新確認、オフライン保存、バックアップは実際に使うホーム画面アプリ内で行います。

公開URL、sw.jsのURL、scopeを維持します。アプリ再追加、SW登録解除、Webサイトデータ消去、履歴初期化は更新手順に含めません。

既存旧版の最初の移行は、旧コードとブラウザ自身の更新確認で新版SWを取得し、旧版にもある通知で切り替えます。新版は大量の画像をinstallの前提にしないため、旧一括取得の失敗条件を減らします。旧版で通知を取り逃した場合は、アプリを削除せず一度終了し、同じホーム画面アイコンから起動します。今回の版へ移行後は、起動・復帰・手動確認を利用できます。

閉じたアプリに強制実行したり、全端末へ即時反映したりすることはできません。初回の移行は端末の通信、iOSの更新確認タイミング、PagesデプロイとCDNの反映に依存します。Safariだけの再読み込みではホーム画面PWAの更新を代行できるとは扱いません。

## 変更ファイル

- sw.js：必須・追加キャッシュ分離、内容ハッシュ、旧保存分の再利用、安全な待機。
- pwa.js：確認・状態監視・有効化・再読み込み・追加保存の管理。
- app.js：通知、手動確認・追加保存ボタン、両級の更新保護、状況表示。
- past.js：過去問の未保存・破損・競合・更新中の保護。
- index.html、style.css：通知と設定の表示。
- version.json、content-manifest.json：公開版・追加ファイルの内容ハッシュ。
- scripts/prepare-release.mjs：内容から公開版を生成。--checkで更新漏れを検出。
- package.json：1.5.0へ更新。.nojekyll：静的ファイルをそのまま配信する指定。
- tests/pwa.test.js、tests/update.test.js、tests/release.test.js：更新・失敗・履歴保護・公開準備の検証。
- README.md、TEST-RESULTS.md、PWA-UPDATES.md：利用・再公開手順と確認記録。

オリジナル600問、過去問360問、既存のメモ・学習・復習・模試・バックアップのデータと保存形式は変更していません。

## 検証結果

自動テスト101件成功、失敗0・スキップ0。必須取得失敗、公開版不一致、installing・redundant・waiting、タイムアウト、他画面での有効化、重複確認抑止、容量不足、部分保存と再試行、旧画像照合、全360画像・6PDFのオフライン取得、両級の成績・復習・途中保存保持、公開ファイルの内容ハッシュ一致を確認。

実ブラウザでは必須questions.jsonのHTTP 503を発生させ、install失敗を確認。503解除後に再確認すると「install完了・有効化待ち」へ移行しました。途中の3級演習中は更新を止め、1回答・0正解・復習待ち1件・途中保存を維持。学習終了後に更新し、完成版へ切替えても成績と復習待ちが残りました。

3級過去問1回分を保存し、61/61件成功を確認。検証サーバー停止後に再読み込みしても起動し、保存済み第52問の図表を表示できました。初回installの誤通知も修正して回帰テストを追加。実機iPhone、ホーム画面起動、実際のバックグラウンド停止復帰は未検証です。検証データは利用者の履歴とは別のローカルオリジンに保存しています。

## GitHub Pagesへの再アップロード

今回の配布物は公開準備済みです。フォルダの中身を既存リポジトリ直下へ反映し、新規のpwa.js、version.json、content-manifest.json、scriptsフォルダも含めて公開します。sw.jsだけの差し替えではありません。公開URL・リポジトリ名・scopeを維持します。

今後の編集後はNode.js 22以上で次を実行してください。追加パッケージは不要です。

~~~powershell
node scripts/prepare-release.mjs
node scripts/prepare-release.mjs --check
node --test tests/*.test.js
~~~

準備スクリプトは必須ファイル・SWの内容と追加コンテンツのハッシュから公開版を生成し、sw.js、pwa.js、version.json、content-manifest.jsonをそろえます。同じ内容は同じ公開版、ファイルが変われば版も変わります。表示版を変えるときはpackage.jsonのversionを更新します。

Gitの場合は差分を確認してコミット・mainへプッシュします。WebのUpload filesの場合は準備済みフォルダの中身をアップロードしてmainへコミットします。

~~~powershell
git status
git add .
git commit -m "PWAの更新確認とキャッシュ管理を改善"
git push origin main
~~~

Settings → Pagesでmain / (root)が公開元であること、ActionsのPagesデプロイ完了を確認します。公開版情報をオンラインで確認後、既存ホーム画面PWA内で「最新版を確認」→学習終了→「更新する」を確認します。Safariタブだけの確認では代替しません。

## 参照資料

- [Service Workers仕様：update・waiting・skipWaiting](https://w3c.github.io/ServiceWorker/)
- [WebKit：保存領域とホーム画面WebアプリのStorage API](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [GitHub Pagesの公開元設定](https://docs.github.com/ja/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
