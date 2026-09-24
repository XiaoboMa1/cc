# Windows Setup Guide

[简体中文](SETUP.zh-CN.md) · [macOS guide](../macos/SETUP.md)

MeetingCopilot was born on Windows: it captures the other side through **system
loopback audio** (no meeting bot, works with any meeting app) and can hide its
window from screen shares via content protection.

## Requirements

| Component | Requirement |
|---|---|
| OS | Windows 10 / 11 |
| Runtime | Node.js ≥ 20 and npm |
| LLM | Any OpenAI-compatible API key — DeepSeek recommended |
| Local streaming ASR *(default)* | Python 3.10 conda env with `funasr` + `torch`; NVIDIA GPU recommended |
| Experimental MOSS ASR *(optional)* | isolated Python 3.12 conda env; NVIDIA CUDA BF16 first, CPU fallback |
| Local Whisper *(offline fallback)* | `whisper-large-v3-turbo` ONNX weights, DirectML-capable GPU |
| Cloud ASR *(optional)* | Alibaba Cloud DashScope API key, or a MiMo key |

## Install & run

```bash
git clone https://github.com/JWM0203/MeetingCopilot.git
cd MeetingCopilot
npm install        # postinstall applies patches/ (transformers.js patch — do not remove)
npm run build
start.bat          # or: npm start
```

> 🇨🇳 If npm / Electron downloads are slow in China, create a `.npmrc` containing
> `registry=https://registry.npmmirror.com` and
> `electron_mirror=https://npmmirror.com/mirrors/electron/`.

## Audio capture

Nothing to configure. Pressing **▶ Start** captures whole-system loopback audio
(the other party) through Electron's display-media handler; the independent
**🎤** button transcribes your own microphone on a separate channel.

## Local streaming FunASR (default ASR backend)

```bash
conda create -n funasr python=3.10 -y
conda activate funasr
# pick the torch build matching your GPU (cu128 shown for RTX 50-series):
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install funasr modelscope websockets numpy
```

The app **auto-spawns and reaps** the sidecar (`tools/funasr_stream_server.py`,
`ws://127.0.0.1:10097`) — selecting the preset in Settings is all you do. The
selected model downloads automatically from ModelScope on first run (~880 MB
for paraformer, ~1.7 GB for Nano). Resolution order for the Python interpreter:
`MC_FUNASR_PYTHON` env var → project `.venv\Scripts\python.exe` →
`C:\ProgramData\miniconda3\envs\funasr\python.exe` → `python` on PATH.

## Experimental MOSS-Transcribe-Diarize 0.9B

Keep MOSS in an isolated environment so its Transformers 5.x stack cannot disturb the existing FunASR setup:

```powershell
C:/ProgramData/miniconda3/Scripts/conda.exe create -n moss-asr python=3.12 -y
C:/ProgramData/miniconda3/Scripts/conda.exe run -n moss-asr python -m pip install torch==2.11.0 --index-url https://download.pytorch.org/whl/cu128
C:/ProgramData/miniconda3/Scripts/conda.exe run -n moss-asr python -m pip install -r requirements-moss.txt
```

Selecting “MOSS-Transcribe 0.9B” in Settings auto-starts `tools/moss_asr_server.py`. The first run downloads roughly 1.7 GB of BF16 weights from Hugging Face. Device order is CUDA BF16 → CPU FP32. Set `MC_MOSS_PYTHON` to override the interpreter, or `MC_MOSS_DEVICE=cuda:0` / `cpu` to force a device.

> MOSS is not a native streaming model. To keep VRAM stable, MeetingCopilot runs one decode after roughly 700 ms of trailing silence and emits no word-by-word partials. Treat it as an accuracy experiment beside FunASR, not the lowest-first-token-latency option.

## Local Whisper turbo (offline fallback)

Place [`onnx-community/whisper-large-v3-turbo-ONNX`](https://huggingface.co/onnx-community/whisper-large-v3-turbo-ONNX)
under `%APPDATA%/MeetingCopilot/models/onnx-community/whisper-large-v3-turbo-ONNX/`
(`encoder_model_fp16.onnx`, `decoder_model_merged_quantized.onnx`, plus
config/tokenizer files). The encoder runs on the GPU via DirectML.

## Stealth

Content protection (`Stealth` toggle in the title bar, on by default) excludes
the window from OBS, screen shares and screenshots on Windows.

Global hotkeys (defaults; each one can be changed or cleared in Settings).
While the app runs, these combinations are not passed on to other programs:

| Hotkey | Action |
| --- | --- |
| Control+B | hide / show the window |
| Control+Arrow | move the window 40 px |
| Control+S | start system-audio capture |
| Control+H | region screenshot into the visual-context queue (drag, or Control+Shift+A at two corners; Esc cancels) |
| Control+L | remove the last queued screenshot |
| Control+R | clear the screenshot queue |
| Control+Enter | answer now: interviewer lines since the last answer + queued screenshots |
| Control+D | clear this session's answers |
| Control+T | clear this session's transcript |

## Data locations

- Settings / sessions / materials: `%APPDATA%/MeetingCopilot/` (plain JSON)
- API keys: encrypted at rest with Windows DPAPI (`safeStorage`)
