"""Release-ledger reconstruction over the NHTSA SGO ADS incident record.

Stage 1  dedupe      latest Report Version per Report ID, then Same Incident ID
Stage 2  canonicalise raw version strings -> canonical releases
Stage 3  timeline     first seen / crossover / last seen per release
Stage 4  outcomes     release-linked composition, only where N permits
"""
import csv, collections, re, math, hashlib, sys, os

# resolve beside this file so the package runs from any working directory
SRC=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ads.csv')
MONTHS={m:i+1 for i,m in enumerate(
    ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'])}
REDACTED='[REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION]'

def load():
    return list(csv.DictReader(open(SRC, encoding='utf-8-sig', errors='replace')))

def dedupe(rows):
    """Keep the highest Report Version per Report ID, then one row per incident."""
    best={}
    for r in rows:
        rid=r['Report ID'].strip()
        v=int(r['Report Version'].strip() or 1)
        if rid not in best or v>best[rid][0]: best[rid]=(v,r)
        
    by_rid=[r for _,r in best.values()]
    seen={}; out=[]
    for r in by_rid:
        sid=r['Same Incident ID'].strip() or ('RID:'+r['Report ID'].strip())
        if sid in seen: continue
        seen[sid]=r; out.append(r)
    return by_rid, out

def ym(r):
    m=re.match(r'^([A-Z]{3})-(\d{4})$',(r['Incident Date'] or '').strip().upper())
    return (int(m.group(2)),MONTHS[m.group(1)]) if m and m.group(1) in MONTHS else None

def strip_key(s):
    return re.sub(r'[^a-z0-9]','',s.lower())

def lev(a,b):
    if abs(len(a)-len(b))>3: return 99
    prev=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        cur=[i]
        for j,cb in enumerate(b,1):
            cur.append(min(prev[j]+1, cur[j-1]+1, prev[j-1]+(ca!=cb)))
        prev=cur
    return prev[-1]

def classify(s):
    s=s.strip()
    if s==REDACTED: return 'redacted'
    if not s: return 'blank'
    if s in {'-','--','N/A','NA','Unknown','unknown'}: return 'placeholder'
    if not re.search(r'\d', s): return 'no-version-token'
    return 'value'

def canonicalise(strings):
    """Stage A: merge strings identical after removing case and punctuation.

    This is formatting only and is always safe. Typos are NOT merged here --
    a one-character difference is exactly how a real version number differs
    from its neighbour ("Version 10" vs "Version 11"), so auto-merging on
    edit distance destroys the releases it is meant to reconstruct.
    """
    groups=collections.defaultdict(list)
    for s,n in strings.items(): groups[strip_key(s)].append((s,n))
    out={}
    for k,v in groups.items():
        out[max(v,key=lambda t:t[1])[0]]=v
    return out

def near_duplicates(canon):
    """Stage B: flag pairs a human must adjudicate. Never merged automatically."""
    labels=[(lab,sum(n for _,n in m)) for lab,m in canon.items()]
    flags=[]
    for i,(a,na) in enumerate(labels):
        for b,nb in labels[i+1:]:
            ka,kb=strip_key(a),strip_key(b)
            d=lev(ka,kb)
            if d==0 or d>2: continue
            da,db=re.findall(r'\d+',a),re.findall(r'\d+',b)
            kind='DIGITS DIFFER (probably a real, distinct release)' if da!=db \
                 else 'text differs only (probably the same release)'
            flags.append((a,na,b,nb,d,kind))
    return flags

def main():
    raw=load()
    h=hashlib.sha256(open(SRC,'rb').read()).hexdigest()
    by_rid, uniq = dedupe(raw)
    print(f'SNAPSHOT sha256 {h}')
    print(f'rows in file               {len(raw)}')
    print(f'after keeping latest Report Version   {len(by_rid)}   (-{len(raw)-len(by_rid)} superseded revisions)')
    print(f'after collapsing Same Incident ID     {len(uniq)}   (-{len(by_rid)-len(uniq)} duplicate incidents)')
    dates=[ym(r) for r in uniq if ym(r)]
    print(f'incident months            {min(dates)} .. {max(dates)}')
    print()

    print('='*100)
    print('FIELD 19 COVERAGE  (Automation Feature Version), deduplicated record')
    print('='*100)
    cls=collections.Counter(classify(r['Automation Feature Version']) for r in uniq)
    n=len(uniq)
    for k in ('value','redacted','placeholder','no-version-token','blank'):
        if cls[k]: print(f'  {k:<18} {cls[k]:>5}  {100*cls[k]/n:5.1f}%')
    usable=cls['value']
    print(f'\n  field present            {n-cls["blank"]:>5}  {100*(n-cls["blank"])/n:5.1f}%')
    print(f'  publicly observable      {usable:>5}  {100*usable/n:5.1f}%')
    print()

    print('='*100)
    print('PER OPERATOR: raw strings -> canonical releases')
    print('='*100)
    ent=collections.defaultdict(list)
    for r in uniq: ent[r['Reporting Entity'].strip()].append(r)
    report={}
    print(f"{'reporting entity':<26} {'rpts':>5} {'raw':>4} {'canon':>6} {'redact':>7} {'malformed':>10}")
    for e,rs in sorted(ent.items(), key=lambda kv:-len(kv[1])):
        vals=collections.Counter(r['Automation Feature Version'].strip() for r in rs
                                 if classify(r['Automation Feature Version'])=='value')
        bad=sum(1 for r in rs if classify(r['Automation Feature Version']) in
                ('placeholder','no-version-token','blank'))
        red=sum(1 for r in rs if classify(r['Automation Feature Version'])=='redacted')
        canon=canonicalise(vals) if vals else {}
        report[e]=(rs,vals,canon)
        print(f'{e:<26} {len(rs):>5} {len(vals):>4} {len(canon):>6} {red:>7} {bad:>10}')
    print()
    print('collapsed strings (raw form -> canonical), where a merge happened:')
    for e,(rs,vals,canon) in report.items():
        for lab,members in canon.items():
            if len(members)>1:
                others=', '.join(f'{s!r}x{n}' for s,n in sorted(members,key=lambda t:-t[1])[1:])
                print(f'  [{e}] {lab!r} <- {others}')
    return uniq, report

if __name__=='__main__':
    main()
