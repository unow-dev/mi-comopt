# Comment DB v3 本番更新の反復手順

## 前提

GitHub Pages workflow、provider checkout用secretおよびproduction operatorは構成済みであることを前提とする。汎用Work Orchestrator CLIのnewは使用しない。

実行変数を設定する。説明用の <...> や ... をそのままshellへ貼り付けない。

    REPO=/home/uya/Workspace/tiktok-filter-keywords
    DB=/home/uya/Workspace/tiktok-filter-keywords/var/comment-history.sqlite3
    WO=/home/uya/Workspace/tiktok-filter-keywords/var/work-orchestrator-production
    ACTOR=production-reviewer
    cd "$REPO"
    export GITHUB_TOKEN="$(gh auth token)"

## 1. 開始前確認

cutover状態と既存Sessionを確認する。

    npm --workspace package run cutover:v3 -- status --db "$DB"
    npm run comment-data-update:v3 -- sessions \
      --db "$DB" --workspace "$WO"

次を満たさない場合は開始しない。

- cutover stateがsmoke_verified
- legacy writerが無効
- v2 startsが無効
- v3 startsが有効
- 非終端v2 Sessionが0件
- 前回のproduction Sessionに未処理のactionable Human Taskがない

## 2. Session開始

毎回未使用の一意値を設定する。

    SESSION=production-comment-data-update-YYYYMMDDTHHMMSSZ-UNIQUE
    UPDATE_REQUEST=comment-data-update-YYYYMMDDTHHMMSSZ-UNIQUE

    npm run comment-data-update:v3 -- start \
      --db "$DB" --workspace "$WO" \
      --session-id "$SESSION" \
      --update-request-id "$UPDATE_REQUEST" \
      --actor "$ACTOR"

開始後、Human Taskを一覧する。

    npm run comment-data-update:v3 -- tasks \
      --db "$DB" --workspace "$WO" \
      --session-id "$SESSION"

## 3. Artifact型Human Task

readyになったartifact Taskは、必ず次の順で処理する。

1. 同じactorでopenする。
2. 出力されたoutputPathへexpectedFileを1件だけ保存する。
3. JSON、ファイル名、件数および前段identityを確認する。
4. 同じactorでcompleteする。
5. tasksでcompletedを確認する。

    STEP_ID=00-receive-update-artifact
    npm run comment-data-update:v3 -- human-task open \
      --db "$DB" --workspace "$WO" \
      --session-id "$SESSION" \
      --step-id "$STEP_ID" \
      --actor "$ACTOR"

    # openの出力PathへexpectedFileを保存して内容を確認する。

    npm run comment-data-update:v3 -- human-task complete \
      --db "$DB" --workspace "$WO" \
      --session-id "$SESSION" \
      --step-id "$STEP_ID" \
      --actor "$ACTOR"

対象TaskとexpectedFileは次のとおり。

- 00-receive-update-artifact: comment-batch.json
- 03b-receive-classification-response: response.json
- 07b-receive-keyword-proposal: candidate_proposal.json

03bでは前段のartifactContextに表示されたworksetIdと、response.jsonのworkset_idが一致することを確認する。response.jsonはworkset_idとdecisionsだけを持つJSON objectにする。07bではrequestIdとinputFingerprintを確認し、candidate_proposal.jsonはJSON objectだけを保存する。いずれも説明文やMarkdown code fenceを付けない。

## 4. Decision型Human Task

Promotionなどはartifactを配置せず、open後にoutcomeとrationaleを指定して完了する。

Decision Taskのstep IDは次の3つである。tasksに表示されたready Taskを対象にする。

- 05-review-classification
- 09-review-keyword-selection
- 13-review-production-promotion

    STEP_ID=13-review-production-promotion
    npm run comment-data-update:v3 -- human-task open \
      --db "$DB" --workspace "$WO" \
      --session-id "$SESSION" \
      --step-id "$STEP_ID" \
      --actor "$ACTOR"

    npm run comment-data-update:v3 -- human-task complete \
      --db "$DB" --workspace "$WO" \
      --session-id "$SESSION" \
      --step-id "$STEP_ID" \
      --actor "$ACTOR" \
      --outcome accept \
      --rationale "production review approved"

acceptは、対象Release、CI結果および公開経路を確認し、6章のPages同時実行gateを通してから実行する。中止する場合はoutcome rejectと理由を指定する。

## 5. interventionの手動retry

retry exhausted後にmanual_retryを含むinterventionがreadyになった場合だけ実行する。原因を解消してから、同じactorでclaimし再試行する。

    STEP_ID=12-materialize-release:intervention:0
    npm run comment-data-update:v3 -- human-task open \
      --db "$DB" --workspace "$WO" \
      --session-id "$SESSION" \
      --step-id "$STEP_ID" \
      --actor "$ACTOR"

    npm run comment-data-update:v3 -- human-task complete \
      --db "$DB" --workspace "$WO" \
      --session-id "$SESSION" \
      --step-id "$STEP_ID" \
      --actor "$ACTOR" \
      --outcome manual_retry \
      --rationale "verified corrective action"

原因未解消のままretryしない。業務更新を中止する判断以外ではcancel_sessionを選択しない。

## 6. Pages公開の確認

Promotion accept前に、Pages workflowのqueuedまたはin_progress runがないことを確認する。workflowは同一groupを直列化するため、残存runがある場合は完了を待ってからPromotionをacceptする。

    for STATUS in queued in_progress; do
      COUNT=$(gh run list --repo unow-dev/mi-comopt \
        --workflow deploy-pages.yml \
        --status "$STATUS" \
        --json databaseId \
        --jq 'length')
      test "$COUNT" -eq 0 || {
        echo "Pages workflow is still $STATUS: $COUNT run(s)" >&2
        exit 1
      }
    done

確認後にPromotionをacceptし、operatorがworkflow dispatchを行う。対象runがworkflow_dispatchで、deployment request IDを含むことを確認する。

    gh run list --repo unow-dev/mi-comopt \
      --workflow deploy-pages.yml --limit 5 \
      --json databaseId,status,conclusion,displayTitle,url
    gh run watch RUN_ID --repo unow-dev/mi-comopt --exit-status

成功後、operatorのsessionsまたはtasksを1回実行して、Actions完了runのpoll、deployment.completedのDB取り込み、Work Orchestratorへの配送を行う。

    npm run comment-data-update:v3 -- sessions \
      --db "$DB" --workspace "$WO"

## 7. 公開markerと最終状態

    PAGES_URL=https://unow-dev.github.io/mi-comopt/
    curl -fsS --retry 5 --retry-delay 2 \
      "$PAGES_URL/comment-db-v3-deployment.json"
    npm --workspace package run verify:deployed-optimicom-ui-release -- \
      --url "$PAGES_URL" \
      --expected ../docs/active/temp/optimicom-react-tailwind/public/optimicom-ui-release.json
    npm run comment-data-update:v3 -- tasks \
      --db "$DB" --workspace "$WO" \
      --session-id "$SESSION"
    sqlite3 "$DB" \
      ".headers on" \
      ".mode column" \
      "SELECT deployment_request_id, workflow_session_id, release_id, target, status, external_run_ref FROM v3_deployment_requests WHERE workflow_session_id = '$SESSION' ORDER BY created_at DESC;"
    npm --workspace package run cutover:v3 -- status --db "$DB"

次をすべて確認して更新を完了とする。

- Pages workflowがsuccess
- markerのtargetがproduction
- markerのdeployment_request_id、release_id、release_bundle_sha256がDB・workflow入力と一致
- deployment requestがsucceeded
- production Sessionがcompleted
- actionable Human Taskが空
- cutover stateがsmoke_verified

## 8. claimの解放

actorを変更して引き継ぐ場合だけ、現在のclaimを同じactorで解放する。

    npm run comment-data-update:v3 -- human-task release \
      --db "$DB" --workspace "$WO" \
      --session-id "$SESSION" \
      --step-id "$STEP_ID" \
      --actor "$ACTOR"

open前にcompleteしない。NOT_CLAIM_OWNERになった場合は、同じactorでopenしてから再実行する。
