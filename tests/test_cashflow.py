from io import BytesIO
import unittest
import openpyxl

from cashflow import calculate_cashflow, export_cashflow
from reconcile import reconcile_account


def ledger(rows, name='流水.xlsx'):
    return {'name': name, 'headers': ['日期','project','收入','支出','流水号','账户','币种','摘要'], 'rows': rows,
            'mapping': {'mode':'split','date':'日期','project':'project','debit':'收入','credit':'支出','reference':'流水号','account':'账户','currency':'币种','description':'摘要'}}


def transaction(dt, project, income='', expense='', ref='T1', account='BANK1', currency='CNY', description='收支'):
    return [dt, project, income, expense, ref, account, currency, description]


def opening(project='A', amount='100', dt='2026-01-01', currency='CNY'):
    return {'project':project,'currency':currency,'date':dt,'balance':amount}


class CashflowTests(unittest.TestCase):
    def test_project_monthly_income_expense_and_rolling_balance(self):
        rows = [transaction('2026-01-02','A','1000'), transaction('2026-01-03','A',expense='300',ref='T2'),
                transaction('2026-03-02','A',expense='200',ref='T3'), transaction('2026-01-04','B','50',ref='T4')]
        r = calculate_cashflow({'datasets':[ledger(rows)],'openings':[opening(),opening('B','0')],'options':{'endDate':'2026-03-31'}})
        a = [v for v in r['monthly'] if v['project']=='A']
        self.assertEqual([v['month'] for v in a], ['2026-01','2026-02','2026-03'])
        self.assertEqual([v['closing'] for v in a], [80000,80000,60000])
        self.assertEqual(a[1]['count'],0)
        self.assertEqual(a[1]['opening'],80000)
        self.assertEqual(r['summaries'][0]['income'],100000)

    def test_opening_day_is_inclusive_and_out_of_period_is_visible(self):
        rows=[transaction('2026-01-09','A','10'),transaction('2026-01-10','A','20',ref='T2'),transaction('2026-02-01','A','30',ref='T3')]
        r=calculate_cashflow({'datasets':[ledger(rows)],'openings':[opening(dt='2026-01-10')],'options':{'endDate':'2026-01-31'}})
        self.assertEqual(r['summaries'][0]['closing'],12000)
        self.assertEqual(len(r['excluded']),2)
        self.assertEqual(r['transactions'][0]['row'],3)

    def test_missing_project_and_bad_amount_are_not_assigned(self):
        rows=[transaction('2026-01-01','','10'),transaction('2026-01-02','A','wrong',ref='T2'),transaction('2026-01-03','A','20',ref='T3')]
        r=calculate_cashflow({'datasets':[ledger(rows)],'openings':[opening()]})
        self.assertEqual(len(r['unclassified']),1)
        self.assertEqual(len(r['invalid']),1)
        self.assertEqual(r['summaries'][0]['income'],2000)

    def test_missing_opening_does_not_invent_zero_balance(self):
        r=calculate_cashflow({'datasets':[ledger([transaction('2026-01-01','A','10')])]})
        self.assertIsNone(r['monthly'][0]['opening'])
        self.assertIsNone(r['monthly'][0]['closing'])
        self.assertEqual(r['summaries'][0]['income'],1000)

    def test_repeated_file_and_transaction_are_reviewed_not_double_counted(self):
        rows=[transaction('2026-01-01','A','10')]
        payload={'datasets':[ledger(rows,'one.xlsx'),ledger(rows,'again.xlsx')],'openings':[opening()]}
        r=calculate_cashflow(payload)
        self.assertEqual(r['counts']['included'],0)
        self.assertEqual(len(r['duplicates']),2)
        self.assertEqual(r['summaries'][0]['closing'],10000)
        payload['options']={'includeDuplicates':True}
        r=calculate_cashflow(payload)
        self.assertEqual(r['counts']['included'],2)
        self.assertEqual(r['summaries'][0]['closing'],12000)

    def test_accounts_and_currencies_are_separate_duplicate_scopes(self):
        rows=[transaction('2026-01-01','A','10',account='BANK1'),transaction('2026-01-01','A','10',account='BANK2'),transaction('2026-01-01','A','10',currency='USD')]
        r=calculate_cashflow({'datasets':[ledger(rows)],'openings':[opening(),opening(currency='USD',amount='0')]})
        self.assertEqual(len(r['duplicates']),0)
        self.assertEqual(len(r['totals']),2)
        self.assertEqual(r['totals'][0]['income'],2000)

    def test_blank_reference_repeated_rows_require_confirmation(self):
        row=transaction('2026-01-01','A','10',ref='')
        r=calculate_cashflow({'datasets':[ledger([row,row])],'openings':[opening()]})
        self.assertEqual(len(r['duplicates']),2)

    def test_opening_only_project_and_year_transition(self):
        r=calculate_cashflow({'datasets':[ledger([])],'openings':[opening(dt='2025-12-15')],'options':{'endDate':'2026-02-28'}})
        self.assertEqual([v['month'] for v in r['monthly']],['2025-12','2026-01','2026-02'])
        self.assertTrue(all(v['closing']==10000 for v in r['monthly']))

    def test_invalid_openings_and_missing_project_column_are_rejected(self):
        base={'datasets':[ledger([transaction('2026-01-01','A','1')])]}
        for entries in ([opening(),opening()], [opening(amount='')], [opening(dt='bad')], [opening(amount='1.001')]):
            with self.assertRaises(ValueError):
                calculate_cashflow({**base,'openings':entries})
        d=ledger([]);d['mapping'].pop('project')
        with self.assertRaises(ValueError):
            calculate_cashflow({'datasets':[d]})

    def test_extreme_period_and_opening_after_cutoff_are_rejected(self):
        for start,end in [('1900-01-01','2026-01-01'),('2026-02-01','2026-01-01')]:
            with self.assertRaises(ValueError):
                calculate_cashflow({'datasets':[ledger([])],'openings':[opening(dt=start)],'options':{'endDate':end}})

    def test_export_preserves_months_sources_and_formula_text(self):
        r=calculate_cashflow({'datasets':[ledger([transaction('2026-01-01','=PROJECT','0.10',description='=HYPERLINK("x")')])],'openings':[opening('=PROJECT','0')]})
        wb=openpyxl.load_workbook(BytesIO(export_cashflow(r)),data_only=False)
        self.assertEqual(wb['项目月度现金流'].max_row,2)
        self.assertTrue(any(c.value=='=HYPERLINK("x")' for row in wb['已计入流水'] for c in row))
        self.assertFalse(any(c.data_type=='f' for ws in wb for row in ws for c in row))
        self.assertEqual(wb['项目全周期汇总']['F2'].value,'0.10')
        wb.close()


class BankAccountTests(unittest.TestCase):
    def test_only_selected_account_participates_and_original_lines_survive(self):
        a=ledger([transaction('2026-01-01','A','10',account='BANK1'),transaction('2026-01-02','A','20',account='BANK2')])
        b=ledger([transaction('2026-01-01','A','99',account='BANK1'),transaction('2026-01-02','A','20',account='BANK2')])
        r=reconcile_account({'left':a,'right':b,'options':{'accountScope':'BANK2'}})
        self.assertEqual(len(r['matched']),1)
        self.assertEqual(r['matched'][0]['left']['row'],3)
        self.assertEqual(r['totals'][0]['left'],2000)
        self.assertEqual(len(r['excludedAccounts']),2)

    def test_account_cannot_be_omitted_or_cross_matched(self):
        a=ledger([transaction('2026-01-01','A','10',account='BANK1')])
        b=ledger([transaction('2026-01-01','A','10',account='BANK2')])
        with self.assertRaises(ValueError):
            reconcile_account({'left':a,'right':b})
        r=reconcile_account({'left':a,'right':b,'options':{'accountScope':'BANK1'}})
        self.assertEqual(len(r['matched']),0)
        self.assertEqual(len(r['differences']),1)

    def test_fixed_account_supported_but_unmapped_account_not_guessed(self):
        a=ledger([transaction('2026-01-01','A','10')]);a['mapping'].pop('account')
        with self.assertRaises(ValueError):
            reconcile_account({'left':a,'right':a,'options':{'accountScope':'MANUAL'}})
        a['accountName']='MANUAL'
        r=reconcile_account({'left':a,'right':a,'options':{'accountScope':'MANUAL'}})
        self.assertEqual(len(r['matched']),1)


if __name__=='__main__':
    unittest.main()
