# Work Orchestrator v1

Work Orchestrator は、`WorkDefinition` を実行可能な Task / Execution / Wait に展開し、Human Task、Agent Task、外部イベント、timer、成果物、監査履歴を一つの実行モデルで扱う Node.js パッケージです。

このガイドは、リポジトリ内のローカルパッケージを別の作業環境へ導入し、最小の Human Task を完了させるところから、永続化・Agent・Temporal 連携へ進むための導入手順です。個々の型・関数・クラスの詳細は [API_REFERENCE.md](./API_REFERENCE.md) を参照してください。

## 1. 前提

このリポジトリの workspace は Node.js `>=24 <25` で build/test する設定です。これは現リポジトリの検証環境を示すもので、`work-orchestrator` パッケージ単体の Node.js 互換性保証を追加するものではありません。

パッケージは ESM です。以下の Quickstart は `.mjs` を使うため、consumer 側の `package.json` に `"type": "module"` を追加する必要はありません。

## 2. ローカルパッケージを build する

実リポジトリの root で依存関係を導入し、package workspace を build します。

```bash
npm install
npm run build
```

build 後、`package/dist/` に JavaScript と型宣言が生成されます。

## 3. 別の作業環境へ導入する

空の consumer directory を作り、build 済みのローカル package をインストールします。

```bash
mkdir work-orchestrator-consumer
cd work-orchestrator-consumer
npm init -y
npm install /absolute/path/to/repository/package --install-links
```

`--install-links` を使うことで、consumer 外部の directory を単なる symlink として参照するのではなく、ローカル package の内容を dependency として導入できます。package の配布境界を確認したい導入・検証ではこの方法を推奨します。

パッケージを編集しながら consumer から即座に変更を参照したい開発用途では、通常の folder install / symlink を使う選択肢もあります。ただし、その場合は packaged contents の不足を検出しにくくなります。

## 4. Quickstart: Human Task を完了する

consumer directory に `quickstart.mjs` を作成します。

```js
import assert from "node:assert/strict";
import { WorkOrchestrator } from "work-orchestrator";

const orchestrator = new WorkOrchestrator();

orchestrator.registerDefinition({
  workDefinitionId: "quickstart",
  revision: 0,
  schemaVersion: 1,
  root: {
    kind: "task",
    id: "review",
    goal: "Review the work",
    contract: {
      workerKind: "human",
      requiredCapabilities: [],
      requestedPermissions: [],
      retryPolicy: { maxAttempts: 1 },
      budgets: { maxWallTimeMs: 60_000 },
    },
  },
});

const sessionId = "quickstart-session";
const actor = { actorId: "local-user", actorType: "human" };

await orchestrator.startSession({
  sessionId,
  workDefinitionId: "quickstart",
});

const view = orchestrator.getSessionView(sessionId);
if (!view) throw new Error("session not found");

const task = Object.values(view.tasks)
  .find((candidate) => candidate.stepId === "review");
if (!task) throw new Error("review task not found");

await orchestrator.claimTask(sessionId, task.taskId, actor);
await orchestrator.completeHumanTask(sessionId, task.taskId, actor);

const finalView = orchestrator.getSessionView(sessionId);
assert.equal(finalView?.session.state, "completed");
console.log("completed");
```

実行します。

```bash
node quickstart.mjs
```

`completed` と表示されれば、次の基本サイクルが完了しています。

1. `WorkDefinition` を登録した。
2. Session を開始した。
3. Human Task が生成された。
4. actor が Task を claim した。
5. Human Task の完了によって root scope と Session が `completed` になった。

この例では生成された `taskId` を文字列として組み立てず、`getSessionView()` から取得しています。実行時 ID の生成規則を consumer 側の契約として扱わないためです。

### Quickstart の既定値

`new WorkOrchestrator()` は最小実行用の既定値を持ちます。

| 項目 | 既定値 | 注意 |
| --- | --- | --- |
| Registry | `:memory:` の SQLite | process 再起動をまたいで Session を保持しません。 |
| ArtifactStore | OS の temporary directory 配下 | 永続的な成果物保存先として扱わないでください。自動 cleanup を意味するものでもありません。 |
| AgentAdapter | `FakeAgentAdapter` | 意味論受入試験用です。実 Agent として扱わないでください。 |
| workers | 空 | Agent Task を実行するには適合する `WorkerProfile` が必要です。 |

Quickstart は Human Task のみを使うため、既定の `FakeAgentAdapter` は実行されません。**Agent Task を運用する場合は `AgentAdapter` と `WorkerProfile` を明示的に設定してください。**

## 5. 永続化する

process 再起動をまたいで Registry と Artifact bytes を保持する場合は、両方の保存先を明示します。

```js
import {
  ArtifactStore,
  Registry,
  WorkOrchestrator,
} from "work-orchestrator";

const registry = new Registry("./work-orchestrator.sqlite");
const artifactStore = new ArtifactStore("./work-orchestrator-artifacts");

try {
  const orchestrator = new WorkOrchestrator({
    registry,
    artifactStore,
  });

  // registerDefinition(), startSession(), ...
} finally {
  registry.close();
}
```

`Registry` は Session state、Domain commit、command receipt、Task / Execution projection などを SQLite に保持します。`ArtifactStore` は content-addressed な immutable blob bytes を保持し、ArtifactVersion の来歴は Registry 側が保持します。

呼び出し側が `Registry` を生成した場合、その resource を所有する呼び出し側が `close()` してください。`WorkOrchestrator` 自体には `close()` はありません。

`Registry("./dir/registry.sqlite")` のように存在しない親 directory を指定しても Registry は親 directory を作成しません。必要なら先に directory を作成してください。`ArtifactStore` は指定した root 配下に `blobs/` と `staging/` を作成します。

## 6. 実行基盤と運用上の前提

### SQLite Registry は single writer host 前提

Registry は SQLite を使用します。現行 v1 の運用前提は **単一 Registry writer host** です。Agent subprocess に Registry を直接開かせず、Domain mutation は Orchestrator / Temporal Activity の command processing 経路へ集約してください。

読み取り専用用途には `Registry.openReadOnly(path)` を利用できます。

### Registry と ArtifactStore は別の保存領域

Registry snapshot だけを永続化して ArtifactStore を temporary のまま運用すると、Registry 上の ArtifactVersion と blob bytes の寿命が一致しなくなります。Artifact を扱う運用では両方の保存先を設計してください。

### command ID と idempotency

`WorkOrchestrator` の高水準メソッドは既定 command ID を生成します。再送や外部 request ID と結びつける必要がある場合は各メソッドの `commandId` または `dispatch()` を利用できます。同一 command ID を異なる request payload で再利用すると idempotency conflict になります。

## 7. Agent Task を実行する

### 独自 AgentAdapter

Agent 実装の標準的な拡張点は `AgentAdapter` です。

```ts
interface AgentAdapter {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  cancel(executionId: string): Promise<{ confirmed: boolean }>;
  forceKill?(executionId: string): Promise<void>;
}
```

Agent Task を dispatch するには、Task contract を満たす `WorkerProfile` も必要です。

```js
import { WorkOrchestrator } from "work-orchestrator";

const orchestrator = new WorkOrchestrator({
  agentAdapter: myAgentAdapter,
  workers: [{
    workerId: "local-agent",
    revision: 1,
    enabled: true,
    capabilities: [],
    enforceablePermissions: [],
    enforceableBudgets: [],
    routingPriority: 1,
    physicalAvailable: true,
  }],
});
```

`FakeAgentAdapter` は deterministic な受入試験用です。plan がない場合でも成功結果を返すため、設定漏れを検出する実運用 Adapter としては使用しないでください。

### Codex CLI

Codex CLI を Agent として使う場合は `createCodexCliAdapter()` を利用できます。

```js
import { createCodexCliAdapter } from "work-orchestrator";

const agentAdapter = createCodexCliAdapter({
  sandbox: "read-only",
  cwd: process.cwd(),
});
```

この Adapter は CLI の JSONL 出力、`AbortSignal`、graceful cancellation、必要時の強制終了を Adapter 境界で処理します。実環境 smoke test は package 側の `npm run test:codex` です。

## 8. Local / in-process と Temporal-backed の選択

| 要件 | 推奨入口 |
| --- | --- |
| 単一 Node.js process 内で基本 orchestration を実行する | `WorkOrchestrator` |
| Session / Task / history を観測する | `getSessionView()` |
| 永続 SQLite / Artifact bytes を管理する | `Registry`, `ArtifactStore` |
| Agent 実装を差し替える | `AgentAdapter` |
| Temporal Server 上で durable Workflow と Worker を使う | `createWorkOrchestratorWorker()` + `WorkOrchestratorTemporalClient` |

`TemporalSessionRuntime` は Temporal SDK を使わない Workflow ID / execution chain / Continue-As-New の契約模型です。実 Temporal 接続の通常入口ではありません。

## 9. Temporal-backed execution

Temporal-backed mode では Temporal Server、Worker process、Client process が必要です。Workflow ID は `sessionId` と同じ値を使います。

### Worker 側

Registry に利用する definition を登録したうえで Worker を起動します。Registry writer を複数 host に分散させないでください。

```js
import {
  ArtifactStore,
  Registry,
  createWorkOrchestratorWorker,
  validateAndHashDefinition,
} from "work-orchestrator";

const registry = new Registry("./work-orchestrator.sqlite");
const artifactStore = new ArtifactStore("./work-orchestrator-artifacts");

registry.registerDefinition(validateAndHashDefinition(definition));

const worker = await createWorkOrchestratorWorker({
  taskQueue: "work-orchestrator",
  runtime: {
    registry,
    artifactStore,
    workers,
    agentAdapter,
  },
});

await worker.run();
```

`runWorkOrchestratorWorker()` は Worker の生成と `run()` をまとめる convenience function です。

### Client 側

```js
import { connectWorkOrchestratorClient } from "work-orchestrator";

const temporal = await connectWorkOrchestratorClient({
  taskQueue: "work-orchestrator",
});

const handle = await temporal.start({
  sessionId: "session-1",
  workDefinitionId: "example",
});
```

Human Task 操作や cancellation、external event は `WorkOrchestratorTemporalClient` の Update facade から送信します。

```js
await temporal.claimTask(handle, {
  taskId,
  actor: { actorId: "alice", actorType: "human" },
});

await temporal.completeHumanTask(handle, {
  taskId,
  actor: { actorId: "alice", actorType: "human" },
});
```

`TemporalWorkflowInput` では `registryTaskQueue`、`agentTaskQueue`、`agentScheduleToStartTimeoutMs` を必要に応じて指定できます。`agentScheduleToStartTimeoutMs` の既定値は 30 秒です。物理 Agent Worker が task queue を poll していない場合、schedule-to-start timeout は Execution failure として Domain へ反映されます。

raw Workflow Update definition、Activity factory、state query なども root entry point から export されていますが、通常の利用では Worker / Client facade を優先してください。詳細は [API_REFERENCE.md](./API_REFERENCE.md) を参照してください。

## 10. WorkDefinition の主な Step

`WorkDefinition.root` は次の `Step` のいずれかです。

| `kind` | 用途 |
| --- | --- |
| `task` | Human または Agent が処理する Task |
| `sequence` | child Step を順番に実行 |
| `choice` | decision Task の outcome に応じて branch を選択 |
| `parallelAll` | 全 branch を実行して全完了を待つ |
| `waitEvent` | `eventType` / `correlationKey` に一致する external event を待つ |
| `waitTimer` | 指定 `delayMs` の timer を待つ |
| `dynamicExpand` | planner の proposal から実行時 Task を生成 |

Definition は `registerDefinition()` で `validateAndHashDefinition()` 相当の検証・hashing を受けます。同じ `workDefinitionId` / `revision` に異なる definition hash を再登録することはできません。

## 11. よくある問題

### `Cannot find package 'work-orchestrator'`

consumer 側で local package がインストールされているか確認してください。package の `src/` や `dist/` を相対 path で直接 import するのではなく、`from "work-orchestrator"` を使用します。

### `dist/index.js` がない

consumer へ導入する前に repository root で package を build してください。

### Agent Task が期待せず成功する

`new WorkOrchestrator()` の既定 AgentAdapter は `FakeAgentAdapter` です。実 Agent を使う場合は `agentAdapter` と `workers` を明示してください。

### Agent Task が `NO_ELIGIBLE_WORKER` 相当になる

`WorkerProfile` の `enabled`、`capabilities`、`enforceablePermissions`、`enforceableBudgets` が Task contract を満たしているか確認してください。

### Temporal Workflow が Agent 実行待ちで失敗する

`agentTaskQueue` を poll する物理 Worker が存在するか、`agentScheduleToStartTimeoutMs` が適切か確認してください。

### 永続 Registry を開けない

SQLite file の親 directory が存在するか、書き込み権限があるか確認してください。

## 12. API Reference

公開されている型・関数・クラスの用途、主要 class の method、low-level primitive を含む root export の完全索引は [API_REFERENCE.md](./API_REFERENCE.md) にあります。

すべての通常 import は package root から行います。

```js
import {
  WorkOrchestrator,
  Registry,
  ArtifactStore,
} from "work-orchestrator";
```

`work-orchestrator/runtime` や `work-orchestrator/registry` のような subpath export は現在提供していません。
