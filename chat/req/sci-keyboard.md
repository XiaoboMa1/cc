## Screen reference

- **Title bar**: `▶ 开始` / `● 停止` (T-AU), `持续答` (K-A, highlighted when on), `纯文本` / `多模态`, `面:技术` / `面:HR` (interview type), `🎤麦克风` / `🎤录音中` (T-MIC), `隐身开` / `隐身关`, `HUD`, `⚙`, `—`, `✕`.
- **Transcript pane** (left): `清空`; `对方` / `我` bubbles, each with `⚡答` and `译`; while someone is still speaking, a `对方 · 实时` or `我 · 实时` bubble shows the unfinished line; selecting text shows `⚡回答选中`.
- **Answer pane** (right):
  - session bar: dropdown, `✎`, `＋`, `🗑`, `📄简历`, `📋JD`, `清空`;
  - answer turns: tag, label (the question), text; `停` while streaming, `复制` afterwards;
  - screenshot strip, shown while the queue is not empty: `视觉上下文 · N`, thumbnails, `清空截图`;
  - input row: text box, `问`, `📷` (only with `多模态` on).
- **Status bar**: capture state `未采集` / `聆听中` / `对方说话中…` / `转写中…`.

## Keyboard shortcuts

All shortcuts:
- work while the overlay is hidden or does not have keyboard focus, so the interview window (browser, code editor) keeps focus;
- are global: while the app runs, these key combinations do not reach other programs (e.g. the browser's Ctrl+T, an editor's Ctrl+← word jump);
- can be changed or cleared in `⚙`. The table lists the Windows defaults.

| Key          | Same as clicking                                                    | What the user sees                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ctrl+S       | `▶ 开始` / `● 停止`                                                 | T-AU on: button `● 停止`, status `未采集` → `聆听中`. T-AU off: `▶ 开始`, `未采集`; the transcript stays. A press while a start or stop is still in progress is ignored.        |
| Ctrl+H       | —                                                                   | Region capture starts (§5.1).                                                                                                                                                   |
| Esc          | —                                                                   | During region capture only: capture cancelled, nothing added.                                                                                                                   |
| Ctrl+Shift+A | —                                                                   | During region capture only: 1st press marks a corner at the mouse pointer and the rectangle follows the pointer; 2nd press marks the opposite corner and completes the capture. |
| Ctrl+L       | `×` on the newest thumbnail                                         | Newest thumbnail removed, count decreases. Empty strip: nothing happens.                                                                                                        |
| Ctrl+R       | `清空截图`                                                          | All thumbnails removed; the strip disappears. TRA and answer turns unchanged.                                                                                                   |
| Ctrl+Enter   | `⚡答`, applied to everything the ier said since the previous answer | New answer turn (§6.1).                                                                                                                                                         |
| Ctrl+M       | `问`                                                                | The text in the input box is sent (§6.3) and the box empties. Empty box, or `问` disabled: nothing happens.                                                                     |
| Ctrl+D       | `清空` in the answer pane                                           | All answer turns of the session removed; the pane shows its empty hint.                                                                                                         |
| Ctrl+T       | `清空` in the transcript pane                                       | All TRA bubbles of the session removed.                                                                                                                                         |
| Ctrl+B       | `—` to hide, tray icon to show                                      | Overlay hidden / shown.                                                                                                                                                         |
| Ctrl+↑ ↓ ← → | dragging the title bar                                              | Overlay moves 40 px per press.                                                                                                                                                  |

T-MIC has no shortcut; it is the `🎤麦克风` button.

## Screenshot queue

### 5.1 Capturing an S (Ctrl+H)
1. Ctrl+H: the screen freezes into a dimmed still image with the tip `拖动框选要识别的区域，或在两个角各按一次 Ctrl+Shift+A · Esc 取消`. This layer is invisible to screen sharing; with `隐身开` the overlay is not in the still image either.
2. The user marks a region by dragging, or with Ctrl+Shift+A at two corners. A region under 5 × 5 px, or Esc, cancels.
3. A thumbnail is appended at the right end of the strip and the count increases. It shows `…` while ai-ext reads it, then the plain image. Hovering shows E.
4. If extraction fails (e.g. no vision model configured), the thumbnail shows `!` and its tooltip gives the reason; that S adds nothing to answers.
5. Ctrl+H pressed again during step 2 does nothing.

Capturing an S never creates or renames a session and never produces an answer.

**How E is used and how long it lasts**
- Every answer from `⚡答`, `⚡回答选中`, Ctrl+Enter or K-A includes the E of every thumbnail in the strip at that moment, in capture order. `问` / Ctrl+M, `📷` and `译` do not.
- An E stays in use until its thumbnail is removed (Ctrl+L, `×`), the strip is cleared (Ctrl+R, `清空截图`), the session is deleted, or the app is closed. It is extracted once and reused by every answer in between.
- Each session has its own strip.
- An answer requested while a thumbnail still shows `…` waits at `生成中…` until extraction finishes (at most 30 s), so the answer includes that S.

**`📷` — ask about a screenshot at once**
With `多模态` on, `📷` captures a region the same way and asks the vision model about it immediately, with the input box text as the question. The result is an answer turn tagged `截图`; no thumbnail is added.

## Answer triggers

| Trigger                   | The answer responds to                                      | Tag    |
| ------------------------- | ----------------------------------------------------------- | ------ |
| `⚡答` on a bubble         | that bubble's text                                          | `答`   |
| select text → `⚡回答选中` | the selected text                                           | `答`   |
| Ctrl+Enter                | ier lines since the previous Ctrl+Enter / K-A answer (§6.1) | `持续` |
| K-A                       | same as Ctrl+Enter (§6.2)                                   | `持续` |
| `问`, Ctrl+M              | the typed text (§6.3)                                       | `问`   |
| `📷`                       | the typed text, about the captured region                   | `截图` |

Every trigger adds an answer turn at the bottom of the answer pane: tag, label, `生成中…`, then the streamed text. `停` stops it; `复制` copies it once finished. How the answer is written depends on the session's interview type (`prompt.md` §3).

### Ctrl+Enter
- The question is every `对方` bubble that ended after the previous Ctrl+Enter / K-A answer was requested; a question spoken across several bubbles is answered once, as a whole. Answers from `⚡答` and `问` do not move this point.
- If a `对方 · 实时` bubble is showing, the turn waits up to 3 s for that line to finish, so the question includes it. While waiting, the turn shows `生成中…` and the label `对方最新发言`; the label becomes the question once known.
- If nothing is new since the previous Ctrl+Enter / K-A answer (no new `对方` bubble, no `对方 · 实时` bubble, no new thumbnail), nothing happens. Two quick presses give one answer.
- If only thumbnails are new, the answer responds to the latest `对方` bubble again, now with the new E.

### K-A (`持续答` on)
- About 1 s after the ier stops talking (no `对方 · 实时` bubble), an answer turn appears by itself if what the ier said since the previous Ctrl+Enter / K-A answer asks for a response:
  - a question: ends with `?` or `？`, or uses a question form as a whole word: what, how, why, which, when, where, who, can / could / would you, do / did / have / are you, is there;
  - a request: tell me about, walk me through, talk me through, describe, explain, give me an example, go through, elaborate.
- Statements do not trigger it, however long: "You mentioned you once worked as a volunteer", "let me show you the input".
- If the iee starts speaking first (a `我` or `我 · 实时` bubble appears), it does not trigger; Ctrl+Enter still does.
- Lines already answered by Ctrl+Enter are not answered again. The iee's own speech is never answered.
- In live-code, K-A answers each question as soon as the ier stops. When the screenshots must change before the answer (UC-1 steps 9–13), keep K-A off and press Ctrl+Enter when ready.

### Free question (`问`, Ctrl+M)
The typed text goes to the AI without the answer-writing rules, so any question works ("which numbers did I give?", "which model are you?"). The resume, JD, recent TRA and earlier answers are offered as reference; the screenshot queue is not.

## Sessions, topics and resets

### Names and interview type
- `＋` creates `会话 N`, with the interview type of the session shown when `＋` was clicked.
- The first question in a session still named `会话 N` renames it to the question's first 14 characters followed by `…` (a `📷` question with an empty box names it `截图提问`). A name set with `✎`, or an earlier automatic name, is never changed. Screenshots never rename a session.
- `面:技术` / `面:HR` shows the current session's type; clicking toggles it. Each session keeps its own type.

### What each action resets
| Action                          | Thumbnails / E | TRA            | Answer turns   | Interview memo* | Resume, JD, type, name |
| ------------------------------- | -------------- | -------------- | -------------- | --------------- | ---------------------- |
| Ctrl+R, `清空截图`              | cleared        | –              | –              | –               | –                      |
| Ctrl+L, `×`                     | one removed    | –              | –              | –               | –                      |
| Ctrl+D, answer `清空`           | –              | –              | cleared        | –               | –                      |
| Ctrl+T, transcript `清空`       | –              | cleared        | –              | –               | –                      |
| Ctrl+S (stop)                   | –              | –              | –              | –               | –                      |
| another session in the dropdown | that session's | that session's | that session's | that session's  | that session's         |
| `🗑` delete session              | discarded      | deleted        | deleted        | deleted         | deleted                |
| close and reopen the app        | discarded      | –              | –              | –               | –                      |

– = unchanged.
\* The interview memo is a running summary of the answered questions and the facts claimed in the answers, used to keep later answers consistent. It is not shown in the UI; it is visible in the debug log (`prompt.md` §7).

**Topic boundary**
- live-code, next problem: Ctrl+R, Ctrl+D, Ctrl+T. The next answer carries no screenshot, earlier answer or transcript line of the previous problem; the interview memo still lists them.
- live-hr, next topic: Ctrl+D, Ctrl+T.

The session keeps its name, type, resume, JD and capture state.

## Use cases

### UC-1 live-code, answers on Ctrl+Enter (K-A off), two turns, then a new problem
Before: session `my-star` (named by the user), `面:技术`, resume and JD imported, `持续答` off, empty strip, T-AU off.

| #   | Operation                                           | What the user sees                                                                                                                |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ctrl+S (T-AU)                                       | `● 停止`; status `聆听中`.                                                                                                        |
| 2   | click `🎤麦克风` (T-MIC)                             | `🎤录音中`.                                                                                                                        |
| 3   | ier: "let me give you an example. if i"             | `对方 · 实时` bubble, then a `对方` bubble. No answer.                                                                            |
| 4   | Ctrl+H, drag around the problem statement           | thumbnail 1; `视觉上下文 · 1`; `…`, then the image.                                                                               |
| 5   | Ctrl+H, drag around the example                     | thumbnail 2; `视觉上下文 · 2`.                                                                                                    |
| 6   | ier: "what is the number of the operations needed?" | `对方` bubble. No answer.                                                                                                         |
| 7   | Ctrl+Enter                                          | answer turn A1: `持续`, label = lines 3 and 6; `生成中…` until thumbnail 2 is extracted, then the text. Dropdown still `my-star`. |
| 8   | iee reads A1 aloud                                  | `我` bubbles.                                                                                                                     |
| 9   | ier: "what about another case"                      | `对方` bubble. No answer.                                                                                                         |
| 10  | Ctrl+L                                              | thumbnail 2 removed; `视觉上下文 · 1`.                                                                                            |
| 11  | Ctrl+H, drag around the new case                    | thumbnail 3; `视觉上下文 · 2`.                                                                                                    |
| 12  | ier: "what is the time needed?"                     | `对方` bubble.                                                                                                                    |
| 13  | Ctrl+Enter                                          | answer turn A2: `持续`, label = lines 9 and 12; built with thumbnails 1 and 3 and with A1 as an earlier answer.                   |
| 14  | iee answers                                         | `我` bubbles.                                                                                                                     |
| 15  | Ctrl+Enter                                          | nothing.                                                                                                                          |
| 16  | Ctrl+R, Ctrl+D, Ctrl+T                              | strip, answer turns and transcript empty. `● 停止`, `🎤录音中`, `my-star`, `面:技术` unchanged.                                    |
| 17  | ier: "Next one: design a URL shortener."            | `对方` bubble.                                                                                                                    |
| 18  | Ctrl+Enter                                          | answer turn A3, label = line 17; no screenshot, no earlier answer.                                                                |

The dropdown reads `my-star` throughout; no session is created.

### UC-2 live-code with K-A on, turns T1–T4
Before: as UC-1 steps 1–2, then `持续答` on.

| Turn | Operation                                           | What the user sees                                                                                                       |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| T1   | ier: "let me give you an example. if i"             | `对方` bubble. No answer (statement).                                                                                    |
|      | Ctrl+H twice                                        | thumbnails 1 and 2.                                                                                                      |
|      | ier: "what is the number of the operations needed?" | about 1 s after the ier stops: answer turn A1 (`持续`) appears by itself; `生成中…` until both thumbnails are extracted. |
|      | iee reads A1                                        | `我` bubbles.                                                                                                            |
| T2   | ier: "what about another case"                      | about 1 s later: A2 ("what about" is a question), built with the strip as it is at that moment.                          |
|      | Ctrl+L, then Ctrl+H                                 | thumbnail 2 removed, thumbnail 3 added.                                                                                  |
|      | ier: "what is the time needed?"                     | A3, label = this line, with thumbnails 1 and 3.                                                                          |
|      | iee answers                                         | `我` bubbles.                                                                                                            |
| T3   | ier: "You mentioned you once worked as a volunteer" | `对方` bubble. No answer (statement).                                                                                    |
|      | ier: "so you made proudest project there."          | `对方` bubble. No answer (statement).                                                                                    |
|      | Ctrl+Enter                                          | A4, label = both T3 lines.                                                                                               |
|      | iee answers                                         | `我` bubbles.                                                                                                            |
| T4   | ier: "Walk me through that project."                | about 1 s later: A5 ("walk me through" is a request).                                                                    |

Thumbnails 1 and 3 stay in every answer through T4, since the strip was never cleared.

### UC-3 live-hr, several topics, one typed question
Before: on `my-star`, click `＋` → `会话 2` (type `面:技术`, taken from `my-star`); click `面:技术` → `面:HR`; `📄简历` and `📋JD` import this session's files; Ctrl+S; `🎤麦克风`; `持续答` on.

| #   | Operation                                                                                                                          | What the user sees                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | ier: "Tell me about yourself."                                                                                                     | A1 appears by itself; the dropdown `会话 2` becomes `Tell me about …`.                                       |
| 2   | iee reads A1                                                                                                                       | `我` bubbles.                                                                                                |
| 3   | ier: "Tell me about a project you're proud of."                                                                                    | A2: a STAR story of 240–350 words.                                                                           |
| 4   | iee reads A2                                                                                                                       | `我` bubbles.                                                                                                |
| 5   | ier: "What was your role exactly?"                                                                                                 | A3: two to four sentences.                                                                                   |
| 6   | the user types "which numbers did I give for the project?" into the input box, clicks back into the meeting window, presses Ctrl+M | answer turn `问` with the reply; the input box empties.                                                      |
| 7   | Ctrl+D, Ctrl+T                                                                                                                     | answer turns and transcript empty; `Tell me about …`, `面:HR`, capture unchanged.                            |
| 8   | ier: "Why do you want to leave your current job?"                                                                                  | A4, written without the earlier answers or transcript; the facts claimed in A1–A3 reach it through the memo. |