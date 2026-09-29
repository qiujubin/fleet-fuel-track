# 用 COM 把最高/平均时速写回四个「油耗可视化」sheet，并在 I3 嵌入轨迹截图
# 走 Excel COM 是为了保住 .xlsm 里的 VBA 宏（openpyxl 保存会丢宏）
import os
import win32com.client as win32

PATH = r"C:\Users\Jubin\Desktop\车辆维修，油耗\油耗考核10月_宏.xlsm"
OUT = os.path.abspath("outputs")

JOBS = [
    {"sheet": "干线油耗可视化", "max": 107, "avg": 82, "img": "track_粤BPV550.png"},
    {"sheet": "华东油耗可视化 ", "max": 100, "avg": 70, "img": "track_粤BY2J27.png"},
]

app = win32.DispatchEx("Excel.Application")
app.Visible = False
app.DisplayAlerts = False
wb = app.Workbooks.Open(PATH)

try:
    for job in JOBS:
        ws = wb.Worksheets(job["sheet"])
        print(f"\n=== {job['sheet']!r}")
        print(f"  车辆 C2={ws.Range('C2').Value}  开始 C4={ws.Range('C4').Value}  结束 C5={ws.Range('C5').Value}")

        # 1) 写入速度
        ws.Range("H2").Value = job["max"]
        ws.Range("H3").Value = job["avg"]
        print(f"  写入 H2={job['max']}  H3={job['avg']}")

        # 2) 清理已嵌入 I3 的旧图（保证可重复运行）
        cell = ws.Range("I3")
        for i in range(ws.Shapes.Count, 0, -1):
            shp = ws.Shapes(i)
            try:
                if shp.TopLeftCell.Address(False, False) == "I3":
                    shp.Delete()
                    print("  删除 I3 上的旧图片")
            except Exception:
                pass

        # 3) 嵌入图片：不改变单元格大小，宽度贴合列宽、高度按 16:9 比例
        img_path = os.path.join(OUT, job["img"])
        if not os.path.exists(img_path):
            print(f"  !! 图片不存在 {img_path}")
            continue
        w = cell.Width
        h = w * 9 / 16
        print(f"  I3 单元格 {cell.Width:.0f}x{cell.Height:.0f}px -> 图片按列宽 {w:.0f}x{h:.0f}")
        shp = ws.Shapes.AddPicture(
            img_path, LinkToFile=False, SaveWithDocument=True,
            Left=cell.Left, Top=cell.Top, Width=w, Height=h,
        )
        shp.Placement = 1          # xlMoveAndSize：随单元格移动和缩放，不会乱跑
        shp.LockAspectRatio = 0    # 允许贴合单元格
        print(f"  已嵌入 {job['img']}  (Placement=xlMoveAndSize)")

    wb.Save()
    print("\n已保存:", PATH)
finally:
    wb.Close(SaveChanges=False)
    app.Quit()
    print("Excel 已退出")
