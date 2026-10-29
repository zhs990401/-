"""Conservative ledger reconciliation, using integer cents throughout."""
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from itertools import combinations
import re

DEFAULT_FEE_KEYWORDS = '手续费,汇划费,结算费,账户管理费,网银服务费,银行工本费'
GROUP_BUDGET = 200_000
GROUP_CANDIDATES = 18


def money(value):
    text = str(value or '').strip().replace(',', '').replace('，', '').replace('￥', '').replace('¥', '').replace(' ', '')
    if text in ('', '-', '—'):
        return 0
    if text.startswith('(') and text.endswith(')'):
        text = '-' + text[1:-1]
    try:
        number = Decimal(text)
        if not number.is_finite() or abs(number) > Decimal('999999999999'):
            raise ValueError('金额超出允许范围')
        if number * 100 != (number * 100).to_integral_value():
            raise ValueError('金额超过两位小数，请确认币种及精度')
        return int(number * 100)
    except InvalidOperation:
        raise ValueError('无法识别金额：' + text[:40]) from None


def day(value):
    text = str(value or '').strip()
    if re.fullmatch(r'\d{8}', text):
        return datetime.strptime(text, '%Y%m%d').date()
    text = text.replace('年', '-').replace('月', '-').replace('日', '').replace('/', '-').replace('.', '-')
    try:
        return datetime.strptime(text[:10].split(' ')[0], '%Y-%m-%d').date()
    except ValueError:
        raise ValueError('日期无效，请使用完整年月日') from None


def normalize(dataset, side):
    rows, mapping = dataset['rows'], dataset['mapping']
    if not mapping.get('date'):
        raise ValueError('请选择日期列')
    if mapping.get('mode') == 'signed':
        if not mapping.get('amount'):
            raise ValueError('请选择带正负号的金额列')
        selected = [mapping['amount']]
    else:
        selected = [mapping.get('debit'), mapping.get('credit')]
        if not any(selected):
            raise ValueError('请至少选择一列借方/收入或贷方/支出金额')
        if selected[0] and selected[0] == selected[1]:
            raise ValueError('借方和贷方不能使用同一列')
    optional = [mapping.get(k) for k in ('reference', 'description', 'currency', 'account', 'project', 'counterparty')]
    if any(key and key not in dataset['headers'] for key in [mapping['date'], *selected, *optional]):
        raise ValueError('字段映射不存在，请重新选择列')
    valid, invalid = [], []
    for offset, cells in enumerate(rows):
        number = dataset['rowNumbers'][offset] if 'rowNumbers' in dataset else offset + dataset.get('firstRow', 2)
        if not any(str(v or '').strip() for v in cells):
            continue
        values = dict(zip(dataset['headers'], cells))
        get = lambda key: str(values.get(mapping.get(key), '') or '').strip()
        record = {'side': side, 'row': number, 'date': get('date'), 'description': get('description'),
                  'reference': get('reference'), 'currency': get('currency').upper() or str(dataset.get('currencyName', 'CNY')).strip().upper(),
                  'account': get('account') if mapping.get('account') else str(dataset.get('accountName', '')).strip(), 'amount': None, 'source': dataset.get('name', ''),
                  'sheet': dataset.get('sheet', ''), 'datasetId': dataset.get('id', side),
                  'project': get('project') if mapping.get('project') else str(dataset.get('projectName', '')).strip(),
                  'counterparty': get('counterparty')}
        try:
            date_value = day(get('date'))
            if mapping.get('mode') == 'signed':
                if not get('amount'):
                    raise ValueError('金额为空')
                amount = money(get('amount'))
            else:
                debit, credit = money(get('debit')), money(get('credit'))
                if debit and credit:
                    raise ValueError('同一行借贷双方均有金额，请检查是否为汇总行')
                amount = debit - credit
            if amount == 0:
                raise ValueError('金额为零或为空，请检查是否为余额/汇总行')
            record.update(date=date_value.isoformat(), amount=amount)
            valid.append(record)
        except (ValueError, OverflowError) as exc:
            invalid.append(item(record if side == 'left' else None, record if side == 'right' else None, str(exc)))
    return valid, invalid


def item(left, right, reason, **extra):
    return {'left': left, 'right': right, 'reason': reason, **extra}


def settings(options):
    tolerance = 'unlimited' if options.get('days') == 'unlimited' else int(options.get('days', 0))
    if tolerance != 'unlimited' and not 0 <= tolerance <= 31:
        raise ValueError('日期容差必须为无限制或 0 至 31 天')
    max_parts = int(options.get('maxParts', 5))
    if not 2 <= max_parts <= 5:
        raise ValueError('一笔对多笔的拆分上限必须在 2 至 5 笔之间')
    keywords = [s.strip() for s in re.split(r'[,，;；\n]', str(options.get('feeKeywords', DEFAULT_FEE_KEYWORDS))) if s.strip()]
    if len(keywords) > 30 or any(len(k) > 40 for k in keywords):
        raise ValueError('手续费关键词最多 30 个，每个最多 40 字')
    if options.get('separateFees') and not keywords:
        raise ValueError('请填写至少一个手续费识别关键词')
    return {**options, 'days': tolerance, 'direction': 'reverse' if options.get('direction') == 'reverse' else 'same',
            'strictReference': bool(options.get('strictReference')), 'matchAccount': bool(options.get('matchAccount')),
            'matchDuplicateCounts': options.get('matchDuplicateCounts') is not False, 'oneToMany': bool(options.get('oneToMany')), 'maxParts': max_parts,
            'separateFees': bool(options.get('separateFees')), 'feeKeywords': ','.join(keywords)}


def safe_total(records):
    if sum(abs(r['amount']) for r in records) > 9_000_000_000_000_000:
        raise ValueError('金额总量超出网页精确计算范围，请按项目或期间拆分')


def aggregate(records):
    if len(records) == 1:
        return records[0]
    return {**records[0], 'row': ','.join(str(r['row']) for r in records),
            'date': ' ~ '.join(sorted({r['date'] for r in records})),
            'description': ' / '.join(r['description'] for r in records),
            'reference': ' / '.join(dict.fromkeys(r['reference'] for r in records if r['reference'])),
            'source': ' / '.join(dict.fromkeys(r['source'] for r in records)),
            'amount': sum(r['amount'] for r in records),
            'baseAmount': sum(r['baseAmount'] for r in records) if all(r.get('baseAmount') is not None for r in records) and len({r.get('baseCurrency') for r in records}) == 1 else None,
            'baseCurrency': records[0].get('baseCurrency', '') if len({r.get('baseCurrency') for r in records}) == 1 else ''}


def group_search(left, right, remaining_l, remaining_r, options):
    """Search amount patterns before deciding whether source rows conflict.

    Proposals from both directions are collected before accepting any, so shared
    constituents never get consumed greedily. A budget failure accepts no groups.
    """
    factor = -1 if options['direction'] == 'reverse' else 1
    limit, days, budget = options['maxParts'], options['days'], GROUP_BUDGET
    blocked_l, blocked_r, proposals = set(), set(), set()

    def meta(r, f, use_ref):
        return (r['currency'], r['account'] if options['matchAccount'] else '',
                1 if r['amount'] * f > 0 else -1, r['reference'] if use_ref else '')

    def build_index(records, remaining, f, use_ref):
        index = defaultdict(list)
        for j in remaining:
            r = records[j]
            index[(meta(r, f, use_ref), '' if days == 'unlimited' else r['date'])].append((abs(r['amount']), j))
        for group in index.values():
            group.sort()
        return index

    for source, target, remaining_s, remaining_t, sf, tf, is_left in (
        (left, right, remaining_l, remaining_r, 1, factor, True),
        (right, left, remaining_r, remaining_l, factor, 1, False),
    ):
        plain = build_index(target, remaining_t, tf, False)
        references = build_index(target, remaining_t, tf, True)
        pattern_groups = defaultdict(list)
        for i in sorted(remaining_s):
            r = source[i]
            pools = []
            ref_pools = []
            dates = [''] if days == 'unlimited' else [(date.fromisoformat(r['date']) + timedelta(days=offset)).isoformat() for offset in range(-days, days+1)]
            for dt in dates:
                pools.append(plain.get((meta(r, sf, False), dt), []))
                if r['reference']:
                    ref_pools.append(references.get((meta(r, sf, True), dt), []))
            if options['strictReference']:
                pools = ref_pools
            target_amount = abs(r['amount'])
            candidates = []
            for pool in pools:
                # Constituents are strictly smaller than the anchor, same sign.
                size = bisect_right(pool, (target_amount - 1, float('inf')))
                if len(candidates) + size > GROUP_CANDIDATES:
                    return [], set(remaining_l), set(remaining_r), '组合候选超过 18 条，本轮组合审核未自动配对；请缩小日期范围或按账户/参考号拆分'
                candidates.extend(pool[:size])
            solutions = set()
            for count in range(2, min(limit, len(candidates)) + 1):
                for combo in combinations(candidates, count):
                    budget -= 1
                    if budget < 0:
                        return [], set(remaining_l), set(remaining_r), '组合搜索达到计算上限，本轮组合审核未自动配对；请缩小期间或按账户/参考号拆分'
                    if sum(value for value, _ in combo) == target_amount:
                        # Swapping equal-valued source rows is the same amount
                        # pattern, not a second business-level split proposal.
                        solutions.add(tuple(sorted(value for value, _ in combo)))
                        if len(solutions) == 2:
                            break
                if len(solutions) == 2:
                    break
            if len(solutions) > 1:
                (blocked_l if is_left else blocked_r).add(i)
                (blocked_r if is_left else blocked_l).update(j for _, j in candidates)
            elif solutions:
                pattern = next(iter(solutions))
                members = tuple(sorted(j for value, j in candidates if value in pattern))
                pattern_groups[(pattern, members)].append(i)
        for (pattern, members), anchors in pattern_groups.items():
            required = Counter(pattern)
            actual = Counter(abs(target[j]['amount']) for j in members)
            complete = all(actual[value] == len(anchors) * count for value, count in required.items())
            repeated_allowed = len(anchors) == 1 or options['matchDuplicateCounts']
            if complete and repeated_allowed:
                il, ir = (tuple(anchors), members) if is_left else (members, tuple(anchors))
                proposals.add((il, ir))
            else:
                # Never choose an arbitrary subset of interchangeable rows.
                (blocked_l if is_left else blocked_r).update(anchors)
                (blocked_r if is_left else blocked_l).update(members)
    usage_l, usage_r = Counter(), Counter()
    for il, ir in proposals:
        usage_l.update(il)
        usage_r.update(ir)
    accepted = []
    for il, ir in sorted(proposals):
        conflict = any(usage_l[i] != 1 or i in blocked_l for i in il) or any(usage_r[j] != 1 or j in blocked_r for j in ir)
        if conflict:
            blocked_l.update(il)
            blocked_r.update(ir)
    for il, ir in sorted(proposals):
        if not any(i in blocked_l for i in il) and not any(j in blocked_r for j in ir):
            accepted.append((il, ir))
    return accepted, blocked_l, blocked_r, ''


def compare_records(left, right, options):
    """Compare one project pair / one category (normal or fee), preserving origin."""
    factor = -1 if options['direction'] == 'reverse' else 1
    tolerance, account, strict_ref = options['days'], options['matchAccount'], options['strictReference']
    key = lambda r, f: (r['amount'] * f, r['currency'], r['account'] if account else '')

    def candidates(source, target, source_factor, target_factor):
        index, refs = defaultdict(list), defaultdict(list)
        for j, r in enumerate(target):
            index[(key(r, target_factor), '' if tolerance == 'unlimited' else r['date'])].append(j)
            if r['reference']:
                refs[(key(r, target_factor), '' if tolerance == 'unlimited' else r['date'], r['reference'])].append(j)
        result = []
        for r in source:
            pool, ref_matches = [], []
            dates = [''] if tolerance == 'unlimited' else [(date.fromisoformat(r['date']) + timedelta(days=offset)).isoformat() for offset in range(-tolerance,tolerance+1)]
            for dt in dates:
                pool.extend(index.get((key(r, source_factor), dt), [])[:202])
                if r['reference']:
                    ref_matches.extend(refs.get((key(r, source_factor), dt, r['reference']), [])[:202])
            result.append((ref_matches if strict_ref or ref_matches else pool)[:202])
        return result

    lc, rc = candidates(left, right, 1, factor), candidates(right, left, factor, 1)
    matched, ambiguous, differences, warnings = [], [], [], []
    used_l, used_r = set(), set()
    for i, choices in enumerate(lc):
        if len(choices) == 1 and rc[choices[0]] == [i]:
            j = choices[0]
            used_l.add(i)
            used_r.add(j)
            matched.append(item(left[i], right[j], ('金额、币种符合规则；日期无限制' if tolerance == 'unlimited' else '金额、币种和日期符合规则') + ('；参考号一致' if left[i]['reference'] and left[i]['reference'] == right[j]['reference'] else ''), delta=0, matchType='one_to_one'))
    count_l,count_r,count_checks,deferred={},{},[],[]
    if options['matchDuplicateCounts']:
        from duplicate_counts import match_duplicate_counts
        count_matches,count_l,count_r,count_checks,deferred=match_duplicate_counts(left,right,used_l,used_r,options)
        for il,ir,check in count_matches:
            a,b=[left[i] for i in il],[right[j] for j in ir]
            used_l.update(il);used_r.update(ir)
            matched.append(item(aggregate(a),aggregate(b),check['reason'],delta=0,matchType='amount_count',statisticalMatch=True,
                                leftCount=len(a),rightCount=len(b),leftRows=a,rightRows=b))
    group_l, group_r, group_warning = set(), set(), ''
    if options['oneToMany']:
        remaining_l = {i for i in range(len(left)) if i not in used_l and i not in count_l and not any(j not in used_r for j in lc[i])}
        remaining_r = {j for j in range(len(right)) if j not in used_r and j not in count_r and not any(i not in used_l for i in rc[j])}
        groups, group_l, group_r, group_warning = group_search(left, right, remaining_l, remaining_r, options)
        if group_warning:
            warnings.append(group_warning)
        for il, ir in groups:
            a, b = [left[i] for i in il], [right[j] for j in ir]
            used_l.update(il)
            used_r.update(ir)
            repeated = len(a) > 1 and len(b) > 1
            reason = (f'重复一对多按组匹配（左 {len(a)} 笔 ↔ 右 {len(b)} 笔），拆分金额及各金额笔数一致；未指定组内逐笔对应关系'
                      if repeated else f'一笔对多笔（左 {len(a)} 笔 ↔ 右 {len(b)} 笔），同方向合计一致')
            matched.append(item(aggregate(a), aggregate(b), reason,
                                delta=0, matchType='repeated_split' if repeated else 'one_to_many', statisticalMatch=repeated,
                                leftCount=len(a), rightCount=len(b), leftRows=a, rightRows=b))
    refs_l, refs_r = defaultdict(list), defaultdict(list)
    for records, used, index in ((left, used_l, refs_l), (right, used_r, refs_r)):
        for i, r in enumerate(records):
            if i not in used and r['reference']:
                index[(r['reference'], r['currency'], r['account'] if account else '')].append(i)
    for reference in sorted(refs_l.keys() & refs_r.keys()):
        if len(refs_l[reference]) == len(refs_r[reference]) == 1:
            i, j = refs_l[reference][0], refs_r[reference][0]
            if lc[i] or rc[j] or i in group_l or j in group_r or i in count_l or j in count_r:
                continue
            delta = left[i]['amount'] - right[j]['amount'] * factor
            differences.append(item(left[i], right[j], '参考号一致，金额差异' if delta else '参考号一致，日期超出容差', delta=delta))
            used_l.add(i)
            used_r.add(j)
    if deferred:
        from duplicate_counts import finish_deferred_counts
        late_l,late_r,late_checks=finish_deferred_counts(deferred,used_l,used_r,options)
        count_l.update(late_l);count_r.update(late_r);count_checks.extend(late_checks)
    for side, records, used, candidate_list, group_ambiguous in (
        ('left', left, used_l, lc, group_l), ('right', right, used_r, rc, group_r)
    ):
        for i, r in enumerate(records):
            if i in used:
                continue
            a, b = (r, None) if side == 'left' else (None, r)
            if candidate_list[i] or i in group_ambiguous or i in (count_l if side=='left' else count_r):
                reason = group_warning if i in group_ambiguous and group_warning else (count_l if side=='left' else count_r).get(i,'存在重复或组合冲突，无法唯一配对，请人工复核')
                ambiguous.append(item(a, b, reason))
            else:
                differences.append(item(a, b, '对侧未找到符合规则的记录（可能漏记、日期差异或金额差异）'))
    return {'matched': matched, 'differences': differences, 'ambiguous': ambiguous, 'warnings': warnings,'duplicateAmountChecks':count_checks}


def currency_totals(left, right, factor):
    totals = []
    sums_l, sums_r = defaultdict(int), defaultdict(int)
    for r in left:
        sums_l[r['currency']] += r['amount']
    for r in right:
        sums_r[r['currency']] += r['amount']
    for currency in sorted(sums_l.keys() | sums_r.keys()):
        a, b = sums_l[currency], sums_r[currency]
        totals.append({'currency': currency, 'left': a, 'right': b, 'delta': a - b * factor})
    return totals


def reconcile(payload):
    options = settings(payload.get('options', {}))
    for field, enabled in (('account', options['matchAccount']), ('reference', options['strictReference'])):
        if enabled and not all(payload[s]['mapping'].get(field) or (field == 'account' and str(payload[s].get('accountName', '')).strip()) for s in ('left', 'right')):
            raise ValueError('按账户核对需要两侧选择账户列' if field == 'account' else '严格匹配参考号需要两侧选择参考号列')
    left, bad_left = normalize(payload['left'], 'left')
    right, bad_right = normalize(payload['right'], 'right')
    safe_total(left + right)
    if options['matchAccount']:
        for records, invalid, side in ((left, bad_left, 'left'), (right, bad_right, 'right')):
            invalid.extend(item(r if side == 'left' else None, r if side == 'right' else None, '按账户核对时账户不能为空') for r in records if not r['account'])
            records[:] = [r for r in records if r['account']]
    keywords = options['feeKeywords'].split(',') if options['separateFees'] else []
    fee = lambda r: bool(keywords) and any(k in r['description'] for k in keywords)
    normal_l, normal_r = [r for r in left if not fee(r)], [r for r in right if not fee(r)]
    fees_l, fees_r = [r for r in left if fee(r)], [r for r in right if fee(r)]
    report = compare_records(normal_l, normal_r, options)
    report.update(invalid=bad_left + bad_right, fees=[], feeSummary=[], mode='bank')
    fee_report = compare_records(fees_l, fees_r, options)
    for status in ('matched', 'differences', 'ambiguous'):
        for entry in fee_report[status]:
            entry['feeStatus'] = status
            if status == 'differences' and entry['right'] and not entry['left']:
                entry['reason'] = '右侧疑似手续费，左侧未找到对应记录（疑似内账漏记）；' + entry['reason']
            elif status == 'differences' and entry['left'] and not entry['right']:
                entry['reason'] = '左侧疑似手续费，右侧未找到对应记录；' + entry['reason']
            else:
                entry['reason'] = '疑似手续费；' + entry['reason']
            report['fees'].append(entry)
    factor = -1 if options['direction'] == 'reverse' else 1
    for total in currency_totals(fees_l, fees_r, factor):
        currency = total['currency']
        missing_r = [e['right'] for e in fee_report['differences'] if e['right'] and not e['left'] and e['right']['currency'] == currency]
        missing_l = [e['left'] for e in fee_report['differences'] if e['left'] and not e['right'] and e['left']['currency'] == currency]
        stats = {**total}
        for prefix, rows in (('left', fees_l), ('right', fees_r), ('missingLeft', missing_r), ('missingRight', missing_l)):
            selected = [r for r in rows if r['currency'] == currency]
            stats[prefix + 'Count'] = len(selected)
            stats[prefix + 'Expense'] = sum(-r['amount'] for r in selected if r['amount'] < 0)
            stats[prefix + 'Refund'] = sum(r['amount'] for r in selected if r['amount'] > 0)
        report['feeSummary'].append(stats)
    report['duplicateAmountChecks']=[{**c,'category':'普通记录'} for c in report['duplicateAmountChecks']]+[{**c,'category':'疑似手续费'} for c in fee_report['duplicateAmountChecks']]
    report['warnings'].extend(fee_report['warnings'])
    if options['separateFees']:
        for side in ('left', 'right'):
            if not payload[side]['mapping'].get('description'):
                report['warnings'].append(('左侧' if side == 'left' else '右侧') + '未映射摘要，无法识别该侧手续费；请勿将零统计解读为没有手续费')
    report.update(totals=currency_totals(left, right, factor), normalTotals=currency_totals(normal_l, normal_r, factor),
                  counts={'left': len(left) + len(bad_left), 'right': len(right) + len(bad_right)}, options=options)
    return report


def reconcile_account(payload):
    """Public bank workflow: one explicitly selected bank account at a time."""
    scope = str(payload.get('options', {}).get('accountScope', '')).strip()
    if not scope:
        raise ValueError('请选择本次核对的银行账户；银行资金必须逐个账户核对')
    selected = {'options': {**payload.get('options', {}), 'matchAccount': True, 'accountScope': scope}}
    exclusions, scoped_counts = [], {}
    for side in ('left', 'right'):
        d = payload[side]
        column = d['mapping'].get('account')
        if column and column not in d['headers']:
            raise ValueError('账户列不存在，请重新映射')
        fixed = str(d.get('accountName', '')).strip()
        if not column and not fixed:
            raise ValueError(('左侧' if side == 'left' else '右侧') + '需要映射银行账户列，或填写本文件所属银行账户')
        index = d['headers'].index(column) if column else None
        rows, numbers = [], []
        for offset, cells in enumerate(d['rows']):
            if not any(str(v or '').strip() for v in cells):
                continue
            account = str(cells[index] or '').strip() if index is not None and index < len(cells) else '' if column else fixed
            number = offset + d.get('firstRow', 2)
            if account == scope:
                rows.append(cells)
                numbers.append(number)
            else:
                exclusions.append({'side': side, 'source': d.get('name', ''), 'sheet': d.get('sheet', ''), 'row': number, 'account': account,
                                   'reason': '其他银行账户，未纳入本次核对' if account else '缺少银行账户，未纳入；请补充账户归属'})
        selected[side] = {**d, 'rows': rows, 'rowNumbers': numbers}
        scoped_counts[side] = len(rows)
    if not sum(scoped_counts.values()):
        raise ValueError('两侧均未找到选定银行账户，请检查账户名称或账号是否一致')
    report = reconcile(selected)
    report['accountScope'] = scope
    report['excludedAccounts'] = exclusions
    missing = sum(not r['account'] for r in exclusions)
    if exclusions:
        report['warnings'].append(f'本次仅核对账户 {scope}；其他账户 {len(exclusions) - missing} 条、缺少账户 {missing} 条未参与，请在导出报告的账户范围说明中查看')
    return report


def project_aliases(aliases):
    if not isinstance(aliases, dict) or len(aliases) > 200:
        raise ValueError('项目名称对照最多 200 项')
    aliases = {str(k).strip(): str(v).strip() for k, v in aliases.items()}
    if any(not k or not v for k, v in aliases.items()):
        raise ValueError('项目名称对照不能包含空名称')
    def resolve(name):
        visited = set()
        while name in aliases and aliases[name] != name:
            if name in visited:
                raise ValueError('项目名称对照存在循环，请使用统一标准名称')
            visited.add(name)
            name = aliases[name]
        return name
    for name in aliases:
        resolve(name)
    return resolve


def reconcile_projects(payload):
    from project_import import prepare_project_dataset, enrich_project_rows
    import hashlib
    import json
    datasets = payload.get('datasets', [])
    if not isinstance(datasets, list) or not 1 <= len(datasets) <= 20:
        raise ValueError('请上传 1 至 20 份项目往来账（合并表可通过本方项目列区分）')
    options = settings({**payload.get('options', {}), 'direction': 'reverse', 'separateFees': False, 'matchAccount': False})
    resolve = project_aliases(payload.get('aliases', {}))
    records, invalid, projects = [], [], set()
    additional = options.get('additionalInternalUnits', [])
    if not isinstance(additional,list) or len(additional)>200 or not all(isinstance(n,str) and len(n)<=500 for n in additional):
        raise ValueError('补充内部单位最多 200 项，每项最多 500 字')
    known_books = set()
    for d in datasets:
        own = d.get('mapping',{}).get('project')
        if own and own in d['headers']:
            column=d['headers'].index(own)
            known_books.update(resolve(str(row[column]).strip()) for row in d['rows'] if column<len(row) and str(row[column] or '').strip())
        else:
            name=str(d.get('projectName', d.get('name','').rsplit('.',1)[0])).strip()
            if name:known_books.add(resolve(name))
    internal_names=known_books|{resolve(n.strip()) for n in additional if n.strip()}
    ledger_excluded=[]
    inventory, excluded_period, seen_files = [], [], set()
    start_text = '' if options.get('dateRangeMode') == 'unlimited' else str(options.get('startDate', '')).strip()
    end_text = '' if options.get('dateRangeMode') == 'unlimited' else str(options.get('endDate', '')).strip()
    start_date = day(start_text).isoformat() if start_text else ''
    end_date = day(end_text).isoformat() if end_text else ''
    if start_date and end_date and start_date > end_date:
        raise ValueError('核对开始日期不能晚于结束日期')
    options.update(startDate=start_date, endDate=end_date, amountBasis='original')
    for raw_dataset in datasets:
        invalid_before = len(invalid)
        d = prepare_project_dataset(raw_dataset)
        signature = hashlib.sha256(json.dumps([d['headers'],d['rows'],d['mapping'],resolve(d.get('projectName','')) if not d['mapping'].get('project') else ''], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        if d['rows'] and signature in seen_files:
            raise ValueError(f"{d.get('name', '项目文件')}：发现同一项目内容完全重复的文件，请移除重复上传，避免重复计算")
        seen_files.add(signature)
        mapping = d['mapping']
        if not mapping.get('counterparty'):
            raise ValueError(f"{d.get('name', '项目文件')}：请选择对方项目列，不从摘要猜测往来对象")
        if not mapping.get('project') and not str(d.get('projectName', '')).strip():
            raise ValueError(f"{d.get('name', '项目文件')}：请填写本方项目名称，或选择本方项目列")
        if options['strictReference'] and not mapping.get('reference'):
            raise ValueError('严格匹配参考号需要每份项目往来账选择参考号列')
        rows, bad = normalize(d, 'left')
        raw_detail_count=len(rows)+len(bad)
        enrich_project_rows(d, rows)
        enrich_project_rows(d, [e['left'] for e in bad])
        if d.get('ledgerFormat'):
            zero_rows=set(d.get('ledgerZeroOriginalRows',[]))
            retained=[];retained_bad=[]
            for summary in d.get('ledgerSummaryRows',[]):
                ledger_excluded.append(item({**summary,'amount':None,'date':'','reference':'','baseAmount':None},None,summary['reason'],ledgerCategory='summary'))
            for r in rows:
                if resolve(r['counterparty']) not in internal_names:
                    ledger_excluded.append(item(r,None,'往来单位未命中内部账簿名，暂不纳入；请确认是外部单位还是内部单位的别名/未提供账簿',ledgerCategory='unconfirmed'))
                else:retained.append(r)
            for e in bad:
                r=e['left']
                if resolve(r['counterparty']) not in internal_names:
                    ledger_excluded.append(item(r,None,'往来单位未命中内部账簿名，暂不纳入',ledgerCategory='unconfirmed'))
                elif r['row'] in zero_rows:
                    r['amount']=0
                    ledger_excluded.append(item(r,None,'原币发生额为零（可能仅本币调整），不参加原币往来配对',ledgerCategory='zeroOriginal'))
                else:retained_bad.append(e)
            rows,bad=retained,retained_bad
        invalid.extend(bad)
        dates = [r['date'] for r in rows]
        inventory.append({'source':d.get('name',''), 'project':d.get('projectName','') if not mapping.get('project') else '按本方项目列',
                          'startDate':min(dates) if dates else '', 'endDate':max(dates) if dates else '',
                          'count':raw_detail_count, 'invalidCount':len(bad), 'currency':sorted({r['currency'] for r in rows if r['currency']}),
                          'amountColumns':[mapping.get(k,'') for k in ('amount',) if mapping.get('mode')=='signed'] or [mapping.get(k,'') for k in ('debit','credit')],
                          'amountBasis':'原币发生额'})

        if not mapping.get('project'):
            projects.add(resolve(str(d['projectName']).strip()))
        else:
            project_col = d['headers'].index(mapping['project'])
            projects.update(resolve(str(row[project_col]).strip()) for row in d['rows'] if len(row) > project_col and str(row[project_col] or '').strip())
        for r in rows:
            if (start_date and r['date'] < start_date) or (end_date and r['date'] > end_date):
                excluded_period.append(item(r, None, '不在本次统一核对期间内，未参与原币核对'))
                continue
            if not r['currency'] or r['currency'] in ('原币','本币','外币','本位币'):
                invalid.append(item(r,None,'原币币种为空或无效，未参与核对；不能假设人民币'))
                continue
            r['originalProject'], r['originalCounterparty'] = r['project'], r['counterparty']
            r['project'], r['counterparty'] = resolve(r['project']), resolve(r['counterparty'])
            if d.get('ledgerFormat') and r['project'] and r['project'] == r['counterparty']:
                ledger_excluded.append(item(r,None,'往来单位与本账簿同名，不属于跨项目往来，未参加互核',ledgerCategory='self'))
                continue
            if not r['project'] or not r['counterparty'] or r['project'] == r['counterparty']:
                invalid.append(item(r, None, '本方/对方项目为空，或双方项目名称相同'))
            else:
                records.append(r)
        inventory[-1]['invalidCount'] = len(invalid) - invalid_before
    safe_total(records)
    pairs = defaultdict(lambda: ([], []))
    for r in records:
        a, b = sorted((r['project'], r['counterparty']))
        left, right = pairs[(a, b)]
        r['side'] = 'left' if r['project'] == a else 'right'
        (left if r['side'] == 'left' else right).append(r)
    report = {key: [] for key in ('matched', 'differences', 'ambiguous', 'fees', 'feeSummary', 'totals', 'projectPairs', 'warnings', 'translationDifferences','duplicateAmountChecks')}
    report.update(ledgerExcluded=ledger_excluded,unitDiscovery=sorted(internal_names),knownBooks=sorted(known_books),baseComparisonSkipped=0, invalid=invalid, importInventory=inventory, excludedPeriod=excluded_period, mode='projects', options=options, aliases=payload.get('aliases', {}), projects=sorted(projects),
                  counts={'left': 0, 'right': 0, 'files': len(datasets), 'projects': len(projects), 'rows': len(records) + len(invalid), 'excludedPeriod':len(excluded_period)})
    for (a, b), (left, right) in sorted(pairs.items()):
        comparison = compare_records(left, right, options)
        for kind in ('matched', 'differences', 'ambiguous'):
            for entry in comparison[kind]:
                entry['pair'] = f'{a} ↔ {b}'
                if kind == 'differences' and (a not in projects or b not in projects):
                    entry['reason'] = '对方项目账簿未提供；' + entry['reason']
                report[kind].append(entry)
        for entry in comparison['matched']:
            l, r = entry['left'], entry['right']
            comparable = l.get('baseAmount') is not None and r.get('baseAmount') is not None and l.get('baseCurrency') and l['baseCurrency'] == r.get('baseCurrency')
            if not comparable and (l.get('baseAmount') is not None or r.get('baseAmount') is not None):
                report['baseComparisonSkipped'] += 1
            if comparable:
                delta = l['baseAmount'] + r['baseAmount']
                if delta:
                    report['translationDifferences'].append({**entry, 'baseDelta':delta, 'baseCurrency':l['baseCurrency'],
                        'reason':'原币按规则一致；本币金额不同（可能为折算差异），不计入原币往来差异'})
        report['duplicateAmountChecks'].extend({**c,'pair':f'{a} ↔ {b}','category':'项目往来'} for c in comparison['duplicateAmountChecks'])
        report['warnings'].extend(comparison['warnings'])
        report['counts']['left'] += len(left)
        report['counts']['right'] += len(right)
        for total in currency_totals(left, right, -1):
            currency = total['currency']
            outstanding = sum(1 for kind in ('differences', 'ambiguous') for e in comparison[kind] if (e['left'] or e['right'])['currency'] == currency)
            pair = {**total, 'projectA': a, 'projectB': b, 'leftCount': sum(r['currency'] == currency for r in left),
                    'rightCount': sum(r['currency'] == currency for r in right), 'outstanding': outstanding,
                    'missingProject': a if a not in projects else b if b not in projects else '',
                    'status': '原币待核实' if outstanding or total['delta'] else '原币按规则一致',
                    'baseDifferenceCount':sum(1 for e in report['translationDifferences'] if e.get('pair')==f'{a} ↔ {b}' and e['left']['currency']==currency)}
            report['projectPairs'].append(pair)
            report['totals'].append({**total, 'pairLabel': f'{a} ↔ {b}'})
    missing = sorted({r['counterparty'] for r in records} - projects)
    if missing:
        report['warnings'].append('以下项目没有提供账簿：' + '、'.join(missing))
    if len(projects) < 2:
        report['warnings'].append('当前仅识别到不足两个本方项目，请补齐往来双方账簿')
    report['unitOverview']=build_unit_overview(report,records,known_books,internal_names)
    if ledger_excluded:
        from collections import Counter
        categories=Counter(e.get('ledgerCategory') for e in ledger_excluded)
        report['ledgerExclusionCounts']=dict(categories)
        report['warnings'].append(f"单位三栏账未纳入原币配对：汇总/期初行 {categories['summary']} 条，单位归属待确认 {categories['unconfirmed']} 条，零原币发生 {categories['zeroOriginal']} 条，同名本单位往来 {categories['self']} 条；可在未纳入记录中逐项查看")
    if len({(i['startDate'],i['endDate']) for i in inventory if i['startDate']}) > 1:
        report['warnings'].append('各项目文件的实际交易日期范围不同，请核实是否导出同一期间；没有交易也可能造成范围不同')
    base_errors = sum(bool(r.get('baseError')) for r in records)
    if base_errors:
        report['warnings'].append(f'{base_errors} 条记录的本币资料不完整或无效，仅核对原币；请在明细的本币说明中查看')
    if report['baseComparisonSkipped']:
        report['warnings'].append(f"{report['baseComparisonSkipped']} 组原币已配对记录的本币币种不同或资料不全，未比较本币；未进行汇率换算")
    if excluded_period:
        report['warnings'].append(f'{len(excluded_period)} 条记录不在选定期间，详见导出报告的期间外记录')
    report['warnings'] = list(dict.fromkeys(report['warnings']))
    return report


def build_unit_overview(report, records, known_books, internal_names):
    """Project cards do not sum differences across both sides as a grand total."""
    from collections import Counter, defaultdict
    own=defaultdict(int);opposite=defaultdict(int);counts=Counter();matched=Counter();pending=Counter()
    for r in records:
        own[(r['project'],r['currency'])]+=r['amount'];opposite[(r['counterparty'],r['currency'])]+=r['amount'];counts[(r['project'],r['currency'])]+=1
    for e in report['matched']:
        for side in ('left','right'):
            members=e.get(side+'Rows') or ([e[side]] if e.get(side) else [])
            matched.update((r['project'],r['currency']) for r in members)
    for category in ('differences','ambiguous','invalid'):
        for e in report[category]:
            for side in ('left','right'):
                if e.get(side):pending[(e[side].get('project',''),e[side].get('currency',''))]+=1
    output=[]
    for project in sorted(internal_names):
        currencies=sorted({c for p,c in set(own)|set(opposite)|set(pending) if p==project}) or ['']
        for currency in currencies:
            key=(project,currency)
            delta=own[key]+opposite[key]
            status='账簿未提供' if project not in known_books else '原币待核实' if pending[key] or delta else '按导入原币记录一致' if counts[key] else '无有效原币明细'
            output.append({'project':project,'currency':currency,'ownAmount':own[key],'reciprocalAmount':opposite[key],
                           'delta':delta,'count':counts[key],'matchedCount':matched[key],'pendingCount':pending[key],
                           'provided':project in known_books,'status':status})
    return output
