"""Stage 3 (release timeline) and Stage 4 (release-linked outcomes + power)."""
import collections, math, re
import ledger

uniq, report = ledger.main()
print()

# ---- Waymo human adjudication, stated explicitly -------------------------
ADJUDICATED = {
    '5th Genearation ADS, Version 10': '5th Generation ADS, Version 10',  # misspelling
    '35th Generation ADS, Version 10': '5th Generation ADS, Version 10',  # no 35th gen exists
    '5th Generation, Version 10'     : '5th Generation ADS, Version 10',  # "ADS" omitted
    '5th Generation ADS'             : None,                              # no version -> unusable
    '5th Generation ADS, -'          : None,
}
def release_of(r):
    s=r['Automation Feature Version'].strip()
    for lab,members in report.get(r['Reporting Entity'].strip(),(None,None,{}))[2].items():
        if any(s==m for m,_ in members): s=lab; break
    if s in ADJUDICATED: return ADJUDICATED[s]
    return s if ledger.classify(s)=='value' else None

print('='*100); print('STAGE 3  release timeline per operator'); print('='*100)
for e,(rs,vals,canon) in report.items():
    tl=collections.defaultdict(collections.Counter)
    for r in rs:
        rel=release_of(r); m=ledger.ym(r)
        if rel and m: tl[rel][m]+=1
    if len(tl)<2: continue
    print(f'\n-- {e}  ({len(tl)} distinct releases after adjudication)')
    print(f"   {'release':<34} {'first':>8} {'last':>8} {'months':>7} {'reports':>8}")
    for rel,c in sorted(tl.items(), key=lambda kv: min(kv[1])):
        ms=sorted(c)
        print(f'   {rel:<34} {ms[0][0]}-{ms[0][1]:02d} {ms[-1][0]}-{ms[-1][1]:02d} {len(ms):>7} {sum(c.values()):>8}')
    allm=sorted({m for c in tl.values() for m in c})
    cross=[m for m in allm if sum(1 for c in tl.values() if c.get(m,0)>0)>1]
    print(f'   months with >1 release live (crossover): {["%d-%02d"%m for m in cross] or "none"}')

# ---- Stage 4 -------------------------------------------------------------
S=lambda r:(r['Highest Injury Severity Alleged'] or '').strip()
INJ={'Minor W/O Hospitalization','Minor W/ Hospitalization','Moderate W/ Hospitalization',
     'Moderate W/O Hospitalization','Serious W/ Hospitalization','Fatality'}
SER={'Moderate W/ Hospitalization','Moderate W/O Hospitalization','Serious W/ Hospitalization','Fatality'}
yes=lambda v:(v or '').strip().lower().startswith('y')
METRICS={'any injury alleged':lambda r:S(r) in INJ,
         'moderate-or-worse injury':lambda r:S(r) in SER,
         'air bags deployed':lambda r:yes(r['Any Air Bags Deployed?']),
         'a vehicle was towed':lambda r:yes(r['Was Any Vehicle Towed?'])}
def fisher(a,b,c,d):
    lf=math.lgamma
    P=lambda a,b,c,d: math.exp(lf(a+b+1)+lf(c+d+1)+lf(a+c+1)+lf(b+d+1)
                               -lf(a+1)-lf(b+1)-lf(c+1)-lf(d+1)-lf(a+b+c+d+1))
    p0=P(a,b,c,d); tot=0.0
    for i in range(0,min(a+b,a+c)+1):
        j,k,l=a+b-i,a+c-i,d-(a-i)
        if j<0 or k<0 or l<0: continue
        pi=P(i,j,k,l)
        if pi<=p0*(1+1e-9): tot+=pi
    return min(1.0,tot)
def mde(n1,n2,p,alpha=0.05,power=0.80):
    z=1.959964+0.8416212
    return 100*z*math.sqrt(p*(1-p)*(1/n1+1/n2))

print()
print('='*100); print('STAGE 4  release-linked outcomes, deduplicated record'); print('='*100)
w=[r for r in report['Waymo LLC'][0]]
for r in w: r['_rel']=release_of(r); r['_m']=ledger.ym(r)
A=[r for r in w if r['_rel']=='5th Generation ADS, Version 10' and r['_m'] and (2025,6)<=r['_m']<=(2026,4)]
B=[r for r in w if r['_rel']=='5th Generation ADS, Version 11' and r['_m'] and (2026,6)<=r['_m']<=(2026,7)]
print(f'Arm A  Gen5 Version 10  2025-06..2026-04   {len(A)} incidents')
print(f'Arm B  Gen5 Version 11  2026-06..2026-07   {len(B)} incidents')
print()
print(f"{'metric':<28}{'v10':>15}{'v11':>15}{'diff':>9}{'95% CI':>19}{'Fisher p':>10}  verdict")
for name,f in METRICS.items():
    ka=sum(1 for r in A if f(r)); kb=sum(1 for r in B if f(r))
    na,nb=len(A),len(B); pa,pb=ka/na,kb/nb
    se=math.sqrt(pa*(1-pa)/na+pb*(1-pb)/nb); d=(pb-pa)*100
    lo,hi=d-1.96*se*100,d+1.96*se*100
    v='REAL' if lo>0 or hi<0 else 'inside noise'
    print(f'{name:<28}{ka:>4}/{na:<4}{pa*100:5.2f}%{kb:>4}/{nb:<4}{pb*100:5.2f}%{d:>+8.2f}pp  [{lo:+6.2f},{hi:+6.2f}]{fisher(ka,na-ka,kb,nb-kb):>10.3f}  {v}')
print()
print('smallest difference these arm sizes could have detected (80% power, alpha=0.05):')
for name,f in METRICS.items():
    p=(sum(1 for r in A if f(r))+sum(1 for r in B if f(r)))/(len(A)+len(B))
    print(f'  {name:<28} baseline {p*100:5.2f}%   MDE {mde(len(A),len(B),p):5.2f}pp')
print()
print('power available to every other operator:')
for e,(rs,vals,canon) in report.items():
    if e=='Waymo LLC': continue
    tl=collections.Counter(release_of(r) for r in rs if release_of(r))
    if not tl: print(f'  {e:<26} no usable release label at all'); continue
    top=tl.most_common(2)
    if len(top)<2: print(f'  {e:<26} 1 release, {top[0][1]} reports -> no comparison possible'); continue
    n1,n2=top[0][1],top[1][1]
    print(f'  {e:<26} largest two arms {n1} vs {n2}  -> MDE on a 1% outcome = {mde(n1,n2,0.01):.1f}pp')
