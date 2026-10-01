# 用 WPS COM 回写（唯一允许的通道：Excel COM 会重排 JSA 控件导致按钮失效）
#   R=最高时速  S=平均时速  T=原尺寸浮动截图（不缩放、不嵌入，嵌入由用户手动做）
import os
import json
from PIL import Image
import win32com.client as win32

PATH = r"C:\Users\Jubin\Desktop\车辆维修，油耗\油耗考核10月_宏.xlsm"
OUT = os.path.abspath("outputs")

res = json.load(open(os.path.join(OUT, "results.json"), encoding="utf-8"))
jobs = [r for r in res if r.get("sheet") and r.get("row") and r.get("maxSpeed") is not None]
print("待写入", len(jobs), "台")

app = win32.DispatchEx("KET.Application")
app.Visible = False
app.DisplayAlerts = False
wb = app.Workbooks.Open(PATH)

try:
    for j in jobs:
        ws = wb.Worksheets(j["sheet"])
        r = j["row"]
        ws.Range(f"R{r}").Value = j["maxSpeed"]
        ws.Range(f"S{r}").Value = j["avgSpeed"]
        plate = ws.Range(f"B{r}").Value
        print(f"[{j['sheet']} 第{r}行] {plate}  最高={j['maxSpeed']} 平均={j['avgSpeed']}")

        img = os.path.join(OUT, j["file"])
        if not os.path.exists(img):
            print("   !! 缺图", img); continue
        w_px, h_px = Image.open(img).size          # 原图像素尺寸
        w_pt, h_pt = w_px * 0.75, h_px * 0.75      # px -> point（96 DPI）
        cell = ws.Range(f"T{r}")
        # 先清掉该位置上的旧图，避免重复叠加
        # 按坐标匹配删旧图（TopLeftCell 对浮动图片不可靠，曾导致重复叠加）
        for i in range(ws.Shapes.Count, 0, -1):
            try:
                s = ws.Shapes(i)
                if abs(float(s.Top) - float(cell.Top)) < 5 and abs(float(s.Left) - float(cell.Left)) < 5:
                    s.Delete()
            except Exception:
                pass
        shp = ws.Shapes.AddPicture(img, LinkToFile=False, SaveWithDocument=True,
                                   Left=cell.Left, Top=cell.Top, Width=w_pt, Height=h_pt)
        shp.Placement = 2      # xlMove：位置跟随单元格，尺寸保持不变（不会被引单元格压小）
        print(f"   浮动图 {j['file']} 原尺寸 {w_px}x{h_px}px -> {w_pt:.0f}x{h_pt:.0f}pt")

    wb.Save()
    print("\n已用 WPS 保存:", PATH)
finally:
    wb.Close(SaveChanges=False)
    app.Quit()
    print("WPS 已退出")
