"""Payment identifiers disambiguate same amounts before split matching."""
from collections import Counter
import unittest

from test_extended import bank, ds, row
from reconcile import payment_codes, reconcile_projects


class PaymentCodeTests(unittest.TestCase):
    def test_screenshot_project_rentals_and_all_sources_preserved(self):
        left = [row(-16200, '记0088', 'House rental/PC1797&1809', currency='USD', other='B', dt='2026-09-30'),
                row(-6600, '记0058', 'House rental/PC1830', currency='USD', other='B', dt='2026-10-23'),
                row(-9900, '记0064', 'House rental/PC1834', currency='USD', other='B', dt='2026-10-29')]
        right = [row(6300, '记0010', 'House rental/PC1809', currency='USD', other='A', dt='2026-08-12'),
                 row(9900, '记0008', 'House rental/PC1797', currency='USD', other='A', dt='2026-07-09'),
                 row(6600, '记0005', 'House rental/PC1830', currency='USD', other='A', dt='2026-10-14'),
                 row(9900, '记0014', 'House rental/PC1834', currency='USD', other='A', dt='2026-10-23'),
                 row(6600, '记0099', 'Other payment/PC9999', currency='USD', other='A')]
        result = reconcile_projects({'datasets': [ds(left, project='A'), ds(right, project='B')],
                                     'options': {'days': 'unlimited', 'oneToMany': True}})
        self.assertEqual(Counter(e['matchType'] for e in result['matched']), {'one_to_one': 2, 'one_to_many': 1})
        observed = Counter()
        for category in ('matched', 'ambiguous', 'differences'):
            for entry in result[category]:
                for side in ('left', 'right'):
                    observed.update((r['project'], r['row']) for r in entry.get(side + 'Rows', []) or ([entry[side]] if entry[side] else []))
        self.assertEqual(observed, Counter({**{('A', n): 1 for n in range(2, 5)}, **{('B', n): 1 for n in range(2, 7)}}))
        singles = [e for e in result['matched'] if e['matchType'] == 'one_to_one']
        self.assertTrue(all('PC 付款编号一致' in e['reason'] for e in singles))

    def test_duplicate_payment_codes_are_not_arbitrarily_paired(self):
        result = bank([row(100, description='PC1830')], [row(100, description='PC1830')] * 2)
        self.assertFalse(result['matched'])
        self.assertEqual(len(result['ambiguous']), 3)

    def test_date_account_currency_and_strict_reference_still_apply(self):
        a = row(100, 'A', 'PC1830', account='A')
        for b, options in [(row(100, 'B', 'PC1830'), {'strictReference': True}),
                           (row(100, description='PC1830', dt='2026-10-01'), {}),
                           (row(100, description='PC1830', account='B'), {'matchAccount': True}),
                           (row(100, description='PC1830', currency='USD'), {})]:
            self.assertFalse(bank([a], [b], **options)['matched'])

    def test_multiple_identifiers_are_compared_as_complete_sets(self):
        self.assertEqual(payment_codes({'description': 'pc1797 & 1809'}), ('1797', '1809'))
        self.assertEqual(payment_codes({'description': 'PC1797&PC1809'}), ('1797', '1809'))
        self.assertEqual(payment_codes({'description': 'APC1830X'}), ())
        result = bank([row(100, description='PC1797&1809')],
                      [row(100, description='PC1797'), row(100, description='PC1809')])
        self.assertFalse(result['matched'])
