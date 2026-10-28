"""Optional real-browser checks. Run server.py first; requires Playwright + Chromium."""
from io import BytesIO
from pathlib import Path
import tempfile
from datetime import datetime
import os
import openpyxl
from playwright.sync_api import sync_playwright, expect


def xlsx(headers, rows):
    wb = openpyxl.Workbook()
    wb.active.title = '往来明细'
    wb.active.append(headers)
    for row in rows:
        wb.active.append(row)
    stream = BytesIO()
    wb.save(stream)
    wb.close()
    return stream.getvalue()


def upload(name, content):
    return {'name': name, 'mimeType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'buffer': content}


with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='reconcile-browser-') as output:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    credentials = None
    if os.environ.get('TEST_APP_USERNAME') and os.environ.get('TEST_APP_PASSWORD'):
        credentials = {'username': os.environ['TEST_APP_USERNAME'], 'password': os.environ['TEST_APP_PASSWORD']}
    page = browser.new_page(viewport={'width':1440,'height':1100}, device_scale_factor=1, http_credentials=credentials)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:8000'))
    page.locator('#demo').click()
    page.locator('#run').click()
    expect(page.locator('#results')).to_be_visible()
    assert page.locator('.stat strong').all_text_contents() == ['3','3','3','1','2']
    expect(page.locator('#fee-summary')).to_contain_text('12.00 / 2.00')
    page.get_by_role('button', name='已匹配 3', exact=True).click()
    expect(page.locator('#report-body')).to_contain_text('一笔对多笔')
    expect(page.locator('#report-body')).to_contain_text('材料付款第二笔')
    page.get_by_role('button', name='疑似手续费 2', exact=True).click()
    expect(page.locator('#report-body')).to_contain_text('疑似内账漏记')
    with page.expect_download() as info:
        page.locator('#export-excel').click()
    dest = Path(output)/'bank.xlsx'
    info.value.save_as(dest)
    wb = openpyxl.load_workbook(dest)
    assert wb['已匹配'].max_row == 5  # 3 groups, including a group with 2 components.
    assert wb['疑似手续费明细'].max_row == 3
    assert wb['手续费汇总'].max_row == 2
    wb.close()
    with page.expect_download() as info:
        page.locator('#export').click()
    dest = Path(output)/'details.csv'
    info.value.save_as(dest)
    assert '材料付款第二笔' in dest.read_text(encoding='utf-8-sig')
    page.locator('#project-demo').click()
    page.locator('#run').click()
    expect(page.locator('#results')).to_be_visible()
    assert page.locator('.stat strong').all_text_contents() == ['2','2','0','0']
    expect(page.locator('#project-summary tbody tr')).to_have_count(4)
    expect(page.locator('#report-warnings')).to_contain_text('项目D')
    expect(page.locator('#direction')).to_be_disabled()
    with page.expect_download() as info:
        page.locator('#export-excel').click()
    dest = Path(output)/'projects.xlsx'
    info.value.save_as(dest)
    wb = openpyxl.load_workbook(dest)
    assert wb['项目往来汇总'].max_row == 5
    wb.close()
    page.evaluate('window.scrollTo(0,0)')
    page.screenshot(path='/tmp/衡账-多项目核对.png', full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.screenshot(path='/tmp/衡账-手机.png', full_page=True)
    page.set_viewport_size({'width':1440,'height':1100})

    # Actual multi-file XLSX upload, explicit project names, and missing project.
    page.reload()
    page.locator('#workflow').select_option('internal')
    headers = ['日期','对方项目','摘要','借方金额','贷方金额','参考号']
    a = xlsx(headers, [[datetime(2026,1,1),'项目B','拨付',1000,None,'AB']])
    b = xlsx(headers, [[datetime(2026,1,1),'项目A','第一笔',None,600,'AB'],[datetime(2026,1,1),'项目A','第二笔',None,400,'AB']])
    c = xlsx(headers, [[datetime(2026,1,1),'项目D','缺少对方',20,None,'CD']])
    page.locator('#project-batch').set_input_files([upload('A.xlsx',a),upload('B.xlsx',b),upload('C.xlsx',c)])
    expect(page.locator('#file-p3').locator('..').locator('.dropzone b')).to_have_text('C.xlsx')
    for id_, name in [('p1','项目A'),('p2','项目B'),('p3','项目C')]:
        page.locator('[data-project-name="'+id_+'"]').fill(name)
    page.locator('#run').click()
    expect(page.locator('#results')).to_be_visible()
    assert page.locator('.stat strong').all_text_contents()==['1','1','0','0']
    expect(page.locator('#report-warnings')).to_contain_text('项目D')

    # Combined sheet uses project-column mapping; aliases resolve both directions.
    page.reload()
    page.locator('#workflow').select_option('internal')
    combined=xlsx(['日期','本方项目','对方项目','借方金额','贷方金额','摘要'],[
        [datetime(2026,1,1),'甲','乙',100,None,'<script>保留为文本</script>'],
        [datetime(2026,1,1),'B','A',None,100,'反向']])
    page.locator('#file-p1').set_input_files(upload('合并表.xlsx',combined))
    expect(page.locator('#file-p1').locator('..').locator('.dropzone b')).to_have_text('合并表.xlsx')
    page.locator('#aliases').fill('甲=A\n乙=B')
    page.locator('#run').click()
    expect(page.locator('#results')).to_be_visible()
    assert page.locator('.stat strong').all_text_contents()==['1','0','0','0']
    page.get_by_role('button',name='已匹配 1',exact=True).click()
    expect(page.locator('#report-body')).to_contain_text('<script>保留为文本</script>')
    expect(page.locator('#report-body script')).to_have_count(0)
    page.locator('#days').select_option('1')
    expect(page.locator('#results')).to_be_hidden()
    assert not errors, errors
    browser.close()
    print('Browser checks passed: bank fee/refund stats, both demo reports, group members, full XLSX/CSV export, 3-file XLSX upload, combined project sheet, aliases, missing project warnings, HTML escaping, mobile layout, stale report invalidation; no JavaScript errors.')
