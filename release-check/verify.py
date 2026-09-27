"""Assert every number published in POST.md. Exits non-zero on any mismatch."""
import collections, contextlib, hashlib, io, math, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ledger

FAIL=[]
def eq(label, got, want, tol=0):
    ok = abs(got-want)<=tol if isinstance(want,(int,float)) and tol else got==want
    print(f'  {"ok " if ok else "FAIL"}  {label:<54} got {got!r}'+('' if ok else f'  want {want!r}'))
    if not ok: FAIL.append(label)

print('SNAPSHOT')
h=hashlib.sha256(open(ledger.SRC,'rb').read()).hexdigest()
eq('sha256', h, 'f856d0b9cedc5f4447515c200eeacdff5d4cabf63003dcac207385eb466ff7f5')

buf=io.StringIO()
with contextlib.redirect_stdout(buf):
    uniq, report = ledger.main()
raw=ledger.load()
by_rid, uniq2 = ledger.dedupe(raw)

print('\nSTAGE 1  deduplication')
eq('rows in file', len(raw), 1478)
eq('after latest Report Version per ID', len(by_rid), 1437)
eq('after collapsing Same Incident ID', len(uniq), 1436)
eq('reporting operators', len(report), 17)

print('\nSTAGE 2  field coverage')
cls=collections.Counter(ledger.classify(r['Automation Feature Version']) for r in uniq)
eq('publicly observable value', cls['value'], 1369)
eq('redacted as CBI', cls['redacted'], 35)
eq('no version token', cls['no-version-token'], 28)
eq('placeholder', cls['placeholder'], 4)
eq('blank (field absent)', cls['blank'], 0)
eq('observable share, 1dp', round(100*cls['value']/len(uniq),1), 95.3)

print('\nSTAGE 2b  Waymo normalisation')
rs, vals, canon = report['Waymo LLC']
eq('Waymo reports', len(rs), 1211)
eq('Waymo raw strings', len(vals), 13)
eq('Waymo after formatting merge', len(canon), 9)
flags=ledger.near_duplicates(canon)
eq('near-duplicate pairs, Waymo', len(flags), 15)
allflags=sum(len(ledger.near_duplicates(c)) for _,_,c in report.values())
eq('near-duplicate pairs, all operators', allflags, 44)
everypair=[x for _,_,c in report.values() for x in ledger.near_duplicates(c)]
textonly=[f for f in everypair if 'text differs only' in f[5]]
eq('pairs that are text-only variants', len(textonly), 1)

print('\nSTAGE 3  operator table (reports, releases)')
import timeline_outcomes as T
EXPECT={'Waymo LLC':(1211,5),'Avride Inc.':(79,8),'Zoox, Inc.':(64,64),
        'Tesla, Inc.':(26,0),'May Mobility':(18,15)}
for e,(n,rel) in EXPECT.items():
    rs2=report[e][0]
    got=len({T.release_of(r) for r in rs2 if T.release_of(r)})
    eq(f'{e} reports', len(rs2), n)
    eq(f'{e} releases', got, rel)
withheld=['Motional','Aurora Operations, Inc.','Nuro','Stack AV','PlusAI Inc','Oxbotica','Hyundai Motor America']
eq('withheld group operators', len(withheld), 7)
eq('withheld group reports', sum(len(report[e][0]) for e in withheld), 30)
toofew=['Beep, Inc.','MOIA America LLC','Gatik AI Inc.','WeRide Corp','Ohmio, Inc.']
eq('too-few group operators', len(toofew), 5)
eq('too-few group reports', sum(len(report[e][0]) for e in toofew), 8)
eq('table sums to deduplicated total',
   sum(len(report[e][0]) for e in list(EXPECT)+withheld+toofew), 1436)

print('\nSTAGE 3  Waymo timeline')
tl=collections.Counter()
for r in report['Waymo LLC'][0]:
    rel=T.release_of(r)
    if rel and ledger.ym(r): tl[rel]+=1
for name,n in [('5th Generation ADS, Version 9',5),('5th Generation ADS, Version 10',904),
               ('6th Generation ADS, Version 10',5),('5th Generation ADS, Version 11',274),
               ('6th Generation ADS, Version 11',20)]:
    eq(name, tl[name], n)

print('\nSTAGE 4  arms and outcomes')
w=report['Waymo LLC'][0]
for r in w: r['_rel']=T.release_of(r); r['_m']=ledger.ym(r)
A=[r for r in w if r['_rel']=='5th Generation ADS, Version 10' and r['_m'] and (2025,6)<=r['_m']<=(2026,4)]
B=[r for r in w if r['_rel']=='5th Generation ADS, Version 11' and r['_m'] and (2026,6)<=r['_m']<=(2026,7)]
eq('arm A (v10) incidents', len(A), 875)
eq('arm B (v11) incidents', len(B), 186)
WANT={'any injury alleged':(10.17,6.99,-3.18,-7.36,0.99,0.218),
      'moderate-or-worse injury':(0.91,2.69,1.77,-0.63,4.18,0.061),
      'air bags deployed':(4.46,5.38,0.92,-2.60,4.44,0.566),
      'a vehicle was towed':(54.51,58.60,4.09,-3.72,11.90,0.330)}
for name,f in T.METRICS.items():
    ka=sum(1 for r in A if f(r)); kb=sum(1 for r in B if f(r))
    pa,pb=ka/len(A),kb/len(B)
    se=math.sqrt(pa*(1-pa)/len(A)+pb*(1-pb)/len(B))
    d=(pb-pa)*100; lo,hi=d-1.96*se*100,d+1.96*se*100
    p=T.fisher(ka,len(A)-ka,kb,len(B)-kb)
    wa,wb,wd,wlo,whi,wp=WANT[name]
    eq(f'{name}: v10 %', round(pa*100,2), wa, .005)
    eq(f'{name}: v11 %', round(pb*100,2), wb, .005)
    eq(f'{name}: diff pp', round(d,2), wd, .005)
    eq(f'{name}: CI', (round(lo,2),round(hi,2)), (wlo,whi))
    eq(f'{name}: Fisher p', round(p,3), wp, .0005)

print('\nSTAGE 4  detection limits')
f=T.METRICS['moderate-or-worse injury']
p=(sum(1 for r in A if f(r))+sum(1 for r in B if f(r)))/(len(A)+len(B))
eq('moderate-or-worse MDE pp', round(T.mde(len(A),len(B),p),2), 2.49, .005)
for e,want in [('Avride Inc.',9.2),('May Mobility',27.9),('Zoox, Inc.',39.4)]:
    c=collections.Counter(T.release_of(r) for r in report[e][0] if T.release_of(r))
    (n1,_),(n2,_)=[(v,k) for k,v in c.most_common(2)]
    eq(f'{e} MDE on a 1% outcome', round(T.mde(n1,n2,0.01),1), want, .05)

print()
if FAIL:
    print(f'{len(FAIL)} MISMATCH(ES): '+', '.join(FAIL)); sys.exit(1)
print('all published numbers reproduce from this snapshot.')
