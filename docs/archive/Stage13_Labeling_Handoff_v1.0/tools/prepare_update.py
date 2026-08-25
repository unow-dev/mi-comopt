#!/usr/bin/env python3
import argparse, json, hashlib
from pathlib import Path
from collections import defaultdict

FIELDS=("username","handle","comment","postedAt","postedDate")

def key(r): return tuple(r.get(f) for f in FIELDS)
def hc_key(r): return (r.get("handle"), r.get("comment"))

def load(path):
    with open(path,encoding="utf-8") as f: x=json.load(f)
    if not isinstance(x,list): raise SystemExit(f"{path}: top-level must be a JSON array")
    for i,r in enumerate(x,1):
        if not isinstance(r,dict): raise SystemExit(f"{path}: record {i} is not an object")
        miss=[f for f in FIELDS if f not in r]
        if miss: raise SystemExit(f"{path}: record {i} missing {miss}")
    return x

def main():
    ap=argparse.ArgumentParser(description="Prepare a Stage 13 update labeling workspace")
    ap.add_argument("--input",required=True)
    ap.add_argument("--reference",required=True)
    ap.add_argument("--outdir",required=True)
    ap.add_argument("--batch-size",type=int,default=500)
    a=ap.parse_args()
    new=load(a.input); ref=load(a.reference)
    out=Path(a.outdir); out.mkdir(parents=True,exist_ok=True)
    (out/'pending_batches').mkdir(exist_ok=True)

    exact=defaultdict(set); hc=defaultdict(list); by_handle=defaultdict(list)
    for i,r in enumerate(ref,1):
        lab=r.get('label')
        if lab not in ('normal','nuisance'): continue
        exact[key(r)].add(lab)
        hc[hc_key(r)].append({'reference_index_1_based':i,'label':lab,'postedDate':r.get('postedDate')})
        by_handle[r.get('handle')].append({'reference_index_1_based':i,'comment':r.get('comment'),'postedDate':r.get('postedDate'),'label':lab})

    reused=[]; pending=[]; conflicts=[]; similar=[]
    for i,r in enumerate(new,1):
        labs=exact.get(key(r),set())
        if len(labs)==1:
            reused.append({'source_index_1_based':i,'label':next(iter(labs))})
        elif len(labs)>1:
            conflicts.append({'source_index_1_based':i,'record':r,'reference_labels':sorted(labs)})
            pending.append({'source_index_1_based':i,'record':r})
        else:
            pending.append({'source_index_1_based':i,'record':r})
            m=hc.get(hc_key(r),[])
            if m: similar.append({'source_index_1_based':i,'record':r,'same_handle_comment_reference':m})

    for b,start in enumerate(range(0,len(pending),a.batch_size),1):
        rows=pending[start:start+a.batch_size]
        with open(out/'pending_batches'/f'batch_{b:03d}.json','w',encoding='utf-8') as f:
            json.dump(rows,f,ensure_ascii=False,indent=2)

    pending_handles=sorted({x['record']['handle'] for x in pending})
    contexts={h:by_handle.get(h,[]) for h in pending_handles if by_handle.get(h)}
    with open(out/'exact_reuse.json','w',encoding='utf-8') as f: json.dump(reused,f,ensure_ascii=False,indent=2)
    with open(out/'similar_reference_hints.json','w',encoding='utf-8') as f: json.dump(similar,f,ensure_ascii=False,indent=2)
    with open(out/'pending_handle_history_from_reference.json','w',encoding='utf-8') as f: json.dump(contexts,f,ensure_ascii=False,indent=2)
    with open(out/'reference_conflicts.json','w',encoding='utf-8') as f: json.dump(conflicts,f,ensure_ascii=False,indent=2)

    report={
      'input_records':len(new),'reference_records':len(ref),'batch_size':a.batch_size,
      'exact_reuse_records':len(reused),'pending_records':len(pending),
      'pending_batch_count':(len(pending)+a.batch_size-1)//a.batch_size,
      'same_handle_comment_reference_hints':len(similar),'exact_reference_conflicts':len(conflicts),
      'note':'Exact 5-field matches may be fixed to prior labels. Same handle+comment matches are hints only.'
    }
    with open(out/'prepare_report.json','w',encoding='utf-8') as f: json.dump(report,f,ensure_ascii=False,indent=2)
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
