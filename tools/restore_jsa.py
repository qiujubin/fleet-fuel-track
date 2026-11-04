# -*- coding: utf-8 -*-
"""
把 JSA 宏部件从 11-03 的完整备份，精准注入到当前（被 Excel 存坏、丢了宏的）表格里。
只动宏相关部件，不碰任何单元格数据 / 图片。

注入内容：
  1. xl/JDEData.bin
  2. xl/jdecontrols/*.xml          （29 个控件定义）
  3. xl/drawings/drawing{1,3,5,7,9}.xml      插入 jdecontrolRef（新分配 rId）
  4. xl/drawings/_rels/drawing*.xml.rels     追加 jdeControlExtension 关系
  5. xl/_rels/workbook.xml.rels              追加 jdeExtension → JDEData.bin
  6. [Content_Types].xml                     补 30 条 Override
"""
import zipfile, re, shutil, sys

CUR = r'C:\Users\Jubin\Desktop\车辆维修，油耗\油耗考核10月_宏.xlsm'
BAK = r'C:\Users\Jubin\Desktop\车辆维修，油耗\backup_track_20261103\油耗考核10月_宏_写入前.xlsm'
OUT = r'C:\Users\Jubin\Desktop\车辆维修，油耗\_restore_work.xlsm'

zc, zo = zipfile.ZipFile(CUR), zipfile.ZipFile(BAK)

BLOCK = re.compile(r'<a:extLst>(?:(?!</a:extLst>).)*?jdecontrolRef.*?</a:extLst>', re.S)
RIDA = re.compile(r'r:id="(rId\d+)"')

patched = {}

# ---- 1) 收集要注入的部件 ----
inject = {'xl/JDEData.bin': zo.read('xl/JDEData.bin')}
for n in zo.namelist():
    if n.startswith('xl/jdecontrols/') and n.endswith('.xml'):
        inject[n] = zo.read(n)
print('注入部件: JDEData.bin + %d 个 jdecontrol' % (len(inject) - 1))

# ---- 2) 处理 5 个 drawing ----
for i in (1, 3, 5, 7, 9):
    dx = 'xl/drawings/drawing%d.xml' % i
    rx = 'xl/drawings/_rels/drawing%d.xml.rels' % i
    bk_xml, bk_rel = zo.read(dx).decode('utf8'), zo.read(rx).decode('utf8')
    cu_xml, cu_rel = zc.read(dx).decode('utf8'), zc.read(rx).decode('utf8')

    mapping = dict(re.findall(
        r'Id="(rId\d+)"[^>]*?Target="\.\./jdecontrols/(jdecontrol\d+\.xml)"', bk_rel))
    blocks = BLOCK.findall(bk_xml)

    used = [int(x) for x in re.findall(r'Id="rId(\d+)"', cu_rel)]
    nxt = (max(used) if used else 0) + 1

    new_blocks, rel_lines = [], []
    for b in blocks:
        old = RIDA.search(b).group(1)
        target = mapping.get(old)
        if not target:
            sys.exit('!! %s 里 %s 找不到对应 jdecontrol' % (dx, old))
        new = 'rId%d' % nxt; nxt += 1
        new_blocks.append(RIDA.sub('r:id="%s"' % new, b))
        rel_lines.append(
            '<Relationship Id="%s" Type="http://www.wps.cn/officeDocument/2020/'
            'jdeControlExtension" Target="../jdecontrols/%s"/>' % (new, target))

    # 按 spPr 顺序插入（形状数与控件数 1:1）
    parts = cu_xml.split('</xdr:spPr>')
    if len(parts) - 1 != len(new_blocks):
        sys.exit('!! %s 形状数 %d 与控件数 %d 不匹配' % (dx, len(parts) - 1, len(new_blocks)))
    rebuilt = ''
    for k, p in enumerate(parts[:-1]):
        rebuilt += p + new_blocks[k] + '</xdr:spPr>'
    rebuilt += parts[-1]

    patched[dx] = rebuilt.encode('utf8')
    patched[rx] = cu_rel.replace('</Relationships>', ''.join(rel_lines) + '</Relationships>').encode('utf8')
    print('%s: 插入 %d 个控件引用，rId %s~rId%d' % (dx, len(new_blocks), '至', nxt - 1))

# ---- 3) workbook.xml.rels ----
wr = 'xl/_rels/workbook.xml.rels'
cu_wr = zc.read(wr).decode('utf8')
used_w = [int(x) for x in re.findall(r'Id="rId(\d+)"', cu_wr)]
new_w = 'rId%d' % (max(used_w) + 1)
patched[wr] = cu_wr.replace(
    '</Relationships>',
    '<Relationship Id="%s" Type="http://www.wps.cn/officeDocument/2018/jdeExtension" '
    'Target="JDEData.bin"/></Relationships>' % new_w).encode('utf8')
print('workbook.xml.rels: 新 rId=%s -> JDEData.bin' % new_w)

# ---- 4) Content_Types ----
ct = zc.read('[Content_Types].xml').decode('utf8')
extra = ['<Override PartName="/xl/JDEData.bin" ContentType="application/octet-stream"/>']
for n in sorted(inject):
    if n.startswith('xl/jdecontrols/'):
        extra.append('<Override PartName="/%s" ContentType="application/vnd.wps-officedocument.'
                     'jdeControl+xml"/>' % n)
patched['[Content_Types].xml'] = ct.replace('</Types>', ''.join(extra) + '</Types>').encode('utf8')
print('Content_Types: 补 %d 条 Override' % len(extra))

# ---- 5) 重建 zip ----
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zw:
    for item in zc.infolist():
        data = patched.get(item.filename) or zc.read(item.filename)
        zw.writestr(item, data)
    for n, data in inject.items():
        zw.writestr(n, data)

print('\n已生成:', OUT)
