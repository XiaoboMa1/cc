# goal


## add trigger method of Keyboard shortcut

## Keyboard Shortcuts

| Shortcut       | Action                   | 
| Esc            | Cancel region select     | Aborts region selection, no screenshot saved
| Ctrl+Enter     | Process screenshots and / or transripts so far
| Ctrl+R         | Reset screenshot session |Clear the queue. Does NOT affect streaming conversation
| Ctrl+S  | Start streaming          | starts audio capture
| Ctrl+D   | Reset prveious AI re in this session         | equal effect as click "清空" for transcribe
| Ctrl+T   | Reset trasncripting in this session         | equal effect as click "清空" for transcribe
| Ctrl+L                                                |
| Ctrl+B         | Toggle window visibility | Show/hide overlay window 
| Ctrl+Arrow     | Move window up / down / left /right            | Repositions overlay window 
| Ctrl+M         | send user typed question           | 
Removed shortcuts: Ctrl+M, 

## Operation Steps by Use Case

### Offline (leetcode, no interviewer)

```
1. Ctrl+H              — screenshot the problem
   [region mode: overlay appears → Ctrl+Shift+A to mark corner 1 → move cursor → Ctrl+Shift+A for corner 2]
   (repeat Ctrl+H for multiple screenshots)
2. Ctrl+Enter           — ai-ext extracts problem, ai-1st generates code solution
   [view switches to solutions]
3. Ctrl+H              — screenshot your code + errors
4. Ctrl+Enter           — ai-dbg analyzes and suggests fixes (offline mode: minimal fix)
   [repeat 3-4 for iterative debugging]
5. Ctrl+R              — reset to start a new problem


## screenshot 
now Each screenshot will be immediately send to one call, we need to:
1. support a queue for many S
2. Support removing and clearing the queue of S by keyboard shortcut: 

2.1 - ctrl + H -> take S
- ctrl + L -> delete last S
- ctrl + R -> clear all S in queue

2.2 E for S1 and S2 obtained in T1 should be cached since then until ctrl + R or delete session (S can not outlast session) , it will T2


i want this effect:
```order of action
[state 1]
T-AU -> T-MIC -> mode K-A
-> ier: let me Give you an example. if i
-> T-SCI 
-> ier: what is the number of the operations needed?

[state 2]
(AU, MIC, K-A keep running)
-> ier: what about another case
-> ctrl + L -> remove S2
-> T-SCI -> get S3 
-> ier: what is the time needed?
```

At state 1, prompt-for-ai-ans-t1 should look like:
```
<sys-prompt>
<user>
## conversation
### interviewer
let me Give you an example. if i
what is the number of the operations needed?
## visual context
<E1,E2>
```

At state 2, prompt-for-ai-ans-t2 should look like:
```
<sys-prompt>
<user>
## conversation
### interviewer
let me Give you an example. if i
what is the number of the operations needed?
### interviewee
<A>
### interviewer
what about another case
what is the time needed?
## visual context
<E1,E3>
```

## Keyboard-driven example: live-code (screenshot + streaming)

K-A here isn't a toggle: it just means Ctrl+Enter can be pressed again and again — TRA and the screenshot queue keep accumulating between presses instead of resetting after each one.

Setup: the session dropdown already reads `my-star`; nothing is streaming yet.

1. **Ctrl+S** — starts audio capture (mic capture is a separate toggle, not a hotkey yet). No new bubble appears; the status indicator switches to "listening." Dropdown still reads `my-star`.
2. Interviewer talks: "let me give you an example, if I..." then "what is the number of operations needed?" — no key pressed. TRA accumulates these two lines silently; nothing visible changes yet.
3. **Ctrl+Enter** — a new answer bubble streams in below, still under `my-star`. Since this is the first question in this session, `my-star`'s name does not change — a screenshot or a question never overwrites a name the user already gave the session; auto-naming only ever fills in a session that still has its placeholder name.
4. **Ctrl+H** (drag a region) — a small thumbnail appears in a strip above the message box, under `my-star`. It briefly shows "extracting…" then settles. The dropdown is untouched — taking a screenshot never renames or creates a session.
5. **Ctrl+H** again — a second thumbnail appends next to the first. Queue: [shot 1, shot 2].
6. Interviewer talks: "what about another case?" — TRA keeps accumulating silently.
7. **Ctrl+L** — the most recently taken thumbnail (shot 2) disappears from the strip. Queue: [shot 1].
8. **Ctrl+H** — a new thumbnail appends. Queue: [shot 1, shot 3].
9. Interviewer talks: "what is the time needed?"
10. **Ctrl+Enter** — a second answer bubble streams in below the first, still under `my-star`. Its prompt carries: the first Q&A as prior context, the two new interviewer lines from steps 6 and 9 as the new question, and the two screenshots still queued (1 and 3) as visual context.

Across the whole sequence — 2 answers, 3 screenshots taken, 1 undone — the dropdown never leaves `my-star`, and it never turns into something auto-generated like "截图对话". That only happens the first time a new, still-unnamed session gets its first question.

### Session boundary in this use case
Nothing above resets state, so all 10 steps are one session (one problem). A new session — the interviewer moves to the next problem — starts when the user presses **Ctrl+R** (clears the screenshot queue), together with **Ctrl+D** (clears prior AI answers) and **Ctrl+T** (clears TRA), so nothing from the old problem leaks into the next prompt. The dropdown container (`my-star`) does not have to change for this — one named session can hold several problems back to back.

## live-hr (streaming only, no screenshots)

Same shape without screenshots: **Ctrl+S** starts audio, TRA accumulates silently as the interviewer talks, **Ctrl+Enter** answers from TRA alone — the prompt has no visual-context section at all, not an empty one. **Ctrl+H / Ctrl+L / Ctrl+R** are never used. A new session (new behavioral topic) only needs **Ctrl+D** + **Ctrl+T**.

