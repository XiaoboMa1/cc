# Requirement: debug log

Started with `--debug-log`, the app writes one file per launch that shows, for every model call in `prompt.md` "Which model and prompt each operation uses", the messages sent and the reply. A text the file has already shown is shown again only as a reference to its first appearance, so the entry of a later answer shows in full only what is new since the earlier ones.

## Turning it on
- Launch with the debug log on — `start.bat --debug-log`, `npm run start:debug-log` or `npm run dev:debug-log`: `debug-log/<MM>-<DD>-<HHmm>.log` appears in the app folder, named by the launch time. Images sent during that launch are saved in `debug-log/<MM>-<DD>-<HHmm>/`.
- `MC_PROMPT_LOG=<path>` writes the log to that path instead.
- Without either, no file or folder is created.

## What each operation writes

| Operation | Written to the log |
|---|---|
| `⚡答`, `⚡回答选中`, Ctrl+Enter, K-A, `问`, Ctrl+M, `📷` | entry `A<n>`: the answer request, then the answer. `📷` also saves the image as `A<n>.png` |
| Ctrl+H | entry `S<n>`: the image saved as `S<n>.png`, the extraction request, then E as reply `E<n>` |
| an answer turn `答`, `持续` or `问` finishing | entry `M<n>`: the memo update request, then the new memo as reply `M<n>` |
| `译` | entry `TR<n>`: the translation request, then the Chinese text |
| Ctrl+L, `×`, Ctrl+R, `清空截图`, Ctrl+D, Ctrl+T | one event line |
| `停` on a streaming answer; `×` on a thumbnail still showing `…` | that entry ends with a `stopped` line and the text received so far |
| an ier or iee line, Ctrl+S, `🎤麦克风`, a Ctrl+Enter that does nothing | nothing |

- `A<n>` counts every answer turn (`答`, `持续`, `问`, `截图`) in order, `S<n>` every capture, `M<n>` every memo version, `TR<n>` every translation. Counting starts at 1 in each file.
- Event lines:
  ```text
  ----- 14:31:50 · "my-star" · Ctrl+L: S2 removed; strip S1 -----
  ----- 14:34:02 · "my-star" · Ctrl+R: strip cleared -----
  ----- 14:34:02 · "my-star" · Ctrl+D: answer turns cleared; the memo stays -----
  ----- 14:34:03 · "my-star" · Ctrl+T: transcript cleared; bubble numbers restart at #1 -----
  ```

## Entry layout

```text
===== <id> · <tag or call> · <operation> · "<session>" · <HH:mm:ss> · <model> =====
[system]
…
[user]
…
----- <id> · <seconds> s · tokens in <n> (cached <n>) / out <n> -----
<reply>
```

- The file starts with one line: launch time, text model, vision model.
- A failed call ends its entry with `----- <id> error · <seconds> s · <message> -----`.
- Token counts appear when the provider reports them; `cached` is the part of the request the provider reused from an earlier one.
- An image in a request shows as `[[image S3.png 1180×420]]`.
- A reply is written when it arrives. Its line names the entry, so two calls running at the same time can interleave.

## Repeated text

Each text below is shown in full the first time, after its label; after that, anywhere in the file, as `[[= label]]`.

| Text | First time | Later |
|---|---|---|
| answer prompt of an interview type (`prompt.md` "Answer prompt by interview type") | `[[PROMPT-tech]]`, `[[PROMPT-hr]]` | `[[= PROMPT-tech]]` |
| system prompt of extraction, memo update, translation, `📷` | `[[SYS-ext]]`, `[[SYS-memo]]`, `[[SYS-tr]]`, `[[SYS-shot<n>]]` | `[[= SYS-ext]]` |
| `<resume>`, `<job_description>` block | `[[RESUME<n> <file>]]`, `[[JD<n> <file>]]` | `[[= RESUME1]]` |
| a transcript bubble | `[[#<n>]]` at the start of its line | `[[= #<n>]]`; consecutive bubbles inside one `<interviewer>` or `<interviewee>` element: `[[= #4–#5]]` |
| E | reply of `S<n>` | `[[= E<n>]]` |
| memo | reply of `M<n>`; a memo kept from an earlier launch: `[[M0]]` | `[[= M<n>]]` |
| label and answer of answer turn `A<n>` | the `<question>` of `A<n>` (`问`: the typed text); the reply of `A<n>` | `[[= A<n> label]]`, `[[= A<n>]]` |
| an earlier answer turn from a previous launch | `[[H<n>]]` | `[[= H<n>]]` |

- Bubbles are numbered `#1, #2, …` per session in transcript order, restarting after Ctrl+T. `[[= #<n>]]` names the bubble #n of the entry's session shown most recently.
- A `<resume>`, `<job_description>` or `📷` system prompt with different text (another file, or a different length limit in `prompt.md` "Answer request" and "Other prompts") gets the next number.

Three fixed parts of the answer request (`prompt.md` "Answer request", messages 1–3) are shown as one line each:

| Line | Stands for |
|---|---|
| `[system] [[= PROMPT-tech]] [[= RESUME1]] [[= JD1]]` | message 1 |
| `[memo] [[= M3]]` | message 2: user `<interview_memo>` holding M3, then assistant `Noted. I'll stay consistent with it.` |
| `[history] [[= A1–A4]]` | message 3: for each turn, user `<question>` holding its label, then assistant holding its answer (in a `问` request, the label without `<question>`) |

An earlier answer turn whose label or answer differs from what its own entry showed is written out as its two messages instead: an answer stopped with `停`, or a `📷` turn with an empty box, whose label `解读当前截图` is not the text that was sent.

Rules:
1. Removing the labels and replacing every `[[= …]]` with the text it names gives exactly the request described in `prompt.md`.
2. Only the texts in the table are replaced. Tags and instructions (`<question>`, `<screenshot index="2">`, `Answer the <question> now, …`) are shown as sent.
3. A bubble whose text grew after the log showed it (the speaker went on and the new words joined the same bubble) is shown again in full as `[[#<n> grown]]`.
4. Each memo version is shown in full as the reply of its `M` entry, not as a difference from the previous version: it is a separate reply and is judged as a whole.

## UC-1 in the log
UC-1 is defined in `sci-keyboard.md`; the requests are those of `prompt.md` "Requests in the use cases".

| # | Operation | Written to the log |
|---|---|---|
| 1–3 | Ctrl+S, `🎤麦克风`, ier speaks | nothing |
| 4 | Ctrl+H | `S1`, reply `E1` |
| 5 | Ctrl+H | `S2`, reply `E2` |
| 6 | ier speaks | nothing |
| 7 | Ctrl+Enter | `A1`: the answer prompt, resume and JD in full for the first time, bubbles #1 and #2; then `M1` |
| 8–9 | iee reads A1, ier speaks | nothing |
| 10 | Ctrl+L | event line |
| 11 | Ctrl+H | `S3`, reply `E3` |
| 12 | ier speaks | nothing |
| 13 | Ctrl+Enter | `A2`: new text is only bubbles #3–#5 and the answer; then `M2` |
| 14–15 | iee answers, Ctrl+Enter with nothing new | nothing |
| 16 | Ctrl+R, Ctrl+D, Ctrl+T | three event lines |
| 17 | ier speaks | nothing |
| 18 | Ctrl+Enter | `A3`: memo M2, no screenshot, no earlier answer, bubble #1; then `M3` |

The file after UC-1 (long texts cut with `…` in this example only):

```text
# MeetingCopilot debug log · 09-25 14:30 · text deepseek-chat · vision qwen-vl-max

===== S1 · ai-ext · Ctrl+H · "my-star" · 14:30:52 · qwen-vl-max =====
[system]
[[SYS-ext]]
You extract information from a screenshot. Extract only: do not answer, solve or comment.
…
[user]
[[image S1.png 1180×640]]
Extract the key information from this screenshot.
----- E1 · 3.4 s · tokens in 1 020 / out 70 -----
Minimum Operations to Make Array Equal
arr[i] = 2 * i + 1 for 0 <= i < n. One operation: subtract 1 from arr[x] and add 1 to arr[y].
Return the minimum number of operations to make all elements equal.

===== S2 · ai-ext · Ctrl+H · "my-star" · 14:31:05 · qwen-vl-max =====
[system] [[= SYS-ext]]
[user]
[[image S2.png 1180×300]]
Extract the key information from this screenshot.
----- E2 · 2.1 s · tokens in 880 / out 12 -----
Example 1: n = 3 → 2

===== A1 · 持续 · Ctrl+Enter · "my-star" · 14:31:20 · deepseek-chat =====
[system]
[[PROMPT-tech]]
<role>
You are my teleprompter in a live technical interview: …
</role>
…
</input_format>

[[RESUME1 cv.pdf]]
<resume>
…
</resume>

[[JD1 jd.txt]]
<job_description>
…
</job_description>
[user]
<visual_context>
<screenshot index="1">
[[= E1]]
</screenshot>
<screenshot index="2">
[[= E2]]
</screenshot>
</visual_context>

<conversation>
<interviewer>
[[#1]] let me give you an example. if i
[[#2]] what is the number of the operations needed?
</interviewer>
</conversation>

<question>
[[= #1–#2]]
</question>

Answer the <question> now, in the words I will say.
----- A1 · 4.1 s · tokens in 3 890 (cached 3 200) / out 120 -----
The array is one, three, five and so on, so its average is n, and every element has to end at n.
Each operation moves one unit, so the count is how far the lower half has to climb.
That's n squared over four, rounded down. For n equal to three that's two, which matches the example.

===== M1 · memo update · after A1 · "my-star" · 14:31:25 · deepseek-chat =====
[system]
[[SYS-memo]]
You keep the running notes of a job interview. …
[user]
<current_notes>
empty
</current_notes>

<new_exchange>
<question>
[[= A1 label]]
</question>
<answer>
[[= A1]]
</answer>
</new_exchange>
----- M1 · 2.2 s · tokens in 610 / out 90 -----
<asked_questions>
Minimum operations to make arr[i] = 2i + 1 all equal
</asked_questions>
<claimed_facts>
Every element ends at n; the answer is n squared over four, rounded down
</claimed_facts>
<interviewer_focus>
A closed form, checked against the examples
</interviewer_focus>
<cautions>
none
</cautions>

----- 14:31:50 · "my-star" · Ctrl+L: S2 removed; strip S1 -----

===== S3 · ai-ext · Ctrl+H · "my-star" · 14:31:58 · qwen-vl-max =====
[system] [[= SYS-ext]]
[user]
[[image S3.png 1180×420]]
Extract the key information from this screenshot.
----- E3 · 2.6 s · tokens in 940 / out 20 -----
Example 2: n = 6 → 9
Constraints: 1 <= n <= 10^4

===== A2 · 持续 · Ctrl+Enter · "my-star" · 14:32:30 · deepseek-chat =====
[system] [[= PROMPT-tech]] [[= RESUME1]] [[= JD1]]
[memo] [[= M1]]
[history] [[= A1]]
[user]
<visual_context>
<screenshot index="1">
[[= E1]]
</screenshot>
<screenshot index="2">
[[= E3]]
</screenshot>
</visual_context>

<conversation>
<interviewer>
[[= #1–#2]]
</interviewer>
<interviewee>
[[#3]] so every element has to end at n, and the lower half climbs up to it
</interviewee>
<interviewer>
[[#4]] what about another case
[[#5]] what is the time needed?
</interviewer>
</conversation>

<question>
[[= #4–#5]]
</question>

Answer the <question> now, in the words I will say.
----- A2 · 3.2 s · tokens in 4 620 (cached 3 200) / out 70 -----
It's constant time: one multiplication and one division, so O of one, and O of one space.
For n equal to six that's thirty-six over four, nine, which matches the second case.

===== M2 · memo update · after A2 · "my-star" · 14:32:36 · deepseek-chat =====
[system] [[= SYS-memo]]
[user]
<current_notes>
[[= M1]]
</current_notes>

<new_exchange>
<question>
[[= A2 label]]
</question>
<answer>
[[= A2]]
</answer>
</new_exchange>
----- M2 · 2.4 s · tokens in 820 / out 120 -----
<asked_questions>
Minimum operations to make arr[i] = 2i + 1 all equal
Time needed for the formula
</asked_questions>
<claimed_facts>
Every element ends at n; the answer is n squared over four, rounded down
The formula runs in O(1) time and O(1) space
</claimed_facts>
<interviewer_focus>
A closed form, checked against the examples; complexity
</interviewer_focus>
<cautions>
none
</cautions>

----- 14:34:02 · "my-star" · Ctrl+R: strip cleared -----
----- 14:34:02 · "my-star" · Ctrl+D: answer turns cleared; the memo stays -----
----- 14:34:03 · "my-star" · Ctrl+T: transcript cleared; bubble numbers restart at #1 -----

===== A3 · 持续 · Ctrl+Enter · "my-star" · 14:34:20 · deepseek-chat =====
[system] [[= PROMPT-tech]] [[= RESUME1]] [[= JD1]]
[memo] [[= M2]]
[user]
<conversation>
<interviewer>
[[#1]] Next one: design a URL shortener.
</interviewer>
</conversation>

<question>
[[= #1]]
</question>

Answer the <question> now, in the words I will say.
----- A3 · 5.0 s · tokens in 3 700 (cached 3 200) / out 480 -----
…

===== M3 · memo update · after A3 · "my-star" · 14:34:27 · deepseek-chat =====
…
```

## UC-2 T4 in the log
Entry `A5` of a UC-2 run: the request `prompt.md` "UC-2 T4 — K-A, fifth answer" prints in full. Entries S1–S3, A1–A4 and M1–M4 are above it in the same file.

```text
===== A5 · 持续 · K-A · "my-star" · 14:52:40 · deepseek-chat =====
[system] [[= PROMPT-tech]] [[= RESUME1]] [[= JD1]]
[memo] [[= M4]]
[history] [[= A1–A4]]
[user]
<visual_context>
<screenshot index="1">
[[= E1]]
</screenshot>
<screenshot index="2">
[[= E3]]
</screenshot>
</visual_context>

<conversation>
<interviewer>
[[= #1–#2]]
</interviewer>
<interviewee>
[[= #3]]
</interviewee>
<interviewer>
[[= #4–#5]]
</interviewer>
<interviewee>
[[= #6]]
</interviewee>
<interviewer>
[[= #7–#8]]
</interviewer>
<interviewee>
[[= #9]]
</interviewee>
<interviewer>
[[#10]] Walk me through that project.
</interviewer>
</conversation>

<question>
[[= #10]]
</question>

Answer the <question> now, in the words I will say.
----- A5 · 6.2 s · tokens in 7 900 (cached 3 200) / out 520 -----
…
```

The only new text in A5 is bubble #10 and the answer.
