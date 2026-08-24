# Run and Publication Contract

## Concurrency

optimistic concurrencyを採用する。各runは `base_run_id` と `base_registry_content_sha256` にbindingする。

publication直前にcurrent parent/hashを再確認し、不一致なら `STALE_PARENT`。自動rebase/mergeは禁止。

同一parentから複数runが承認されても、最初にpublicationに成功したrunだけが勝つ。後続runは新しいcurrentから作り直す。

上流により新しいdatasetが公開されても、in-flight runは自動staleにしない。runはbindingされたdataset SHAに対して正当である。ただし新datasetをcurrentへ公開する場合は `full_update` が必要。

## Atomic publication

review完了後、publication transactionで `published_at` を一度だけUTC秒精度で確定する。この同一値をfirst publication更新、manifest、meta等へ使う。

stagingで全artifact生成・validation後にsingle-writer critical sectionでpromoteする。途中失敗時はcurrent registry/current candidates/current metaを変更しない。

## NEW

- `introduced_at` = candidateが初めてcurrent published listへpromoteされた`published_at`。
- legacy候補は `published_at_unknown`, `introduced_at=null` とし、NEWにしない。
- update、metric変更、variants変更、category変更、retire/reactivateではintroduced_atを更新しない。
- UIは `introduced_at != null AND now < introduced_at + new_keyword_display_days * 24h` で判定。
- `is_new` booleanをJSONへ保存しない。

## Registry reconstruction

過去registryはbootstrap stateからpublished `candidate_change_set` をparent順に適用して再構成する。first-publication historyは各runのevaluation結果とmanifest `published_at` を使って更新する。

- `add`時: `created_at = last_changed_at = run.published_at`。D>=1なら同時に`published_at_known`/`introduced_at`、D=0なら`never_published`/null。
- update/retire/reactivate時: semantic stateが変わるため`last_changed_at = run.published_at`。`created_at`と既存introduced_atは保持。
- `local_rebuild`: status/keyword/variants/category_id/created_at/last_changed_atは変更しない。ただし`never_published` active candidateが新policy/evaluatorで初めてD>=1になった場合だけfirst-publication historyを`published_at_known`へ進められる。
- `published_at_unknown` legacy candidateのintroduced_atは将来もnullのまま保持し、reactivate等でNEWにしない。
