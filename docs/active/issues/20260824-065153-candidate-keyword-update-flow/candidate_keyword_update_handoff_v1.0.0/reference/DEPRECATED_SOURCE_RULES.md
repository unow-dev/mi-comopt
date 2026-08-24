# Deprecated / Historical Rules

`keyword_filter_handoff (2)` に含まれていた以下はproduction仕様として廃止する。

- `generate_candidates.py` によるcandidate generation
- curated seedによる候補発見
- direct_nuisanceからのcharacter n-gram mining
- `seed_keywords.json` をgeneration source of truthとすること
- `source = curated_seed / mined_ngram`
- local semantic noise suppression
- 「同じdatasetから同じcandidate集合を生成する」というlocal generation再現性要件

救出して現行仕様へ移したもの:

- normalization
- normalized substring matching
- variants OR
- comment単位hit
- D/R/N
- reactive neutrality
- precision / direct recall / normal hit rate / utility
- recommendation thresholdの評価思想

historical evaluation snapshotは説明/reference用途のみで、current acceptance criteriaではない。
