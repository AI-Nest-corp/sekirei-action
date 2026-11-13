# Sekirei Action

Sekireiからレビュー指示を取得し、Claude CodeまたはCodex CLIでコードを静的にレビューするGitHub Actionです。スキル本文はこのリポジトリに含みません。

## 差分スキャン

リポジトリのSecretsに`SEKIREI_API_KEY`と`ANTHROPIC_API_KEY`を登録します。`v1`公開後の利用例です。

```yaml
name: Security review
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false
      - uses: AI-Nest-corp/sekirei-action@v1
        with:
          api-key: ${{ secrets.SEKIREI_API_KEY }}
          scan-type: diff
          agent: claude
          ai-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Codexは`agent: codex`、`ai-api-key: ${{ secrets.OPENAI_API_KEY }}`に変更します。接続先URLの指定は不要です。

## フルスキャン

イベントを`workflow_dispatch`、`scan-type`を`full`に変更し、checkoutの`ref`とPR用の`if`を外します。PR書き込み権限は不要です。

diffはmerge-baseからPR headまでの変更と周辺ファイルを確認し、PRコメントへ出力します。fullはcheckoutしたコミットの追跡ファイルを確認します。どちらもジョブのSummaryに件数・重要度別の内訳・指摘一覧と修正案を表示し、根拠・影響・確認方法は折りたたみます。検証済みの`report.md`と`report.json`をartifactに7日間保存します。除外情報などの詳細はJSONに残します。

## 入力

| 入力 | 内容 |
| --- | --- |
| `api-key` | Sekirei APIキー。必須 |
| `scan-type` | `diff` / `full`。必須 |
| `agent` | `claude` / `codex`。必須 |
| `ai-api-key` | 選択した提供元のAPIキー。必須 |
| `github-token` | 既定は`github.token`。diffのコメント投稿に使用 |
| `model` | 任意。未指定時は固定したCLIの既定モデル |
| `timeout-minutes` | AI実行時間。既定10分、1–60分 |
| `api-url` | 開発時のみ上書きするHTTPS origin。既定はSekirei本番 |

出力は`execution-id`、`report-path`、`findings-count`、`status`（`completed` / `skipped` / `failed`）。指摘が見つかっただけでは失敗にしません。対象コードを読み切れなかった場合はファイル名・理由をエラーとジョブのSummaryに表示し、レポートを残して失敗にします。生成物の除外やリポジトリ外の設定は確認範囲の制約として記録し、それだけでは失敗にしません。

## 実行範囲

- Linux x64のGitHubホストランナー向け。外部forkのPR、`pull_request_target`はスキル取得前に拒否します。
- 公式CLIを固定バージョンでインストールします。Claude Codeは`2.1.323`、Codexは`0.168.0`。公式Actionにはプロンプト／実行ログの出力があるため、CLIの実行と結果の回収をこのActionが管理します。
- Gitのblobから取得したソースと差分をプロンプトで渡します。CLIはcheckout外の一時ディレクトリで動作し、リポジトリの設定・フックを読み込まず、コマンド実行やサブエージェントを使いません。動的な脆弱性検証や自動修正は行いません。
- 最大100ファイル、1ファイル48 KiB、差分込みで合計256 KiB。diffでは変更ファイルを優先し、残りの範囲で周辺ファイルを渡します。上限で確認できなかった範囲は明記します。
- 依存物・生成物・バイナリ・symlink・submoduleを除外します。対象がなければ配布前に`skipped`とします。
- SaaSへ送るのはリポジトリ情報とscan typeだけです。コードは選択したAI提供元へ送ります。AIにはSaaSキーとGitHubトークンを渡しません。スキル、プロンプト、生のAI出力はログ・artifactに含めず、終了時に一時ファイルを削除します。
- 配布確定時にdiffは1、fullは3クレジットを消費します。同じHTTP要求の再試行は同じIdempotency Keyを使います。新しいワークフロー実行は別スキャンです。配布後のCLI起動・解析・投稿の失敗による取り消しはありません。

## このリポジトリでの確認

通常のpush／PRは、Secrets不要の型チェック・テスト・ビルドだけを実行します。

- **Full Scan**：Actions画面から手動実行。自身のリポジトリをfullスキャン（3クレジット）。
- **Diff Scan**：同一リポジトリのPRに`sekirei-review`ラベルを付けたときだけdiffスキャン（1クレジット）。PRを更新するだけでは再実行しません。

```sh
npm ci --ignore-scripts
task check
```

`dist/main.cjs`は配布物としてコミットします。`task check`で再生成し、ソースと一緒に更新してください。

CLI接続仕様：[Claude Code](https://code.claude.com/docs/en/headless)、[Codex](https://learn.chatgpt.com/docs/non-interactive-mode)。
