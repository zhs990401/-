"""Count-level reconciliation for repeated equal amounts; no invented row pairing."""
from collections import defaultdict
from bisect import bisect_left,bisect_right
from datetime import date


def amount_buckets(left, right, options):
    factor = -1 if options['direction'] == 'reverse' else 1
    buckets = defaultdict(lambda: [[], []])
    for side, records, multiplier in ((0,left,1),(1,right,factor)):
        for i, r in enumerate(records):
            key=(r['amount']*multiplier,r['currency'],r['account'] if options['matchAccount'] else '',r['reference'] if options['strictReference'] else '')
            buckets[key][side].append(i)
    return buckets


def count_check(key, all_left, all_right, left_indices, right_indices, options):
    amount,currency,account,reference=key
    return {'amount':amount,'currency':currency,'account':account,'reference':reference,
            'originalLeftCount':len(all_left),'originalRightCount':len(all_right),
            'leftCount':len(left_indices),'rightCount':len(right_indices),'quantityDelta':len(left_indices)-len(right_indices),
            'dateRule':options['days']}


def mismatch_reason(check):
    return (f"重复金额数量不一致：原始左 {check['originalLeftCount']} 笔 / 右 {check['originalRightCount']} 笔；"
            f"未匹配余项左 {check['leftCount']} 笔 / 右 {check['rightCount']} 笔，请人工复核")


def match_duplicate_counts(left, right, used_l, used_r, options):
    matches,checks,deferred=[],[],[]
    blocked_l,blocked_r={},{}
    for key,(all_l,all_r) in sorted(amount_buckets(left,right,options).items()):
        if max(len(all_l),len(all_r)) <= 1:
            continue
        remaining_l=[i for i in all_l if i not in used_l]
        remaining_r=[j for j in all_r if j not in used_r]
        for il,ir in date_components(left,right,remaining_l,remaining_r,options['days']):
            if not il and not ir:
                continue
            if not il or not ir:
                deferred.append((key,all_l,all_r,il,ir))
                continue
            check=count_check(key,all_l,all_r,il,ir,options)
            dates=[left[i]['date'] for i in il]+[right[j]['date'] for j in ir]
            check.update(dateFrom=min(dates),dateTo=max(dates))
            equal=len(il)==len(ir)
            references_ok=not options['strictReference'] or bool(key[3])
            dates_ok=options['days']=='unlimited' or (equal and all(abs((date.fromisoformat(a)-date.fromisoformat(b)).days)<=options['days']
                         for a,b in zip(sorted(left[i]['date'] for i in il),sorted(right[j]['date'] for j in ir))))
            if equal and references_ok and dates_ok:
                check.update(status='matched',reason=f"重复金额及数量一致：左 {len(il)} 笔 / 右 {len(ir)} 笔，按组匹配，不指定逐笔对应关系")
                matches.append((il,ir,check))
            else:
                reason=mismatch_reason(check) if not equal else '金额与数量一致，但日期或严格参考号条件不满足，请调整规则或人工复核'
                check.update(status='quantity_mismatch' if not equal else 'conditions_not_met',reason=reason)
                blocked_l.update((i,reason) for i in il)
                blocked_r.update((j,reason) for j in ir)
            checks.append(check)
    return matches,blocked_l,blocked_r,checks,deferred


def finish_deferred_counts(deferred, used_l, used_r, options):
    checks=[];blocked_l={};blocked_r={}
    for key,all_l,all_r,scope_l,scope_r in deferred:
        il=[i for i in scope_l if i not in used_l];ir=[j for j in scope_r if j not in used_r]
        if not il and not ir:
            continue
        check=count_check(key,all_l,all_r,il,ir,options)
        check.update(status='quantity_mismatch',reason=mismatch_reason(check))
        checks.append(check)
        blocked_l.update((i,check['reason']) for i in il)
        blocked_r.update((j,check['reason']) for j in ir)
    return blocked_l,blocked_r,checks



def date_components(left,right,il,ir,days):
    """Implicit interval-graph components, without materializing quadratic edges."""
    if days=='unlimited':
        return [(il,ir)]
    if days==0:
        groups=defaultdict(lambda:[[],[]])
        for i in il:groups[left[i]['date']][0].append(i)
        for j in ir:groups[right[j]['date']][1].append(j)
        return [tuple(groups[k]) for k in sorted(groups)]
    il=sorted(il,key=lambda i:left[i]['date']);ir=sorted(ir,key=lambda j:right[j]['date'])
    n,m=len(il),len(ir);parent=list(range(n+m));sizes=[1]*(n+m)
    def root(i):
        while parent[i]!=i:
            parent[i]=parent[parent[i]];i=parent[i]
        return i
    def union(a,b):
        a,b=root(a),root(b)
        if a!=b:
            if sizes[a]<sizes[b]:a,b=b,a
            parent[b]=a;sizes[a]+=sizes[b]
    for k in range(1,n):
        if left[il[k]]['date']==left[il[k-1]]['date']:union(k,k-1)
    for k in range(1,m):
        if right[ir[k]]['date']==right[ir[k-1]]['date']:union(n+k,n+k-1)
    right_dates=[date.fromisoformat(right[j]['date']).toordinal() for j in ir]
    successor=list(range(m+1))
    def next_edge(k):
        while successor[k]!=k:
            successor[k]=successor[successor[k]];k=successor[k]
        return k
    for i,index in enumerate(il):
        center=date.fromisoformat(left[index]['date']).toordinal()
        lo=bisect_left(right_dates,center-days);hi=bisect_right(right_dates,center+days)
        if lo<hi:
            union(i,n+lo)
            edge=next_edge(lo)
            while edge<hi-1:
                union(n+edge,n+edge+1)
                successor[edge]=next_edge(edge+1);edge=next_edge(edge)
    components=defaultdict(lambda:[[],[]])
    for i,index in enumerate(il):components[root(i)][0].append(index)
    for j,index in enumerate(ir):components[root(n+j)][1].append(index)
    return [tuple(value) for value in components.values()]
