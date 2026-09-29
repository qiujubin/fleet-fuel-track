# 只读探查油耗考核表结构（不写入、不保存）
import sys
import openpyxl
from openpyxl.utils import get_column_letter

PATH = r"C:\Users\Jubin\Desktop\车辆维修，油耗\油耗考核10月_宏.xlsm"

wb = openpyxl.load_workbook(PATH, data_only=True, keep_links=False)
print("SHEETS:", wb.sheetnames)
print()

targets = [n for n in wb.sheetnames if "油耗" in n]
print("油耗相关 sheet:", targets)
print()

for name in wb.sheetnames:
    ws = wb[name]
    print(f"=== {name}  行数={ws.max_row} 列数={ws.max_column}")
    if name not in targets:
        continue
    # 打印前 4 行，定位表头
    for r in range(1, min(5, ws.max_row) + 1):
        cells = []
        for c in range(1, min(ws.max_column, 30) + 1):
            v = ws.cell(row=r, column=c).value
            if v is not None and str(v).strip() != "":
                cells.append(f"{get_column_letter(c)}={str(v)[:24]}")
        print(f"  第{r}行: " + " | ".join(cells))
    # 数据区样例：最后 2 行
    for r in range(max(1, ws.max_row - 1), ws.max_row + 1):
        cells = []
        for c in range(1, min(ws.max_column, 30) + 1):
            v = ws.cell(row=r, column=c).value
            if v is not None and str(v).strip() != "":
                cells.append(f"{get_column_letter(c)}={str(v)[:24]}")
        print(f"  第{r}行(尾部): " + " | ".join(cells))
    print()
