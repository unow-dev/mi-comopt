# Work Orchestrator API Reference

この文書は、現在の `work-orchestrator` root entry point から利用できる API と、その利用上の位置づけを説明します。

- 通常の import はすべて `from "work-orchestrator"` から行ってください。
- 下記の「領域」や source module 名は分類のための情報です。`work-orchestrator/runtime` などの subpath import は現在提供されていません。
- 「Typical use」「Integration use」「Low-level」は推奨用途の分類であり、semver 上の stability guarantee を意味しません。
- `WorkDefinition` のような TypeScript type/interface は JavaScript runtime value ではありません。
- root export には runtime facade だけでなく reducer、XState machine、raw Temporal Workflow primitive も含まれます。通常利用では高水準 facade を優先してください。

## 1. どの API を使うか

| 目的 | 第一候補 |
| --- | --- |
| ローカル / 単一 process で orchestration を実行 | `WorkOrchestrator` |
| Work graph を定義 | `WorkDefinition`, `Step`, `TaskContract` |
| Human Task を操作 | `claimTask()`, `releaseTask()`, `completeHumanTask()` |
| Session / Task / history を観測 | `WorkOrchestrator.getSessionView()` |
| SQLite 永続状態を管理 | `Registry` |
| Artifact bytes を管理 | `ArtifactStore` |
| Agent 実装を接続 | `AgentAdapter`, `WorkerProfile` |
| Codex CLI を Agent として接続 | `createCodexCliAdapter()` |
| Temporal Worker を起動 | `createWorkOrchestratorWorker()` / `runWorkOrchestratorWorker()` |
| Temporal Client から操作 | `connectWorkOrchestratorClient()` / `WorkOrchestratorTemporalClient` |
| Definition を単独検証 | `validateAndHashDefinition()` |
| reducer / machine を直接扱う | `reduceCommand()`, `sessionMachine` など low-level API |

## 2. Core orchestration

### `WorkOrchestrator`

**種別:** class  
**用途:** Typical use

単一 Node.js process 内で WorkDefinition の登録、Session 開始、command serialisation、Human / Agent Task、Registry commit、Artifact materialisation をまとめる主 facade です。

```ts
new WorkOrchestrator(options?: OrchestratorOptions)
```

#### `OrchestratorOptions`

| field | type | default | 説明 |
| --- | --- | --- | --- |
| `registry` | `Registry` | `new Registry()` | 既定では in-memory SQLite。 |
| `artifactStore` | `ArtifactStore` | `new ArtifactStore()` | 既定では OS temporary directory 配下。 |
| `workers` | `WorkerProfile[]` | `[]` | Agent Task の routing 対象。 |
| `agentAdapter` | `AgentAdapter` | `new FakeAgentAdapter()` | 既定は受入試験用。実運用では明示設定を推奨。 |

#### 主要 method

| method | 用途・注意 |
| --- | --- |
| `registerDefinition(definition)` | Definition を検証・hashing して Registry に登録し、`ValidatedDefinition` を返す。 |
| `addWorker(worker)` | WorkerProfile を runtime と Registry projection に追加/更新する。 |
| `startSession(input)` | 登録済み definition から Session を開始し、自動 advance を drive する。既定 revision は `0`。 |
| `claimTask(sessionId, taskId, actor, commandId?)` | ready Human Task を actor が claim する。 |
| `releaseTask(...)` | claim 済み Human Task を release する。 |
| `completeHumanTask(..., outcome?, result?, commandId?)` | Human Task を完了する。`allowedOutcomes` / schema がある場合は契約に従う必要がある。 |
| `resumeAgentTask(...)` | manual retry が許された blocked Agent Task を再開する。 |
| `cancelSession(...)` | Session cancellation を開始する。running Agent の cancellation intent も処理する。 |
| `receiveExternalEvent(...)` | event wait 用の外部 event を投入する。 |
| `fireTimer(...)` | timer wait を発火する。in-process runtime で timer を外部 scheduler から進める場合に使う。 |
| `getSessionView(sessionId)` | Registry 上の session/scopes/tasks/executions/waits/artifacts と history/consistency をまとめて観測する。通常の観測には `state()` よりこちらを推奨。 |
| `state(sessionId)` | raw `RuntimeState` を返す。低レベル inspection / test 向け。 |
| `pendingTimers(sessionId)` | waiting timer の `waitId` / `delayMs` を返す。 |
| `reconcile(sessionId, temporalState?)` | in-memory/Temporal-side state と Registry projection の revision/hash を照合する。 |
| `sessionRuntimeInfo(sessionId)` | SDK 非依存の runtime model 上の workflow/run ID を返す。実 Temporal handle の代替ではない。 |
| `dispatch(sessionId, command, actor?, commandId?)` | `DomainCommand` を直接送る低水準入口。通常は専用 method を優先する。 |

`WorkOrchestrator` には `close()` はありません。外から `Registry` を渡した場合は、その所有者が `registry.close()` を呼びます。

### `StartSessionInput`

```ts
interface StartSessionInput {
  sessionId: string;
  workDefinitionId: string;
  revision?: number;   // default: 0
  input?: JsonValue;   // default: null
  actor?: ActorRef;    // default: system actor
}
```

同じ `sessionId` の start command は idempotency receipt により扱われます。同一 request は再利用できますが、同じ start command ID で異なる内容を使用すると conflict になります。

### `getSessionView()` と `state()` の使い分け

- **通常の観測:** `getSessionView()`。Registry に永続化された projection、history、consistency を一度に確認できます。
- **raw state が必要:** `state()`。`RuntimeState` 全体を直接扱います。
- `getSessionView()` の返り値には現在独立した `SessionView` named type は export されていません。

## 3. WorkDefinition と Step

### `WorkDefinition`

```ts
interface WorkDefinition {
  workDefinitionId: string;
  revision: number;
  schemaVersion: number;
  root: Step;
  definitionHash?: string;
  limits?: {
    maxBufferedExternalEvents?: number;
    maxDynamicTasksPerSession?: number;
  };
}
```

`registerDefinition()` または `validateAndHashDefinition()` を通すと canonical hash が `definitionHash` に設定されます。同じ `(workDefinitionId, revision)` に異なる hash を登録することはできません。

### Step kinds

| type | `kind` | 説明 |
| --- | --- | --- |
| `TaskStep` | `task` | Human または Agent Task。`goal` と `TaskContract` を持つ。 |
| `SequenceStep` | `sequence` | `children` を順に実行する。 |
| `ChoiceStep` | `choice` | Human/Task decision の `outcome` で `branches` を選ぶ。 |
| `ParallelAllStep` | `parallelAll` | 全 branch を実行し、全完了で scope を完了する。 |
| `WaitEventStep` | `waitEvent` | `eventType` / `correlationKey` に一致する event を待つ。 |
| `WaitTimerStep` | `waitTimer` | `delayMs` の timer を待つ。 |
| `DynamicExpandStep` | `dynamicExpand` | planner の `TaskProposal[]` から sequence または parallelAll の Task を実行時生成する。 |

### `TaskContract`

| field | 説明 |
| --- | --- |
| `workerKind` | `"human"` または `"agent"`。 |
| `requiredCapabilities` | Agent routing で Worker が持つ必要がある capability。 |
| `requestedPermissions` | Worker が enforce 可能である必要がある permission。 |
| `retryPolicy.maxAttempts` | Agent Execution の最大 attempt 数。 |
| `retryPolicy.manualRetryAllowed` | 自動 retry 枯渇後の manual retry を許可する。 |
| `retryPolicy.interventionOnExhaustion` | retry exhaustion 時の intervention policy。 |
| `budgets.maxWallTimeMs` | runtime/Agent の wall-time budget。 |
| `budgets.maxTokens`, `maxCost` | Worker が enforce 可能な追加 budget。 |
| `outputSchema` | Artifact/output contract 用 schema。 |
| `resultSchema` | result JSON の検証 schema。 |
| `allowedOutcomes` | Human Task 等で許可する outcome の集合。 |

### `InputBinding`

`source: "session" | "step"` と JSON Pointer `path` で入力を解決します。`source: "step"` の場合は `stepId` を指定します。`jsonPointer()` / `isValidJsonPointer()` はこの仕組みの low-level helper としても利用できます。

## 4. Human Task lifecycle

Human Task の通常経路は次です。

```text
ready -> claimTask -> active -> completeHumanTask -> completed
                    \-> releaseTask -> ready
```

- `claimTask()` は Human Execution を新しく作ります。
- `releaseTask()` は現在の Human Execution を再利用せず cancel し、Task を ready に戻します。
- 再 claim 時は新しい Execution が作られます。
- `allowedOutcomes` が指定された Task では `completeHumanTask()` に許可された outcome が必要です。

実行時 `taskId` を consumer 側で組み立てず、`getSessionView().tasks` から取得することを推奨します。

## 5. Agent integration

### `AgentAdapter`

**種別:** interface  
**用途:** Integration use

```ts
interface AgentAdapter {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  cancel(executionId: string): Promise<{ confirmed: boolean }>;
  forceKill?(executionId: string): Promise<void>;
}
```

`run()` へ渡される `AgentRunRequest` には `TaskRuntime`、`ExecutionRuntime`、Worker 選択時に作られた `ExecutionGrant` が含まれます。

`AgentRunResult.status` は `succeeded | failed | cancelled | abandoned` です。`artifacts` に `ProducedArtifact[]` を返すと ArtifactStore へ materialise され、ArtifactVersion と provenance が Registry に記録されます。

### `WorkerProfile`

Agent Task の routing 対象です。runtime は次の順で候補を絞ります。

1. `enabled === true`
2. Task の `requiredCapabilities` をすべて持つ
3. Task の `requestedPermissions` をすべて enforce できる
4. `maxWallTimeMs` 以外の指定 budget を `enforceableBudgets` で扱える
5. `routingPriority`、次に `workerId` で deterministic に選択

`physicalAvailable: false` の Worker が選ばれた場合、in-process runtime は physical worker unavailable として Agent Execution を失敗させます。

### `FakeAgentAdapter`

**用途:** test / acceptance semantics

`plan(taskId, ...plans)` で deterministic result を設定できます。plan がない Task には既定の successful result を返します。そのため実運用の設定漏れ検出には向きません。

### `CodexAdapter` / `createCodexCliAdapter()`

`CodexAdapter` は任意 runner を `AgentAdapter` に包む class です。Codex CLI を直接起動する場合は `createCodexCliAdapter(options)` を優先してください。

主な `CodexCliAdapterOptions`:

| option | 説明 |
| --- | --- |
| `executable` | 未指定時は PATH 上の `codex`。 |
| `cwd` | CLI working directory。 |
| `model` | Codex model option。 |
| `sandbox` | `read-only` / `workspace-write` / `danger-full-access`。既定は `read-only`。 |
| `extraArgs` | CLI へ追加する argument。 |
| `env` | child process environment。 |
| `maxOutputBytes` | stdout/stderr の保持上限。既定 1,000,000 bytes。 |
| `killGraceMs` | cancellation 後に SIGKILL へ進む grace。既定 5,000 ms。 |
| `promptBuilder` | AgentRunRequest から CLI prompt を構築する callback。 |

## 6. Persistence

### `Registry`

**種別:** class  
**用途:** Integration use

```ts
new Registry(path = ":memory:", options: RegistryOptions = {})
```

`RegistryOptions` は現在 `readOnly?: boolean` を持ちます。

主要 method:

| method | 説明 |
| --- | --- |
| `Registry.openReadOnly(path)` | SQLite file を read-only で開く。 |
| `migrate()` | schema migration を適用する。通常 constructor が実行する。 |
| `close()` | SQLite connection を閉じる。 |
| `registerDefinition(definition)` | hash 済み WorkDefinition を登録する。revision は immutable。通常は `WorkOrchestrator.registerDefinition()` を優先。 |
| `getDefinition(id, revision)` | 登録 definition を取得。 |
| `getRuntimeState(sessionId)` | persisted `RuntimeState` snapshot を取得。 |
| `getSessionProjection(sessionId)` | session row の要約 projection を取得。 |
| `getDomainCommits(sessionId)` | revision 順の Domain commit を取得。 |
| `getReceipt(sessionId, commandId)` | idempotency command receipt を取得。 |
| `commit(...)` | reducer の `Reduction` を receipt/commit/projection として原子的に反映する low-level writer API。通常は Orchestrator/Activity 経路を優先。 |
| `listTables()` | schema inspection / test 用。 |
| `query(sql, ...params)` | arbitrary read query 用 low-level helper。 |

`db` property も public ですが、直接 SQL mutation は `commit()` が維持する receipt/revision/projection の整合経路を迂回します。通常の Domain mutation には使用しないでください。

SQLite Registry の運用前提は single writer host です。

### `ArtifactStore`

**種別:** class  
**用途:** Integration use

content-addressed immutable blob store です。ArtifactVersion の metadata/provenance は Registry 側が保持します。

主要 method:

| method | 説明 |
| --- | --- |
| `stage(content, mediaType?)` | bytes を staging に書き、`StagedBlob` を返す。 |
| `finalize(stage)` | digest/size を検証し blob store へ atomic に移動する。 |
| `hasBlob(blobHash)` | blob の存在確認。 |
| `read(blobHash)` | blob bytes を `Buffer` で取得。 |
| `gcOrphans(gracePeriodMs?, now?)` | staging orphan を grace period 後に削除する。 |
| `blobPath(blobHash)` | valid SHA-256 hash の保存 path を返す。 |

既定 root は OS temporary directory 配下に生成されます。永続利用では root を明示してください。

## 7. Validation / canonical helpers

### `validateAndHashDefinition()`

WorkDefinition の構造、ID、binding、contract、schema、dynamic expansion 制約などを検証し、canonical hash を付加した `ValidatedDefinition` を返します。無効な Definition では `DomainError("DEFINITION_INVALID", ...)` を投げます。

### `findStep()`

Definition tree から `id` の一致する Step を探索します。

### `definitionWithoutHash()` / `definitionCanonicalJson()`

Definition hash を除いた JSON value / canonical JSON を得る low-level helper です。

### canonical helpers

| function | 説明 |
| --- | --- |
| `canonicalJson(value)` | deterministic canonical JSON string を返す。 |
| `sha256(value)` | string/bytes の SHA-256 hex digest。 |
| `hashJson(value)` | canonical JSON を SHA-256 hash。 |
| `cloneJson(value)` | JSON value の clone。 |
| `jsonPointer(value, pointer)` | JSON Pointer を解決。 |
| `isValidJsonPointer(pointer)` | JSON Pointer syntax の妥当性確認。 |

## 8. Temporal integration

### 推奨 facade

通常の Temporal 連携では、raw Workflow primitive を直接使うより次の facade を優先します。

#### `createWorkOrchestratorWorker(options)`

`workSessionWorkflow` と Registry/Agent Activities を登録した `@temporalio/worker` の `Worker` を生成します。

`WorkOrchestratorWorkerOptions` は `WorkerOptions` から `activities` / `workflowsPath` を除いた項目に加え、次を持ちます。

- `runtime?: TemporalWorkerRuntimeOptions`
- `workflowsPath?: string`

通常は package 内の `temporal-workflow.js` が `workflowsPath` に使われます。

#### `runWorkOrchestratorWorker(options)`

Worker を生成して `worker.run()` する convenience function です。

#### `connectWorkOrchestratorClient(options)`

Temporal `Connection` を接続し、`WorkOrchestratorTemporalClient` を返します。

`ConnectWorkOrchestratorClientOptions`:

- `connection?: Connection`
- `connectionOptions?: ConnectionOptions`
- `namespace?: string`
- `taskQueue: string`

#### `WorkOrchestratorTemporalClient`

主要 method:

| method | 説明 |
| --- | --- |
| `start(input)` | `sessionId` を Workflow ID として `workSessionWorkflow` を開始する。 |
| `claimTask(handle, input)` | claim Update を送る。 |
| `releaseTask(handle, input)` | release Update を送る。 |
| `completeHumanTask(handle, input)` | Human completion Update を送る。 |
| `resumeAgentTask(handle, input)` | Agent manual retry Update を送る。 |
| `cancelSession(handle, input)` | cancellation Update を送る。 |
| `receiveExternalEvent(handle, input)` | external event Update を送る。 |

### `TemporalWorkflowInput`

| field | 説明 |
| --- | --- |
| `sessionId` | Workflow ID と同じ値を使う。 |
| `workDefinitionId` | Registry に登録済み Definition ID。 |
| `revision` | Definition revision。 |
| `input` | Session input。 |
| `actor` | start actor。 |
| `registryTaskQueue` | Registry Activity queue。未指定時は Client/Workflow の task queue。 |
| `agentTaskQueue` | Agent Activity queue。未指定時は Client/Workflow の task queue。 |
| `agentScheduleToStartTimeoutMs` | Agent Activity schedule-to-start timeout。未指定時 30 秒。 |
| `carriedState` | Continue-As-New 用 carried state。通常 consumer は直接設定しない。 |
| `executionChainNumber` | Workflow execution chain bookkeeping。通常 consumer は直接設定しない。 |

### `TemporalWorkerRuntimeOptions`

Worker Activity runtime の依存を設定します。

- `registryPath` / `registry`
- `artifactRoot` / `artifactStore`
- `workers`
- `agentAdapter`
- `cancellationGraceMs`
- `heartbeatIntervalMs`

`registry` / `artifactStore` を渡さない場合は path/root から生成されます。AgentAdapter を渡さない場合は `FakeAgentAdapter` が使われるため、Agent Task の実運用では明示設定してください。

### Raw Temporal primitive

次は root から export されていますが、主に高度な integration / test / SDK-level composition 向けです。

- `workSessionWorkflow`
- `claimTaskUpdate`, `releaseTaskUpdate`, `completeHumanTaskUpdate`
- `resumeAgentTaskUpdate`, `cancelSessionUpdate`, `receiveExternalEventUpdate`
- `runtimeStateQuery`
- `createTemporalActivities()`
- `TEMPORAL_ACTIVITY_DEFAULTS`

`TEMPORAL_ACTIVITY_DEFAULTS` は registry Activity start-to-close 30 秒、agent Activity start-to-close 30 秒、heartbeat timeout 10 秒、retry max attempts 1、cancellation grace 5 秒の既定値を含みます。

### `TemporalSessionRuntime`

Temporal SDK に依存しない Workflow ID / run chain / safe-point の契約模型です。実 Temporal Worker/Client の facade ではありません。`continueAsNew()` は `TemporalSafePoint` の全 mutation/activity/timer 条件が safe な場合だけ run number を進めます。

## 9. Low-level Domain / state machine API

### `createInitialRuntimeState()` / `reduceCommand()`

Domain reducer を直接組み込む場合の primitive です。

- `createInitialRuntimeState(definition, sessionId, input)` は revision 0 の初期 `RuntimeState` を生成します。
- `reduceCommand(state, envelope, context)` は state を受け取り、`ReductionAccepted | ReductionRejected` を返す pure Domain reducer です。
- `ReducerContext` は現在 `workers` を提供します。

通常 consumer は `WorkOrchestrator` を優先してください。reducer を直接使う場合、Registry receipt/commit、Artifact materialisation、Agent Activity の実行などは呼び出し側の責務になります。

### XState machines / transition helpers

`sessionMachine`, `taskMachine`, `executionMachine` はライフサイクル遷移を表す XState v5 machine です。

`transitionSession`, `transitionTask`, `transitionExecution` は現在 state と event から次 state を得ます。`canTransition*` は遷移可否を確認します。Domain reducer の内部意味論に近いため、通常の command 操作には `WorkOrchestrator` を使ってください。

## 10. Error / reconciliation types

### `DomainError`

`code: DomainErrorCode`、message、optional `details: JsonValue` を持つ domain error です。

主な code は command/state/task/worker/event/definition/artifact/idempotency/invariant error を表します。完全な union は export index の `DomainErrorCode` を参照してください。

### `ReconciliationResult`

`consistent | temporarily_lagging | invariant_violation | unknown` の status と、必要に応じて Registry/Temporal revision・state hash を持ちます。

## 11. Compatibility API

### `hello(name)`

旧スケルトン API の後方互換用です。

```ts
hello(name: string): string
```

Orchestration 機能の入口ではありません。

## 12. Complete root export index

以下は現在 `work-orchestrator` root entry point から到達できる named export の完全索引です。source 列は内部の分類用であり、subpath import を示しません。

### Contracts (`contracts.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `JsonPrimitive` | type | Data | JSON primitive union。 |
| `JsonValue` | type | Data | Domain で扱える JSON value。 |
| `WorkerKind` | type | Contracts | `human | agent`。 |
| `SessionState` | type | Runtime | Session lifecycle state。 |
| `TaskState` | type | Runtime | Task lifecycle state。 |
| `ExecutionState` | type | Runtime | Execution lifecycle state。 |
| `ScopeState` | type | Runtime | Scope lifecycle state。 |
| `WaitKind` | type | Runtime | `event | timer`。 |
| `RetryPolicy` | interface | Contracts | retry / manual retry policy。 |
| `TaskBudgets` | interface | Contracts | wall time / token / cost budget。 |
| `TaskContract` | interface | Definition | Task worker requirements と output/result contract。 |
| `InputBinding` | interface | Definition | session/step result からの input binding。 |
| `TaskStep` | interface | Definition | task Step。 |
| `SequenceStep` | interface | Definition | sequential Step。 |
| `ChoiceStep` | interface | Definition | decision/branch Step。 |
| `ParallelAllStep` | interface | Definition | parallel-all Step。 |
| `WaitEventStep` | interface | Definition | external-event wait Step。 |
| `WaitTimerStep` | interface | Definition | timer wait Step。 |
| `DynamicProposalPolicy` | interface | Definition | dynamic generated Task の policy。 |
| `DynamicExpandStep` | interface | Definition | planner proposal から Task を生成する Step。 |
| `Step` | type | Definition | 全 Step の discriminated union。 |
| `WorkDefinition` | interface | Definition | versioned work graph definition。 |
| `ActorRef` | interface | Commands | command を実行する actor identity。 |
| `CommandEnvelope` | interface | Commands | idempotent Domain command envelope。 |
| `ExternalEvent` | interface | Events | waitEvent へ渡す external event。 |
| `WorkerProfile` | interface | Agent | Agent routing profile。 |
| `ExecutionGrant` | interface | Agent | 選択 Worker に与える capabilities/permissions/budgets。 |
| `ScopeRuntime` | interface | Runtime | runtime scope projection。 |
| `TaskRuntime` | interface | Runtime | runtime Task projection。 |
| `ExecutionRuntime` | interface | Runtime | runtime Execution projection。 |
| `WaitRuntime` | interface | Runtime | runtime wait projection。 |
| `BufferedEvent` | interface | Runtime | accepted/consumed metadata を持つ event。 |
| `ArtifactVersionRuntime` | interface | Artifact | ArtifactVersion runtime metadata。 |
| `RuntimeState` | interface | Runtime | Session の complete Domain state snapshot。 |
| `TaskProposal` | interface | Dynamic | dynamicExpand planner proposal。 |
| `ProducedArtifact` | interface | Artifact | Agent が返す artifact bytes + metadata。 |
| `AgentRunRequest` | interface | Agent | Adapter `run()` input。 |
| `AgentRunResult` | interface | Agent | Adapter execution result。 |
| `DomainCommand` | type | Commands | reducer が受け付ける command union。 |
| `DomainErrorCode` | type | Errors | domain error code union。 |
| `DomainError` | class | Errors | code/details を持つ domain Error。 |
| `DomainFact` | interface | Audit | accepted reduction が生成する fact。 |
| `DomainCommit` | interface | Audit | Registry audit commit。 |
| `RuntimeIntent` | type | Runtime | reducer が要求する Agent/timer side-effect。 |
| `ReductionAccepted` | interface | Reducer | accepted reduction。 |
| `ReductionRejected` | interface | Reducer | rejected reduction。 |
| `Reduction` | type | Reducer | reducer result union。 |
| `ReconciliationResult` | interface | Runtime | Registry/state consistency result。 |

### Canonical helpers (`canonical.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `canonicalJson` | function | Canonical | deterministic JSON serialization。 |
| `sha256` | function | Canonical | SHA-256 digest。 |
| `hashJson` | function | Canonical | canonical JSON hash。 |
| `cloneJson` | function | Canonical | JSON-safe clone。 |
| `jsonPointer` | function | Binding | JSON Pointer lookup。 |
| `isValidJsonPointer` | function | Binding | JSON Pointer syntax check。 |

### Validation (`validation.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `ValidatedDefinition` | interface | Definition | `definitionHash` が必須になった WorkDefinition。 |
| `validateAndHashDefinition` | function | Definition | Definition validation + canonical hash。 |
| `findStep` | function | Definition | Step ID lookup。 |
| `definitionWithoutHash` | function | Definition | hash 対象用に `definitionHash` を除去。 |
| `definitionCanonicalJson` | function | Definition | Definition の canonical JSON。 |

### State machines (`machines.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `sessionMachine` | const | Low-level | Session lifecycle XState machine。 |
| `taskMachine` | const | Low-level | Task lifecycle XState machine。 |
| `executionMachine` | const | Low-level | Execution lifecycle XState machine。 |
| `transitionSession` | function | Low-level | typed Session transition。 |
| `transitionTask` | function | Low-level | typed Task transition。 |
| `transitionExecution` | function | Low-level | typed Execution transition。 |
| `canTransitionSession` | function | Low-level | Session transition availability。 |
| `canTransitionTask` | function | Low-level | Task transition availability。 |
| `canTransitionExecution` | function | Low-level | Execution transition availability。 |

### Artifact store (`artifact-store.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `StagedBlob` | interface | Artifact | staged bytes の hash/size/path metadata。 |
| `ArtifactStore` | class | Artifact | content-addressed immutable blob store。 |

### Registry (`registry.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `CommitResult` | interface | Registry | Registry commit response/duplicate/revision。 |
| `RegistryOptions` | interface | Registry | read-only option。 |
| `Registry` | class | Registry | SQLite definition/state/audit/projection store。 |

### Domain reducer (`domain.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `ReducerContext` | interface | Reducer | reducer worker context。 |
| `createInitialRuntimeState` | function | Reducer | initial RuntimeState constructor。 |
| `reduceCommand` | function | Reducer | pure Domain command reducer。 |

### In-process runtime / Agent (`runtime.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `AgentAdapter` | interface | Agent | Agent execution/cancellation boundary。 |
| `FakeAgentPlan` | interface | Test | Fake adapter deterministic plan。 |
| `FakeAgentAdapter` | class | Test | acceptance semantics 用 AgentAdapter。 |
| `CodexAdapter` | class | Agent | runner function を包む cancellable Adapter。 |
| `CodexCliAdapterOptions` | interface | Agent | Codex CLI Adapter options。 |
| `createCodexCliAdapter` | function | Agent | Codex CLI-backed Adapter factory。 |
| `StartSessionInput` | interface | Runtime | in-process Session start input。 |
| `OrchestratorOptions` | interface | Runtime | WorkOrchestrator dependencies/options。 |
| `TemporalSafePoint` | interface | Low-level | Continue-As-New safe-point conditions。 |
| `TemporalSessionRuntime` | class | Low-level | SDK 非依存 Temporal contract model。 |
| `WorkOrchestrator` | class | Runtime | in-process orchestration facade。 |

### Temporal contracts (`temporal-contracts.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `TemporalWorkflowInput` | interface | Temporal | Workflow start/carried-state input。 |
| `TemporalWorkflowResult` | interface | Temporal | Workflow terminal result。 |
| `TemporalCommitInput` | interface | Temporal | Registry commit Activity input。 |
| `TemporalStartSessionInput` | interface | Temporal | Session initialization Activity input。 |
| `TemporalAgentResultInput` | interface | Temporal | Agent result commit Activity input。 |
| `TemporalCommitResult` | interface | Temporal | Activity commit result + state/intents。 |
| `TemporalActivities` | interface | Temporal | Workflow が呼ぶ Activity contract。 |
| `TemporalWorkerRuntimeOptions` | interface | Temporal | Registry/Artifact/Agent runtime dependencies。 |
| `TemporalCommandUpdateInput` | interface | Temporal | Update 共通 actor/commandId。 |
| `ClaimTaskUpdateInput` | interface | Temporal | claim Update input。 |
| `ReleaseTaskUpdateInput` | interface | Temporal | release Update input。 |
| `CompleteHumanTaskUpdateInput` | interface | Temporal | Human completion Update input。 |
| `ResumeAgentTaskUpdateInput` | interface | Temporal | Agent resume Update input。 |
| `CancelSessionUpdateInput` | interface | Temporal | cancellation Update input。 |
| `ReceiveExternalEventUpdateInput` | interface | Temporal | external event Update input。 |
| `TemporalPublicUpdateInput` | type | Temporal | public Update input union。 |

### Temporal Workflow (`temporal-workflow.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `claimTaskUpdate` | const | Temporal primitive | Temporal Update definition。 |
| `releaseTaskUpdate` | const | Temporal primitive | Temporal Update definition。 |
| `completeHumanTaskUpdate` | const | Temporal primitive | Temporal Update definition。 |
| `resumeAgentTaskUpdate` | const | Temporal primitive | Temporal Update definition。 |
| `cancelSessionUpdate` | const | Temporal primitive | Temporal Update definition。 |
| `receiveExternalEventUpdate` | const | Temporal primitive | Temporal Update definition。 |
| `runtimeStateQuery` | const | Temporal primitive | raw RuntimeState query definition。 |
| `workSessionWorkflow` | async function | Temporal primitive | WorkSession Temporal Workflow implementation。 |

### Temporal Activities (`temporal-activities.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `TEMPORAL_ACTIVITY_DEFAULTS` | const | Temporal | Activity timeout/retry/cancellation defaults。 |
| `createTemporalActivities` | function | Temporal primitive | Registry/Agent Activity implementation factory。 |

### Temporal Worker (`temporal-worker.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `WorkOrchestratorWorkerOptions` | interface | Temporal | WorkerOptions + runtime/workflowsPath。 |
| `createWorkOrchestratorWorker` | async function | Temporal | configured Temporal Worker factory。 |
| `runWorkOrchestratorWorker` | async function | Temporal | create + run convenience function。 |

### Temporal Client (`temporal-client.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `WorkOrchestratorClientOptions` | interface | Temporal | existing Temporal Client + taskQueue。 |
| `ConnectWorkOrchestratorClientOptions` | interface | Temporal | Connection/namespace/taskQueue options。 |
| `WorkOrchestratorTemporalClient` | class | Temporal | Workflow start / Update facade。 |
| `connectWorkOrchestratorClient` | async function | Temporal | Connection + Client facade factory。 |

### Compatibility (`index.ts`)

| Name | Kind | Area | Purpose |
| --- | --- | --- | --- |
| `hello` | function | Compatibility | 旧スケルトン API の後方互換。 |
