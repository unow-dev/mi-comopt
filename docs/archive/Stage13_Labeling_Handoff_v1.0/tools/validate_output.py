#!/usr/bin/env python3
import argparse, json, hashlib
from collections import defaultdict
FIELDS=("username","handle","comment","postedAt","postedDate")
EXPECTED=set(FIELDS)|{'label'}
def load(p):
    with open(p,encoding='utf-8') as f:return json.load(f)
def sha256(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def key(r):return tuple(r.get(f) for f in FIELDS)
def main():
    ap=argparse.ArgumentParser(description='Validate Stage 13 labeled output')
    ap.add_argument('--input',required=True); ap.add_argument('--output',required=True); ap.add_argument('--reference')
    ap.add_argument('--report')
    a=ap.parse_args(); inp=load(a.input); out=load(a.output)
    checks={}
    checks['input_count_equals_output_count']=len(inp)==len(out)
    checks['all_records_have_label']=all(isinstance(r,dict) and 'label' in r for r in out)
    checks['label_enum_valid']=all(r.get('label') in ('normal','nuisance') for r in out if isinstance(r,dict))
    checks['existing_5_fields_exact_match']=len(inp)==len(out) and all(all(inp[i].get(f)==out[i].get(f) for f in FIELDS) for i in range(len(inp)))
    checks['input_order_preserved']=checks['existing_5_fields_exact_match']
    checks['only_expected_fields']=all(set(r.keys())==EXPECTED for r in out if isinstance(r,dict))
    counts={'normal':sum(r.get('label')=='normal' for r in out if isinstance(r,dict)),'nuisance':sum(r.get('label')=='nuisance' for r in out if isinstance(r,dict))}
    ref_matches=0; ref_mismatch=[]; ref_conflicting_keys=0
    if a.reference:
        ref=load(a.reference); m=defaultdict(set)
        for r in ref:
            if r.get('label') in ('normal','nuisance'):m[key(r)].add(r['label'])
        ref_conflicting_keys=sum(len(v)>1 for v in m.values())
        for i,r in enumerate(out,1):
            labs=m.get(key(r),set())
            if len(labs)==1:
                ref_matches+=1
                exp=next(iter(labs))
                if r.get('label')!=exp:ref_mismatch.append({'record_index_1_based':i,'expected':exp,'actual':r.get('label')})
        checks['reference_exact_match_labels_preserved']=len(ref_mismatch)==0
    report={'input_records':len(inp),'output_records':len(out),'label_counts':counts,'checks':checks,
            'reference_exact_matches':ref_matches,'reference_label_mismatches':ref_mismatch[:100],
            'reference_conflicting_exact_keys':ref_conflicting_keys,'input_sha256':sha256(a.input),'output_sha256':sha256(a.output)}
    report['all_checks_passed']=all(checks.values())
    s=json.dumps(report,ensure_ascii=False,indent=2); print(s)
    if a.report:
        with open(a.report,'w',encoding='utf-8') as f:f.write(s+'\n')
    raise SystemExit(0 if report['all_checks_passed'] else 1)
if __name__=='__main__':main()
