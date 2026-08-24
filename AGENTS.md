# Agents

## Communication
- エージェントによる返答は常に日本語で行うこと。

## Documentation Policy
- `docs/archive` 配下の文書は参照しないこと。

## Operation Safety
- ユーザーから明示的に指示されていない書き込み（新規作成・更新・削除・移動・リネーム）を行わないこと。
- 破壊的作業（ファイル削除、履歴改変、`git reset --hard` 等）は、ユーザーの明示的な指示がある場合にのみ実行すること。


## Work Task Sequence

When describing work for agents, prefer a work task sequence instead of a traditional issue-style description.

A work task sequence should contain only:

* Purpose
* Task sequence
* Work notes

Do not mix background discussion, implementation proposals, progress comments, or unresolved conversation into the task sequence itself.

### Purpose

Write the purpose as the state the work should achieve.

```markdown
## Purpose

{State the desired outcome}
```

The purpose must describe what should be achieved, not how it should be implemented.

### Task Sequence

Write tasks as an ordered checklist.

Each task must use the following form:

```text
- [ ] {number}. {work area}で、{worker}が、{work action}を行う。
```

Examples:

```markdown
- [ ] 1. 要求整理の範囲で、AIエージェントが、決定済み事項と未決事項を分離する。
- [ ] 2. 未決事項の範囲で、人間が、必要な仕様判断を行う。
- [ ] 3. 既存実装の範囲で、AIエージェントが、現在の仕組みを確認する。
- [ ] 4. 仕様整理の範囲で、AIエージェントが、実装前に満たすべき条件を整理する。
- [ ] 5. 必要最小限の変更範囲で、AIエージェントが、目的を満たす変更を行う。
- [ ] 6. 検証範囲で、AIエージェントまたはCIが、変更結果を確認する。
- [ ] 7. 作業結果の範囲で、AIエージェントが、実施内容と確認結果を記録する。
```

Completed tasks may be marked with `[x]`.

```markdown
- [x] 1. 要求整理の範囲で、AIエージェントが、決定済み事項と未決事項を分離する。
```

### Work Notes

Add one work notes section below the task sequence.

Work notes belong to the entire task sequence, not to individual tasks.

Use work notes for temporary findings, decisions, open questions, validation results, references, or implementation notes that arise while performing the task sequence.

Do not scatter progress comments across individual tasks.
Keep the task sequence itself clean and use the work notes section for details.

```markdown
## Work Notes

- {note}
- {note}
- {note}
```

### Work Area

The work area defines the target area, investigation scope, decision scope, or verification scope.

Good examples:

```text
要求整理の範囲で
未決事項の範囲で
既存実装の範囲で
仕様整理の範囲で
必要最小限の変更範囲で
検証範囲で
変更結果の範囲で
作業結果の範囲で
```

Avoid work areas that are too broad or vague.

Bad examples:

```text
関連範囲で
コード全体で
適当な場所で
いい感じに
```

Do not overfit the work area to a specific file, function, API, component, or database schema unless that is a true constraint.

### Worker

The worker is the primary actor responsible for the task.

Allowed examples:

```text
AIエージェント
人間
CI
レビュアー
外部システム
```

Assign tasks that require judgment, approval, prioritization, risk acceptance, or stakeholder coordination to a human.

Do not assign work to an AI agent when the work is impossible or inappropriate for the agent.

### Work Action

The work action must describe the work to be performed, not the implementation method.

Good examples:

```text
確認する
調査する
整理する
抽出する
列挙する
特定する
判断する
決定する
変更する
検証する
記録する
報告する
承認する
```

Avoid implementation-specific instructions such as:

```text
ProfileForm.tsx に input を追加する。
PATCH /api/profile を呼び出す。
users テーブルに display_name カラムを追加する。
```

Implementation details should be determined during the relevant task unless they are true constraints.

### Nesting

Tasks may be nested when a lower level of abstraction is needed.

Tasks at the same level must have the same abstraction level.

Use Markdown checklist nesting for nested tasks.

Good example:

```markdown
- [ ] 1. 既存実装の範囲で、AIエージェントが、現在の仕組みを確認する。
  - [ ] 1.1 既存の表示処理の範囲で、AIエージェントが、表示名がどこで利用されているかを確認する。
  - [ ] 1.2 既存の更新処理の範囲で、AIエージェントが、ユーザー情報の変更方法を確認する。
  - [ ] 1.3 既存の検証処理の範囲で、AIエージェントが、関連する検証方法を確認する。
```

Do not place detailed implementation tasks next to high-level investigation, design, or verification tasks.

Use nesting only to clarify work decomposition.
Do not use nesting to recreate a complex issue hierarchy.

### Specification Work

Specification design is also work.

Do not assume that specifications, acceptance criteria, or implementation conditions are already complete.

When needed, include tasks for specification work:

```markdown
- [ ] 1. 要求整理の範囲で、AIエージェントが、決定済み事項と未決事項を分離する。
- [ ] 2. 未決事項の範囲で、人間が、必要な仕様判断を行う。
- [ ] 3. 仕様整理の範囲で、AIエージェントが、実装前に満たすべき条件を整理する。
```

### Minimal Template

```markdown
# Work Task Sequence: {name}

## Purpose

{State the desired outcome}

## Task Sequence

- [ ] 1. {work area}で、{worker}が、{work action}を行う。
- [ ] 2. {work area}で、{worker}が、{work action}を行う。
- [ ] 3. {work area}で、{worker}が、{work action}を行う。

## Work Notes

- 
```

### Prohibited

Do not:

* Mix background discussion, implementation proposals, progress comments, or unresolved conversation into the task sequence itself.
* Create separate work notes areas for individual tasks.
* Mix different abstraction levels in the same task level.
* Assign inappropriate judgment tasks to an AI agent.
* Fix implementation methods in the task sequence.
* Use work areas that are too broad.
* Nest tasks so deeply that the sequence becomes a substitute for an issue hierarchy.
