# 按正确位置回写：四个区域 sheet（干线/华北/华东/华南油耗）
#   车牌 B | 开始 E | 结束 F | 最高时速 R | 平均时速 S | 截图 T（S 右侧，无表头）
# 走 Excel COM 是为了不动文件里原有的表单控件/宏引用（openpyxl 保存会丢这些）
import os
import json
import win32com.client as win32

PATH = r"C:\Users\Jubin\Desktop\车辆维修，油耗\油耗考核10月_宏.xlsm"
OUT = os.path.abspath("outputs")

# 速度来自 trackshot.js 输出（outputs/results.json 若存在则优先读它）
res_path = os.path.join(OUT, "results.json")
JOBS = []
if os.path.exists(res_path):
    for r in json.load(open(res_path, encoding="utf-8")):
        if r.get("sheet") and r.get("row"):
            JOBS.append({"sheet": r["sheet"], "row": r["row"],
                         "max": r.get("maxSpeed"), "avg": r.get("avgSpeed"), "img": r["file"]})
if not JOBS:
    JOBS = [
        {"sheet": "干线油耗", "row": 7, "max": 107, "avg": 82, "img": "track_粤BPV550.png"},
        {"sheet": "干线油耗", "row": 8, "max": 106, "avg": 76, "img": "track_粤ACJ959.png"},
        {"sheet": "干线油耗", "row": 9, "max": 99, "avg": 66, "img": "track_粤BQN066.png"},
        {"sheet": "干线油耗", "row": 10, "max": 103, "avg": 66, "img": "track_粤BNT993.png"},
        {"sheet": "干线油耗", "row": 11, "max": 114, "avg": 78, "img": "track_京AEP303.png"},
        {"sheet": "华东油耗", "row": 7, "max": 100, "avg": 70, "img": "track_粤BY2J27.png"},
        {"sheet": "华南油耗", "row": 7, "max": 97, "avg": 61, "img": "track_粤A2K1E1.png"},
        {"sheet": "华南油耗", "row": 8, "max": 92, "avg": 67, "img": "track_粤BT3S56.png"},
    ]

app = win32.DispatchEx("Excel.Application")
app.Visible = False
app.DisplayAlerts = False
wb = app.Workbooks.Open(PATH)

try:
    for job in JOBS:
        ws = wb.Worksheets(job["sheet"])
        r = job["row"]
        plate = ws.Range(f"B{r}").Value
        print(f"\n[{job['sheet']} 第{r}行] 车牌={plate}")

        ws.Range(f"R{r}").Value = job["max"]     # 最高时速
        ws.Range(f"S{r}").Value = job["avg"]     # 平均时速
        print(f"  写入 R{r}(最高)={job['max']}  S{r}(平均)={job['avg']}")

        # 清理该单元格上已有的旧图，保证可重复运行
        addr = f"T{r}"
        for i in range(ws.Shapes.Count, 0, -1):
            shp = ws.Shapes(i)
            try:
                if shp.TopLeftCell.Address(False, False) == addr:
                    shp.Delete()
            except Exception:
                pass

        img_path = os.path.join(OUT, job["img"])
        if not os.path.exists(img_path):
            print(f"  !! 缺图片 {img_path}")
            continue
        cell = ws.Range(addr)
        w = cell.Width
        h = w * 9 / 16                    # 16:9，不改单元格大小
        shp = ws.Shapes.AddPicture(img_path, LinkToFile=False, SaveWithDocument=True,
                                   Left=cell.Left, Top=cell.Top, Width=w, Height=h)
        shp.Placement = 1                 # xlMoveAndSize：随单元格移动缩放
        print(f"  嵌入 {job['img']} 于 {addr}（单元格 {cell.Width:.0f}x{cell.Height:.0f}px -> 图 {w:.0f}x{h:.0f}）")

    wb.Save()
    print("\n已保存:", PATH)
finally:
    wb.Close(SaveChanges=False)
    app.Quit()
    print("Excel 已退出")
