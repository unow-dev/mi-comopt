# Artifact Matrix

| Artifact | bootstrap_migration | full_update | local_rebuild |
|---|---:|---:|---:|
| bootstrap_candidate_id_map.json | required | forbidden | forbidden |
| candidate_view.json | forbidden | required | forbidden |
| pre_evaluation.json | forbidden | required | forbidden |
| candidate_generation_request.json | forbidden | required | forbidden |
| candidate_proposal.json | forbidden | required | forbidden |
| candidate_change_set.json | forbidden | required | forbidden |
| candidate_evaluation.json | required | required | required |
| candidate semantic registry change | migration only | allowed | forbidden |
| first-publication history update | legacy initialization | allowed | allowed when a never-published active candidate first becomes eligible |
| current filterKeywordCandidates.json | required | required | required |
| current filterKeywordCandidates.meta.json | required | required | required |
| run_manifest.json | required | required | required |

`runs/<run_id>/` にはrun固有immutable artifactだけを置く。current `candidate_registry.json` とUI向けcurrent JSONの過去snapshotをrunごとに複製しない。

### full_update run directory

```text
runs/<run_id>/
├── candidate_view.json
├── pre_evaluation.json
├── candidate_generation_request.json
├── candidate_proposal.json
├── candidate_change_set.json
├── candidate_evaluation.json
└── run_manifest.json
```

run manifestはcurrent published JSONの `content_sha256` を記録するが、run directoryへpublished JSONを複製しない。過去published JSONは、該当runまで再構成したregistry + run evaluation + taxonomy + publication historyから再生成可能でなければならない。
