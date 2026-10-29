"""Entirely fictional workbook matching a common two-row 单位三栏账 layout."""
from io import BytesIO
import openpyxl


def fixture_bytes(alias=False):
    wb=openpyxl.Workbook();ws=wb.active;ws.title='单位三栏账'
    ws.append(['单位三栏账']);ws.append(['2026-01～2026-12']);ws.append(['虚构测试单位']);ws.append([]);ws.append(['本位币:(USD)USD-美元'])
    parent=['2026','', '账簿名称','凭证编号','科目编号','科目名称','往来单位名称','外币名称','摘要','借方发生','','','贷方发生','','','余额','','','','制单人','审核否','记账否','业务号','业务日期','单据编号','责任人','结算方式','结算号','结算日期','经办人','票据号','出纳人']
    child=['月','日','','','','','','','','外币','汇率','金额','外币','汇率','金额','方向','外币','汇率','金额']
    ws.append(parent);ws.append(child)
    def transaction(book,unit,month,day,debit=0,credit=0,base_debit=0,base_credit=0,currency='USD-美元',ref='记1',description='测试明细'):
        row=[None]*32
        for i,v in {0:month,1:day,2:book,3:ref,4:'1221',5:'内部往来',6:unit,7:currency,8:description,9:str(debit),10:'1',11:str(base_debit),12:str(credit),13:'1',14:str(base_credit)}.items():row[i]=v
        ws.append(row)
    def summary(label):
        row=[None]*32
        for i,v in {0:'01',6:'外部客户',7:'USD-美元',8:label,9:'9999',12:'9999',16:'8888'}.items():row[i]=v
        if label=='本期合计':row[2]='甲项目'
        ws.append(row)
    summary('期初余额')
    transaction('甲项目','旧名乙' if alias else '乙项目','01','01',debit=100,base_debit=100,ref='甲1')
    transaction('乙项目','甲项目','03','15',credit=100,base_credit=100,ref='乙99')
    transaction('甲项目','丙项目','04','01',debit=200,base_debit=13,currency='MVR-马尔代夫拉菲亚',ref='AC1')
    transaction('丙项目','甲项目','04','01',credit=190,base_credit=12,currency='MVR-马尔代夫拉菲亚',ref='AC1')
    transaction('甲项目','甲项目','02','01',debit=40,base_debit=40,ref='SELF')
    transaction('甲项目','外部客户','02','01',debit=50,base_debit=50,ref='EXT')
    transaction('乙项目','甲项目','02','01',debit=0,credit=0,base_debit=5,ref='FX')
    summary('本期合计');summary('本年累计')
    for cell_range in ['A1:AF1','A2:AF2','A3:AF3','A4:AF4','A5:AF5','A6:B6','C6:C7','D6:D7','E6:E7','F6:F7','G6:G7','H6:H7','I6:I7','J6:L6','M6:O6','P6:S6']:
        ws.merge_cells(cell_range)
    out=BytesIO();wb.save(out);wb.close();return out.getvalue()


def mapping():
    return {'mode':'split','date':'记账日期','project':'账簿名称','counterparty':'往来单位名称','currency':'原币币种','debit':'原币借方发生额','credit':'原币贷方发生额','baseCurrency':'本币币种','baseDebit':'本币借方发生额','baseCredit':'本币贷方发生额','reference':'凭证编号','description':'摘要','subjectCode':'科目编号','subjectName':'科目名称'}
