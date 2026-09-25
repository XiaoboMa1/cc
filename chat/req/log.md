## log
need to write one that covers: - The prompt that is sent at each model call, but transcribed texts inherited from turn 1 (already recoreded in call 1 prompt log) will not show in call2 (turn 2) log? - the reponse given by each ai answerer call, appended after each prompt 

1. revise logging trigger method, this is my local use, I will never push to github so no security concern, I want to be as convenient as possible, effect is: 
```npm run install --debug-log``` or ```./start.bat/ --debug-log` -> automatically create D:\github\meet\debug-log\<month-day-start-hour-and-minute>.log and write there
2. log output is strange: 
D:\meet-debug\prompts.log. it shows there is NO `### user` and only `### interviewer` , is the speaker header attched rightly??




- **去重**：`recentTranscript` 每次都带最近 30 条 segment，同会话连续两次 ask 几乎全部重叠。`diffTranscriptForLog(sessionId, window)` 按 segment `id` 跟踪"这个会话已经写过哪些 id"，只把没写过的行传回；已写过的只计数，不重复打印。
- **不影响真实 prompt**：发给模型的 `messages`（`electron/main.ts` 里 `buildAnswerMessages(...)` 那次调用）完全不变，仍然带完整 30 条上下文。日志走的是**第二次**调用同一个 `buildAnswerMessages`，只把 `recentTranscript` 换成去重后的新行——这样日志格式保证不会跟真实 prompt 的组装逻辑走偏（复用同一个构建函数，不是自己拼字符串）。
- **回复紧跟在 prompt 后面**：`work.then(...)` 拿到最终文本后调 `formatPromptLogResponse(requestId, text)` 追加写入；失败时对称地写 `formatPromptLogError`。





