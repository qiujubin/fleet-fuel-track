# 用 WPS 自己的 COM（KET.Application）写入，避免 Excel 重排 JSA 控件导致按钮失效
# 目标：四张区域表 干线/华北/华东/华南油耗，第7行起每台车一行
#   B=车牌 E=开始 F=结束 R=最高时速 S=平均时速 T=截图
import os
import win32com.client as win32

PATH = r"C:\Users\Jubin\Desktop\车辆维修，油耗\油耗考核10月_宏.xlsm"
OUT = os.path.abspath("outputs")

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

app = win32.DispatchEx("KET.Application")
app.Visible = False
app.DisplayAlerts = False
wb = app.Workbooks.Open(PATH)

try:
    for job in JOBS:
        ws = wb.Worksheets(job["sheet"])
        r = job["row"]
        ws.Range(f"R{r}").Value = job["max"]
        ws.Range(f"S{r}").Value = job["avg"]
        print(f"[{job['sheet']} 第{r}行] {ws.Range(f'B{r}').Value}  最高={job['max']} 平均={job['avg']}")

        cell = ws.Range(f"T{r}")
        img = os.path.join(OUT, job["img"])
        if not os.path.exists(img):
            print("   !! 缺图", img); continue
        w = cell.Width
        h = w * 9 / 16
        shp = ws.Shapes.AddPicture(img, LinkToFile=False, SaveWithDocument=True,
                                   Left=cell.Left, Top=cell.Top, Width=w, Height=h)
        try:
            shp.Placement = 1
        except Exception:
            pass
        print(f"   已嵌入 {job['img']} ({w:.0f}x{h:.0f})")

    wb.Save()
    print("\n已用 WPS 保存:", PATH)
finally:
    wb.Close(SaveChanges=False)
    app.Quit()
    print("WPS 已退出")
