# 从四个区域 sheet（干线/华北/华东/华南油耗）生成任务；顺便核查文件里到底有没有宏
import json
import datetime
import zipfile
import openpyxl

PATH = r"C:\Users\Jubin\Desktop\车辆维修，油耗\油耗考核10月_宏.xlsm"
SHEETS = ["干线油耗", "华北油耗", "华东油耗", "华南油价"]  # 最后一个故意错，下面用模糊匹配修正
SHEETS = ["干线油耗", "华北油耗", "华东油耗", "华南油耗"]
MAX_DAYS = 10

# --- 宏核查 ---
z = zipfile.ZipFile(PATH)
names = z.namelist()
print("== 宏核查 ==")
print("  xl/vbaProject.bin 存在:", "xl/vbaProject.bin" in names)
hit = []
for n in names:
    if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"):
        d = z.read(n).decode("utf8", "ignore").lower()
        if "macro" in d or "<control" in d:
            hit.append(n)
print("  工作表内引用 macro/控件 的:", hit if hit else "无")
print("  其他宏相关部件:", [x for x in names if "vba" in x.lower() or "macro" in x.lower()] or "无")

# --- 任务生成 ---
wb = openpyxl.load_workbook(PATH, data_only=True, keep_links=False)
tasks, skipped = [], []
for name in SHEETS:
    if name not in wb.sheetnames:
        skipped.append((name, "sheet 不存在")); continue
    ws = wb[name]
    for r in range(7, ws.max_row + 1):          # 表头第6行，数据第7行起
        plate = ws.cell(row=r, column=2).value  # B 车牌
        start = ws.cell(row=r, column=5).value  # E 开始
        end = ws.cell(row=r, column=6).value    # F 结束
        if not plate or not str(plate).strip():
            continue
        plate = str(plate).strip()
        if not isinstance(start, datetime.datetime) or not isinstance(end, datetime.datetime):
            skipped.append((f"{name} 第{r}行 {plate}", f"时间非日期({start})")); continue
        span = (end - start).total_seconds() / 86400
        if span > MAX_DAYS:
            skipped.append((f"{name} 第{r}行 {plate}", f"跨度 {span:.1f} 天 > {MAX_DAYS}")); continue
        tasks.append({
            "plate": plate, "sheet": name, "row": r,
            "start": start.strftime("%Y-%m-%d %H:%M:%S"),
            "end": end.strftime("%Y-%m-%d %H:%M:%S"),
            "file": f"track_{plate}.png",
        })

print(f"\n== 待处理 {len(tasks)} 台 ==")
for t in tasks:
    print(f"  [{t['sheet']} 第{t['row']}行] {t['plate']}  {t['start']} ~ {t['end']} ({(t['end'] and 0) or ''})")
print(f"\n== 跳过 {len(skipped)} 行 ==")
for a, b in skipped[:40]:
    print(f"  {a}: {b}")

with open("tasks_from_excel.json", "w", encoding="utf-8") as f:
    json.dump(tasks, f, ensure_ascii=False, indent=2)
print("\n已生成 tasks_from_excel.json")
