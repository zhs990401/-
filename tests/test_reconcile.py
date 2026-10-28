import base64
from io import BytesIO
import unittest

import openpyxl
from reconcile import money, reconcile
from server import parse_file


def dataset(rows, **mapping):
    return {'headers': ['日期', '借方', '贷方', '参考号', '币种', '账户'], 'rows': rows,
            'mapping': {'mode': 'split', 'date': '日期', 'debit': '借方', 'credit': '贷方',
                        'reference': '参考号', 'currency': '币种', 'account': '账户', **mapping}}


def check(a, b, **options):
    return reconcile({'left': dataset(a), 'right': dataset(b), 'options': options})


class ReconciliationTests(unittest.TestCase):
    def test_money_is_exact_and_rejects_precision_loss(self):
        self.assertEqual(money('1,234.56'), 123456)
        self.assertEqual(money('(0.10)'), -10)
        for value in ('NaN', 'Infinity', '1.001', '=SUM(A1:A2)'):
            with self.assertRaises(ValueError):
                money(value)

    def test_exact_and_reverse_direction(self):
        row = ['2026-01-01', '0.10', '', 'P1']
        self.assertEqual(len(check([row], [row])['matched']), 1)
        other = ['2026-01-01', '', '0.10', 'P1']
        result = check([row], [other], direction='reverse')
        self.assertEqual(len(result['matched']), 1)
        self.assertEqual(result['totals'][0]['delta'], 0)

    def test_duplicate_amounts_do_not_match_arbitrarily(self):
        row = ['2026-01-01', '100', '', '']
        result = check([row, row], [row])
        self.assertEqual(len(result['matched']), 0)
        self.assertEqual(len(result['ambiguous']), 3)

    def test_reference_disambiguates_duplicates(self):
        rows = [['2026-01-01', '100', '', ref] for ref in ['P1', 'P2']]
        self.assertEqual(len(check(rows, rows[::-1])['matched']), 2)

    def test_unique_reference_finds_amount_difference(self):
        result = check([['2026-01-01', '', '100', 'P1']], [['2026-01-01', '', '90', 'P1']])
        self.assertEqual(len(result['differences']), 1)
        self.assertEqual(result['differences'][0]['delta'], -1000)

    def test_date_tolerance_and_outside_window(self):
        a, b = [['2026-01-01', '100', '', 'P1']], [['2026-01-02', '100', '', 'P1']]
        self.assertEqual(len(check(a, b, days=1)['matched']), 1)
        self.assertIn('日期', check(a, b)['differences'][0]['reason'])

    def test_currency_and_accounts_are_separated(self):
        a = [['2026-01-01', '100', '', 'P1', 'CNY', 'A']]
        b = [['2026-01-01', '100', '', 'P1', 'USD', 'A']]
        self.assertEqual(len(check(a, b)['matched']), 0)
        b[0][4:]=['CNY', 'B']
        self.assertEqual(len(check(a, b, matchAccount=True)['matched']), 0)
        b[0][5]=''
        self.assertEqual(len(check(a, b, matchAccount=True)['invalid']), 1)

    def test_invalid_rows_preserved_with_original_line(self):
        result = check([['坏日期', '100', '', 'P1'], ['2026-01-01', '', '', ''],
                        ['2026-01-01', '100', '1', 'P2']], [])
        self.assertEqual(len(result['invalid']), 3)
        self.assertEqual(result['invalid'][0]['left']['row'], 2)
        self.assertEqual(result['counts']['left'], 3)

    def test_equal_totals_do_not_imply_match(self):
        result = check([['2026-01-01', '100', '', 'A']], [['2026-01-01', '100', '', 'B']], strictReference=True)
        self.assertEqual(result['totals'][0]['delta'], 0)
        self.assertEqual(len(result['matched']), 0)
        self.assertEqual(len(result['differences']), 2)

    def test_signed_amount_column(self):
        d = dataset([['2026-01-01', '-3.15', '', 'P1']], mode='signed', amount='借方')
        self.assertEqual(reconcile({'left': d, 'right': d})['matched'][0]['left']['amount'], -315)


class ImportTests(unittest.TestCase):
    def test_chinese_csv_with_title_and_duplicate_headers(self):
        content = '项目明细\n日期,金额,金额\n2026-01-01,100,90\n'.encode('gb18030')
        result = parse_file({'name': '明细.csv', 'content': base64.b64encode(content).decode(), 'headerRow': 2})
        self.assertEqual(result['firstRow'], 3)
        self.assertEqual(len(set(result['headers'])), 3)
        self.assertEqual(result['rows'][0][1], '100')

    def test_xlsx_dates_sheet_selection_and_formula_warning(self):
        from datetime import datetime
        wb = openpyxl.Workbook()
        wb.create_sheet('明细')
        wb['明细'].append(['日期', '金额'])
        wb['明细'].append([datetime(2026, 1, 1), '=100+1'])
        stream = BytesIO()
        wb.save(stream)
        result = parse_file({'name': '账.xlsx', 'content': base64.b64encode(stream.getvalue()).decode(), 'sheet': '明细'})
        self.assertEqual(result['rows'][0][0], '2026-01-01')
        self.assertEqual(len(result['warnings']), 1)


if __name__ == '__main__':
    unittest.main()
