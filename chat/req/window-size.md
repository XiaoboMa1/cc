`iee`= interviewee (answerer) `ier`=interviewer
`sys-au` = system audio `mic` = system microphone
assume:  `ier` voice only comes from `sys-au`；only one system mic

# issue 
## 1 prompts send to ai do not distinguish between iee and ier 
example:
```
iee press button "麦克风"，采集设备=”default"
iee press botton "开始“ 
- sys-au plays english podcast
- at same time, iee is speaking chinese
what ai recieves:

```Even though it's actually investing in exactly the thing that you said that you wanted to invest, of...

如果我把中文和英文混在一起说，你能听出来吗？它会被插在哪个位置？会不会有标记？bring it. try by us. 大概一千次左右。

they don't like the best possible ... 
```

No marker of roles, we need to fix this:
- on "collect audio" part, identify and mark iee from ier, Based on where that transcript text comes from (sys-au or mic) 
- In assembling the prompt, add marker `### interbiewer:` and `### interviee:` before  one text segment

## 2

1. Currently the system claims: 
```
iee press button "麦克风"，采集设备=”default" -> speaking chinese
at same time, zoom meeting mic is on, 采集设备 = default" (同一设备)
```
and what iee speaks to program will NOT be heard by ier in meeting.
is this true??
- why? i cannot believe
- if The reason is because of hardware only, and This programs logic has fully supported that, does it mean this " What is that is not heard in meeting" claim = true if you have 2 mic, in zoom, select 采集设备 = default", in this program, select 采集设备 = "mic 2"??





## 窗口缩小时的布局挤压
在窗口缩小（Responsive Layout）时存在以下缺陷：

1. **顶部控制按钮折行堆叠：** 窗口变窄导致顶部水平空间不足时，右上角的最小化（`-`）与关闭（`X`）按钮未能保持水平排列，而是发生异常折行，破坏了顶部栏的单行布局规则。

2. **右侧面板元素无缓冲溢出：** 右侧面板宽度减少时，缺乏滚动条或溢出隐藏（Overflow Menu）机制。文件标签被直接从中部截断（显示为 `Coforge->`），右侧的 `JD` 文件标签及右侧专属的 `清空` 按钮被完全挤出可视区域，导致用户在窄屏状态下无法对这些隐藏元素进行交互。 

---
**宽窗口状态**

* **顶部栏（右上侧）：** `开始`、`持续答`、`纯文本`、`答:EN`、`麦克风`、`隐身开`、`HUD`、齿轮图标（设置）、`-`（最小化）和 `X`（关闭）按钮全部存在，且呈完整的单行水平排列。

* **左侧转录区工具栏（右上）：** `清空` 按钮存在。

* **右侧AI区工具栏（从左至右）：** 下拉菜单、铅笔图标（编辑）、`+`（添加）、垃圾桶图标（删除）、`Coforge-Xiaobo Ma-CV.pdf` 文件标签、`JD` 文件标签，以及最右侧的 `清空` 按钮全部存在。

* **底部区域：** 左下角存在 `未采集`、`GPU`、`ASR ✓`、`AI ✓`、`声音 -` 状态标签；右下角输入框右侧存在 `问` 按钮。


**窄窗口状态 (image.png)**

* **顶部栏（右上侧）：** 功能按钮（`开始`至齿轮图标）单行存在；`-`（最小化）与 `X`（关闭）按钮发生位移，在界面的最右侧被迫换行，形成上下垂直堆叠。

* **左侧转录区工具栏：** `清空` 按钮正常存在并保持在原位。

* **右侧AI区工具栏：** 下拉菜单、铅笔图标、`+`、垃圾桶图标存在；文件标签被截断，仅显示为 `Coforge->`，后续的 `JD` 标签与该区域的 `清空` 按钮在当前视图中不可见。

* **底部区域：** 左下角状态标签与右下角的 `问` 按钮均正常存在，未受挤压影响。

---
When the size is limited, implement my priority based on What the user will most frequently click:
- width 右侧AI区 = width 左侧转录区 
- 右侧AI区 `清空` -> 下拉菜单 -> `+`、垃圾桶 -> 铅笔图标 -> 文件标签, `JD` 标签 


## mouse visible
1. When the mouse moves on the window,  The screen capture still records it
2. for each sequence where
```mouse On browser -> mouse move to window and click window area (e.g. "answer" or "setting"), focus loss is detected
how to solve this?
- how to fix?  What is the best that can be done for windows 11?


## pure question
using the ctrl-shift-s  Keyboard shortcut to take screenshots, will it be detected by browers that can detect " Has screen shot been taken"??