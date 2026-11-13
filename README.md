# Sekirei Action

## 使い方

リポジトリのSecretsに`SEKIREI_API_KEY`と`ANTHROPIC_API_KEY`を登録し、`.github/workflows/security-review.yml`に以下を追加します。

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

PRの差分をレビューし、結果をPRコメントとActionsのSummaryに表示します。Markdown / JSONのレポートもartifactから取得できます。

## フルスキャン

上の例でイベントを`workflow_dispatch`、`scan-type`を`full`に変更し、ジョブの`if`とcheckoutの`ref`を削除します。`pull-requests: write`は不要です。結果はActionsのSummaryで確認できます。
