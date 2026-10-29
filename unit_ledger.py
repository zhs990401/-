"""Adapter for exported 单位三栏账; discovers columns, never embeds customer data."""
from collections import Counter
from datetime import date
import re

from project_import import currency_name
from reconcile import money


def adapt_unit_ledger(rows, source, sheet):
    header = None
    for i, row in enumerate(rows[:50]):
        names = [str(v or '').strip() for v in row]
        if '账簿名称' in names and '往来单位名称' in names and '借方发生' in names and '贷方发生' in names:
            if i+1 < len(rows) and any(str(v or '').strip() in ('外币','原币') for v in rows[i+1]):
                header = i
                break
    if header is None:
        return None
    parents = [str(v or '').strip() for v in rows[header]]
    children = [str(v or '').strip() for v in rows[header+1]]
    def col(*labels):
        return next((parents.index(v) for v in labels if v in parents), None)
    book_i, unit_i, voucher_i = col('账簿名称'), col('往来单位名称'), col('凭证编号','凭证号')
    currency_i, desc_i = col('外币名称','币种'), col('摘要')
    month_i = next((i for i,v in enumerate(children) if v=='月'), None)
    day_i = next((i for i,v in enumerate(children) if v=='日'), None)
    year_i = next((i for i,v in enumerate(children) if v=='年'), None)
    year = next((int(v) for v in parents if re.fullmatch(r'(19|20)\d{2}',v)), None)
    if year is None:
        for row in rows[:header]:
            match = re.search(r'((?:19|20)\d{2})[-年]', ' '.join(str(v or '') for v in row))
            if match:
                year = int(match.group(1))
                break
    def amount_columns(start, end):
        indices = range(start, end)
        original = next((i for i in indices if children[i] in ('外币','原币')), None)
        base = next((i for i in range(start,end) if children[i] in ('金额','本币','本币金额')), None)
        return original, base
    debit_start, credit_start, balance_start = col('借方发生'), col('贷方发生'), col('余额')
    debit_i, base_debit_i = amount_columns(debit_start,credit_start)
    credit_i, base_credit_i = amount_columns(credit_start,balance_start if balance_start is not None else len(children))
    if any(i is None for i in (unit_i,book_i,currency_i,desc_i,month_i,day_i,debit_i,credit_i)) or not year:
        raise ValueError('识别到单位三栏账，但年月日、账簿、单位或原币发生额列不完整，请核对导出格式')
    base_currency = ''
    for row in rows[:header]:
        text = ' '.join(str(v or '') for v in row)
        if '本位币' in text:
            match = re.search(r'\b([A-Z]{3})\b',text)
            if match:
                base_currency = match.group(1)
    headers=['账簿名称','往来单位名称','记账日期','凭证编号','科目编号','科目名称','原币币种',
             '原币借方发生额','原币贷方发生额','本币币种','本币借方发生额','本币贷方发生额','摘要','业务号','业务日期']
    data, numbers, skipped, zero_rows = [], [], [], []
    formulas = 0
    def get(row,index):
        return str(row[index]).strip() if index is not None and index < len(row) and row[index] is not None else ''
    for number, row in enumerate(rows[header+2:],header+3):
        if not any(str(v or '').strip() for v in row):
            continue
        book, voucher, description = get(row,book_i),get(row,voucher_i),get(row,desc_i)
        summary_labels={'期初余额','上年结转','本期合计','本月合计','本年累计','本月累计','本日合计','累计','合计'}
        if (not voucher and description in summary_labels) or (not book and not voucher):
            skipped.append({'source':source,'sheet':sheet,'row':number,'project':book,'counterparty':get(row,unit_i),
                            'description':description,'currency':currency_name(get(row,currency_i)),
                            'reason':'非逐笔记录（期初、合计、累计等），不参与发生额核对'})
            continue
        try:
            posting_year=int(float(get(row,year_i))) if year_i is not None else year
            posting_date=date(posting_year,int(float(get(row,month_i))),int(float(get(row,day_i)))).isoformat()
        except (ValueError,OverflowError):
            posting_date=''
        debit,credit=get(row,debit_i),get(row,credit_i)
        record=[book,get(row,unit_i),posting_date,voucher,get(row,col('科目编号','科目编码')),
                get(row,col('科目名称')),currency_name(get(row,currency_i)),debit,credit,base_currency,
                get(row,base_debit_i),get(row,base_credit_i),description,get(row,col('业务号')),get(row,col('业务日期'))]
        formulas+=sum(v.startswith('=') for v in record)
        data.append(record);numbers.append(number)
        try:
            if (debit or credit) and money(debit)==money(credit)==0:
                zero_rows.append(number)
        except ValueError:
            pass
    books=sorted({r[0] for r in data if r[0]})
    counts=Counter(r[0] for r in data)
    internal=Counter(r[0] for r in data if r[1] in books)
    warnings=['已适配单位三栏账：从账簿名称识别内部单位，年月日合成记账日期，借贷“外币”作为原币发生额；期初与汇总行不参与发生额核对。']
    if not base_currency:
        warnings.append('未识别本位币代码，不自动进行本币辅助比较')
    if formulas:
        warnings.append('明细中含公式，公式不会执行，请先在 Excel 中粘贴为值')
    return {'headers':headers,'rows':data,'firstRow':header+3,'rowNumbers':numbers,
            'ledgerFormat':'unit-three-column-v1','ledgerBooks':books,
            'ledgerBookStats':[{'project':b,'count':counts[b],'internalCount':internal[b],'unconfirmedCount':counts[b]-internal[b]} for b in books],
            'ledgerSummaryRows':skipped,'ledgerZeroOriginalRows':zero_rows,
            'ledgerCounts':{'input':len(data)+len(skipped),'details':len(data),'summary':len(skipped),'books':len(books)},
            'warnings':warnings,'sheet':sheet}
