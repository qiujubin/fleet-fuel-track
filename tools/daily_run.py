# -*- coding: utf-8 -*-
"""
每日一键跑批：读表 → 截图+速度 → WPS写入 → 验证 → 备份 → git

设计原则（省 token 的关键）：
- 正常路径只输出紧凑摘要（每车一行 + 一行总检）
- 异常驱动：只有出问题时才展开详细日志
- 验证逻辑不删，只是不把中间过程倒进上下文

用法：
  python daily_run.py            # 全流程
  python daily_run.py --no-git   # 跳过 git 提交推送
  python daily_run.py --no-shot  # 跳过截图（只重写已有结果，调试用）
"""
import subprocess
import sys
import os
import json
import shutil
import zipfile
import datetime

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(BASE, "tools")
OUT = os.path.join(BASE, "outputs")
NODE = r"C:\Users\Jubin\.workbuddy\binaries\node\versions\22.22.2\node.exe"
PY = sys.executable
XLSM = r"C:\Users\Jubin\Desktop\车辆维修，油耗\油耗考核10月_宏.xlsm"
SHEETS = ["干线油耗", "华北油耗", "华东油耗", "华南油耗"]

NO_GIT = "--no-git" in sys.argv
NO_SHOT = "--no-shot" in sys.argv

def run(cmd, cwd=BASE):
    """执行命令，返回 CompletedProcess。命令本身和输出都尽量不进上下文（摘要驱动）。"""
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=1800)

def die(msg):
    print("!! " + msg)
    sys.exit(1)

# ---------- 1. 占用检查 ----------
try:
    f = open(XLSM, "r+b"); f.close()
except Exception as e:
    die(f"表格被占用（先关掉 WPS/Excel 里的这个文件）: {e}")

# ---------- 2. 备份 ----------
today = datetime.date.today().strftime("%Y%m%d")
bak_dir = os.path.join(os.path.dirname(XLSM), f"backup_track_{today}")
os.makedirs(bak_dir, exist_ok=True)
bak = os.path.join(bak_dir, "油耗考核10月_宏_写入前.xlsm")
shutil.copy2(XLSM, bak)

# ---------- 3. 生成任务 ----------
r = run([PY, os.path.join(TOOLS, "excel_tasks2.py")])
if r.returncode != 0:
    print(r.stdout[-2000:]); die("excel_tasks2.py 失败")
tasks = json.load(open(os.path.join(BASE, "tasks_from_excel.json"), encoding="utf-8"))
print(f"[任务] {len(tasks)} 台待处理（备份 {bak_dir}）")
if not tasks:
    print("今天没有有效车辆，结束。")
    sys.exit(0)

# ---------- 4. 截图 + 速度 ----------
if not NO_SHOT:
    r = run([NODE, os.path.join(TOOLS, "trackshot.js"), "--tasks=tasks_from_excel.json"])
    log = r.stdout or ""
    # 从日志提取异常（FAILED / 速度未取到），正常行丢弃
    fails = [l for l in log.splitlines() if "FAILED" in l]
    nospeed = [l for l in log.splitlines() if "(未取到)" in l or "最高速度: 0km/h" in l]
    if r.returncode != 0 or fails:
        print(log[-3000:]); die(f"截图失败 {len(fails)} 台，日志见上")
    if nospeed:
        print("[警告] 速度未取到的车（需单独重跑）：")
        for l in nospeed: print("   " + l.strip())
    results = json.load(open(os.path.join(OUT, "results.json"), encoding="utf-8"))
    n_ok = len([x for x in results if x.get("maxSpeed") and x.get("avgSpeed")])
    print(f"[截图] {n_ok}/{len(results)} 台完成（含速度）")

# ---------- 5. WPS 写入 ----------
r = run([PY, os.path.join(TOOLS, "fill_wps2.py")])
if r.returncode != 0 or "!!" in (r.stdout or ""):
    print(r.stdout[-2000:]); die("fill_wps2.py 写入失败")

# ---------- 6. 验证（JSA 宏 + 写入值 + 图片数，只输出结论） ----------
import openpyxl
zo, zc = zipfile.ZipFile(bak), zipfile.ZipFile(XLSM)
jsa_ok = (
    zo.read("xl/JDEData.bin") == zc.read("xl/JDEData.bin")
    and all(zo.read(x) == zc.read(x) for x in zo.namelist()
            if "jdecontrols/" in x and x.endswith(".xml") and x in zc.namelist())
    and all(zo.read(x) == zc.read(x) for x in zo.namelist()
            if "ctrlProps/" in x and x.endswith(".xml") and x in zc.namelist())
)
lost = [x for x in zo.namelist() if not x.endswith("/") and x not in zc.namelist()]
if not jsa_ok or lost:
    die(f"JSA 宏校验失败！一致={jsa_ok} 丢失={lost} —— 已有备份 {bak}")

wb = openpyxl.load_workbook(XLSM, data_only=True, keep_links=False)
written = []
img_cnt = {}
for n in SHEETS:
    ws = wb[n]
    img_cnt[n] = len(getattr(ws, "_images", []))
    for row in range(7, ws.max_row + 1):
        mx = ws.cell(row=row, column=18).value
        if mx not in (None, 0):
            written.append((n, row, str(ws.cell(row=row, column=2).value).strip(),
                            mx, ws.cell(row=row, column=19).value))
n_img = sum(img_cnt.values())
if len(written) != len(tasks):
    die(f"写入行数不符：任务 {len(tasks)}，实际 {len(written)} —— 备份在 {bak}")

print("[写入] " + " | ".join(f"{p} {m}/{a}" for _,_,p,m,a in written))
print(f"[验证] JSA宏逐字节一致 ✓  无文件丢失 ✓  图片 {n_img} 张（{img_cnt}）")

# ---------- 7. 写当日记忆 + git ----------
mem = os.path.join(BASE, ".workbuddy", "memory", f"{datetime.date.today()}.md")
with open(mem, "a", encoding="utf-8") as fp:
    fp.write(f"\n## {datetime.date.today()} 一键跑批\n\n")
    fp.write("| sheet | 行 | 车牌 | 最高 | 平均 |\n|---|---|---|---|---|\n")
    for n, row, p, m, a in written:
        fp.write(f"| {n} | {row} | {p} | {m} | {a} |\n")
    fp.write(f"\nJSA 宏逐字节一致 ✓，图片 {n_img} 张。备份 {bak_dir}。\n")

if not NO_GIT:
    env = dict(os.environ, GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_github -o StrictHostKeyChecking=no")
    for args in (["git", "add", "-A"], ["git", "commit", "-q", "-m", f"{today} 跑批记录"]):
        subprocess.run(args, cwd=BASE, capture_output=True, env=env, timeout=120)
    pr = subprocess.run(["git", "push", "-q", "origin", "master"], cwd=BASE,
                        capture_output=True, text=True, env=env, timeout=300)
    print("[git] " + ("已提交并推送 ✓" if pr.returncode == 0 else f"推送失败：{pr.stderr[-300:]}"))

print("\n[完成] 全流程结束")
