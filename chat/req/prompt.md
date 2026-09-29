# Requirement: what the AI receives

For every user operation: which model is called, with which prompt, what the request contains, and where the result shows. Terms, screen names and the use cases UC-1 to UC-3 are defined in `sci-keyboard.md`.

All prompts, answers, memos and E are in English. The one exception is `译`, whose output is Chinese.

## Which model and prompt each operation uses

| Operation | Model | Prompt | Request carries | Result |
| --- | --- | --- | --- | --- |
| `答`, `回答选中`, Ctrl+Enter, K-A | ai-ans | answer prompt of the session's interview type (§3) | §4 | answer turn `答` / `持续` |
| `问`, Ctrl+M | ai-ans, without the answer prompt | reference material only (§6.1) | typed text, earlier `问` / `截图问` turns, resume, JD, E of every queued S, recent TRA; earlier answers while `麦克风` is off | answer turn `问` |
| Ctrl+H | ai-ext (the vision model set in `设置`) | extraction (§6.2) | the S image | E on the thumbnail |
| `截图问` | vision model | screenshot question (§6.3) | the S image, typed text, resume + JD | answer turn `截图` |
| `译` on a bubble | text model | translation (§6.4) | that bubble's text | Chinese text under the bubble |
| each finished `答` or `持续` turn | text model | memo update (§6.5) | the memo so far, that turn's question and answer | new memo; nothing shown |

- `纯文本` / `多模态` decides which model writes ai-ans answers (the text model or the vision model). The request content is the same in both cases.
- ai-ans never receives images, including with `多模态` on. Images go only to ai-ext and `截图问`; ai-ans gets E.

## Answer prompt by interview type

The first message of every answer request (§4) is one of two prompts, chosen by the session's `面:技术` / `面:HR` at the moment of the request. For the same type, resume and JD it is identical from one request to the next, so the provider can reuse it (lower cost, faster first word).

**Both types**
- Written as the verbatim transcript of the iee answering unprepared: first person, spoken English, contractions; stops in brackets such as `(stop 2 s)`, hesitations (`um`, `let me think`), restarts (`we were... we were`) and self-corrections (`... no, sorry, let me correct that, ...`) kept as spoken; readable aloud unchanged.
- Plain text: no headings, bullets, numbering, bold or code blocks; each point on a new line.
- Only facts from the resume and from what the iee already said; never an invented company, project, number or date.
- Style rules (anti-AI wording), applied without mentioning them:
  - every sentence carries something only the iee could say. Test 1, where it comes from: own work, the conversation and the screen count; the JD, the question and general field knowledge only as the premise of a conclusion from own work, in the same sentence. Test 2, who else could say it: a sentence another candidate could say unchanged about another employer and system is replaced by the specific instance (which system, how many users, what broke, what changed, the number after);
  - not allowed: tautologies; sentences true of every system, team or employer; ordinary activities dressed up as skills; the JD or the question read back; contrasts with something nobody proposed (`A, not B`, `not A but B`, `rather than`, `X isn't Y, it's Z`) unless B was a real option and what happened to it is said; a sentence re-saying the previous one; a closing generalization; systems described as people; category words in place of the instance (layer, surface, silent, ecosystem, landscape, space, journey, "the shape of X"); setup-then-payoff; em-dash inserts that restate; balanced paired clauses at the end.
- Explains the tags of §4 and asks for consistency with the memo and the earlier answers.

**Tech** (live-code)

| Question | Answer |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| walk through a solution, a design, or how something works | as long as the steps need; often 400 words or more |
| narrow follow-up ("what's the time complexity?", "why a hash map?") | 2–4 sentences |
| coding | the approach in one sentence → the steps in the order they will be written → time and space complexity with the reason → edge cases to test; numbers, constraints and examples exactly as in `<visual_context>`; identifiers said in words |
| system design | assumed requirements and scale, said as assumptions → components and the path of one request → data model → first bottleneck and its fix → the trade-offs chosen |
| concept, framework, language | what it does → the mechanism → when to use it → where the iee used it, if the resume shows it |
| ambiguous | one sentence stating the assumption, then the answer |

**HR** (live-hr)

| Question | Answer |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| behavioral, motivation, CV deep dive | 240–350 words; the first sentence answers directly; then situation, task, the iee's actions (most of the words), result with its number |
| motivation ("why this role", "why us", "why leave") | ties one specific item of the JD to one specific piece of work in the resume |
| narrow follow-up (a date, a number, "what was your role?") | 2–4 sentences |
| small talk, audio check | one sentence |
| end of a full answer | the outcome, then one sentence naming a task from the JD and what the iee would do in it |
| no matching experience | the closest real example, or one natural line that buys time |

## Answer request (`答`, `回答选中`, Ctrl+Enter, K-A)

Two messages:

1. **system** — the §3 prompt of the session's type, then `<resume>` and `<job_description>`.
   - A block is left out when the session has no such file; with neither file, the knowledge base imported in `设置` stands in as `<resume>`.
   - Resume: at most 5000 characters when a JD is present, 8000 otherwise. JD: at most 3000 when a resume is present, 8000 otherwise. A longer file loses whole paragraphs; project / experience paragraphs (resume) and responsibilities / requirements paragraphs (JD) are kept first.
2. **user** — everything else, as blocks in this order, each left out entirely when empty:
   - `<interview_memo>`: the session's memo (§6.5);
   - `<visual_context>`: one `<screenshot index="n">` per thumbnail currently in the strip, holding its E, in capture order, numbered from 1;
   - `<interview_conversation>`: the recent TRA, at most the last 30 bubbles and 6000 characters, oldest dropped first; consecutive bubbles of one speaker in one `<interviewer>` or `<interviewee>` element, one bubble per line;
   - `<earlier_answers>`: only while `麦克风` is off. The session's 8 most recent finished `答` / `持续` turns, oldest first, each as one `<turn>` holding `<asked>` (the question it answered; left out for an answer from the screenshots alone) and `<answer>` (its text). With `麦克风` on it is left out, because `<interview_conversation>` already holds what the iee said as `<interviewee>` lines. `问` and `截图问` turns never appear here: they are the iee's side conversation with the AI;
   - `<question>`: what the trigger answers (`sci-keyboard.md` "Answer triggers");
   - last line: `Answer the <question> now, as the transcript of me saying it: stops, hesitations and self-corrections included.` When there is no `<question>` (no `对方` bubble yet, answering from screenshots): `No question has been asked aloud yet: answer from <visual_context> and <interview_conversation> now, as the transcript of me saying it: stops, hesitations and self-corrections included.`

The prompt (§3) tells the model what each tag holds, and that the questions earlier in `<interview_conversation>` have been answered already: only `<question>` is answered.

Text is passed as captured: `<` and `>` inside the transcript or E (e.g. `vector<int>`) are not escaped.

**Effect of user actions on the next answer request**

| Action | Next answer request |
| --- | --- |
| Ctrl+R | no `<visual_context>` |
| Ctrl+L, `×` | that screenshot is missing; the rest are numbered from 1 again |
| Ctrl+D | no `<earlier_answers>` |
| Ctrl+T | `<interview_conversation>` holds only bubbles captured after the clear; left out while there are none |
| `麦克风` on / off | on: no `<earlier_answers>`; off: `<earlier_answers>` with the earlier `答` / `持续` turns |
| `持续答` (K-A) on / off | no change: K-A only decides when a request is sent |
| `面:技术` ↔ `面:HR` | message 1 uses the other type's prompt |
| importing / removing resume or JD | the message 1 blocks change accordingly |
| topic boundary (Ctrl+R, Ctrl+D, Ctrl+T) | only message 1 and `<interview_memo>` remain from before |

## Other prompts

[Free question (`问`, Ctrl+M)]
1. **system**, only when at least one block exists: `Reference material. Use it only if my question needs it.`, then `<resume>` (≤ 8000 characters), `<job_description>` (≤ 8000), `<visual_context>`, `<interview_conversation>` and `<earlier_answers>` (all as §4). A request sent while an S is still being extracted waits for its E, as `答` does.
2. The session's 8 most recent finished `问` and `截图问` turns, oldest first, each as **user** (the typed text) then **assistant** (the reply).
3. **user**: the typed text, unchanged.

No answer-writing rules apply, so a question about anything, including which model is answering, gets a direct reply.

[Screenshot extraction (ai-ext, Ctrl+H)]
1. **system**: extract only — do not answer, solve or comment; copy legible text verbatim, keeping every number, constraint and example exact; text in another language is translated into English, while code, identifiers and numbers stay as shown; describe a chart, UI or diagram in one or two sentences; call blurry or cut-off parts unreadable instead of guessing; no preamble such as "This screenshot shows".
2. **user**: the image, and `Extract the key information from this screenshot.`

The reply is E.

[Screenshot question (`截图问`)]
1. **system**: a meeting assistant answering the user's question about the screenshot briefly, in English; for a question or problem on screen, the points to say or the approach; then `<background>` with the resume and JD (≤ 8000 characters).
2. **user**: the image, and the typed text, or when the box is empty: `Summarize the key points on this screen and suggest how I should respond.`

[Translation (`译`)]
1. **system**: translate into Simplified Chinese; output only the translation; Chinese input comes back unchanged.
2. **user**: the bubble's text.

[Memo update, after each finished `答` or `持续` turn]
1. **system**: merge the new exchange into the running notes of the interview; in English, also when the notes so far are in another language; at most 250 words, in four sections: `<asked_questions>` (one line per question, newest last), `<claimed_facts>` (numbers, experience and positions stated; later answers must not contradict them), `<interviewer_focus>`, `<cautions>`; `none` in an empty section; when too long, drop the oldest questions first; output only the notes.
2. **user**: `<current_notes>` (the memo, or `empty`) and `<new_exchange>` with `<question>` (the turn's question, or `none: answered from the screenshots`) and `<answer>` (the answer text).

The reply becomes `<interview_memo>` in the next answer request (§4).

## Debug log

Specified in `log.md`.

## Requests in the use cases

`{…}` is content known only at run time. `{Tech prompt}` / `{HR prompt}` is the prompt. In UC-1 to UC-3 `麦克风` is on, so no request carries `<earlier_answers>`; "UC-1 step 13 with `麦克风` off" shows one that does.

### UC-1 step 7 — Ctrl+Enter, first answer (Tech)
Answer turn: `持续 | let me give you an example. if i / what is the number of the operations needed?`

```
── [0] system ──
{Tech prompt}

<resume>
{resume}
</resume>

<job_description>
{JD}
</job_description>

── [1] user ──
<visual_context>
<screenshot index="1">
{E1}
</screenshot>
<screenshot index="2">
{E2}
</screenshot>
</visual_context>

<interview_conversation>
<interviewer>
let me give you an example. if i
what is the number of the operations needed?
</interviewer>
</interview_conversation>

<question>
let me give you an example. if i
what is the number of the operations needed?
</question>

Answer the <question> now, as the transcript of me saying it: stops, hesitations and self-corrections included.
```

No memo yet.

### UC-1 step 13 — Ctrl+Enter, second answer

```
── [0] system ──
(as step 7)

── [1] user ──
<interview_memo>
{memo written after A1}
</interview_memo>

<visual_context>
<screenshot index="1">
{E1}
</screenshot>
<screenshot index="2">
{E3}
</screenshot>
</visual_context>

<interview_conversation>
<interviewer>
let me give you an example. if i
what is the number of the operations needed?
</interviewer>
<interviewee>
{what the iee said in step 8}
</interviewee>
<interviewer>
what about another case
what is the time needed?
</interviewer>
</interview_conversation>

<question>
what about another case
what is the time needed?
</question>

Answer the <question> now, as the transcript of me saying it: stops, hesitations and self-corrections included.
```

E2 is absent (removed in step 10); E3 is numbered 2. A1 is not sent again: the iee's reading of it is the `<interviewee>` line.

### UC-1 step 13 with `麦克风` off
Same as UC-1, with step 2 skipped, so step 8 adds no bubble.

```
── [0] system ──
(as step 7)

── [1] user ──
<interview_memo>
{memo written after A1}
</interview_memo>

<visual_context>
(as UC-1 step 13)
</visual_context>

<interview_conversation>
<interviewer>
let me give you an example. if i
what is the number of the operations needed?
what about another case
what is the time needed?
</interviewer>
</interview_conversation>

<earlier_answers>
<turn>
<asked>
let me give you an example. if i
what is the number of the operations needed?
</asked>
<answer>
{A1}
</answer>
</turn>
</earlier_answers>

<question>
what about another case
what is the time needed?
</question>

Answer the <question> now, as the transcript of me saying it: stops, hesitations and self-corrections included.
```

Without `<earlier_answers>`, nothing would show that the first two interviewer lines were already answered.

### UC-1 step 18 — after the topic boundary

```
── [0] system ──
(as step 7)

── [1] user ──
<interview_memo>
{memo written after A1 and A2}
</interview_memo>

<interview_conversation>
<interviewer>
Next one: design a URL shortener.
</interviewer>
</interview_conversation>

<question>
Next one: design a URL shortener.
</question>

Answer the <question> now, as the transcript of me saying it: stops, hesitations and self-corrections included.
```

### UC-2 T4 — K-A, fifth answer
Answer turn: `持续 | Walk me through that project.`

```
── [0] system ──
(Tech prompt, resume, JD — as UC-1 step 7)

── [1] user ──
<interview_memo>
{memo written after A1–A4}
</interview_memo>

<visual_context>
<screenshot index="1">
{E1}
</screenshot>
<screenshot index="2">
{E3}
</screenshot>
</visual_context>

<interview_conversation>
<interviewer>
let me give you an example. if i
what is the number of the operations needed?
</interviewer>
<interviewee>
{what the iee said after A1}
</interviewee>
<interviewer>
what about another case
what is the time needed?
</interviewer>
<interviewee>
{what the iee said after A3}
</interviewee>
<interviewer>
You mentioned you once worked as a volunteer
so you made proudest project there.
</interviewer>
<interviewee>
{what the iee said after A4}
</interviewee>
<interviewer>
Walk me through that project.
</interviewer>
</interview_conversation>

<question>
Walk me through that project.
</question>

Answer the <question> now, as the transcript of me saying it: stops, hesitations and self-corrections included.
```

E1 and E3, both from the coding problem, are still present at T4 because the strip was not cleared.

### UC-3 step 5 — HR follow-up

```
── [0] system ──
{HR prompt}

<resume>
{resume of 会话 2}
</resume>

<job_description>
{JD of 会话 2}
</job_description>

── [1] user ──
<interview_memo>
{memo written after A1 and A2}
</interview_memo>

<interview_conversation>
<interviewer>
Tell me about yourself.
</interviewer>
<interviewee>
{what the iee said reading A1}
</interviewee>
<interviewer>
Tell me about a project you're proud of.
</interviewer>
<interviewee>
{what the iee said reading A2}
</interviewee>
<interviewer>
What was your role exactly?
</interviewer>
</interview_conversation>

<question>
What was your role exactly?
</question>

Answer the <question> now, as the transcript of me saying it: stops, hesitations and self-corrections included.
```

No `<visual_context>`: the session has no screenshots.

### UC-3 step 6 — Ctrl+M

```
── [0] system ──
Reference material. Use it only if my question needs it.

<resume>
{resume of 会话 2}
</resume>

<job_description>
{JD of 会话 2}
</job_description>

<interview_conversation>
(as UC-3 step 5, followed by what the iee said answering A3)
</interview_conversation>

── [1] user ──
which numbers did I give for the project?
```

No earlier chat turns: this is the session's first `问`.

### UC-3 step 8 — after the topic boundary

```
── [0] system ──
(as UC-3 step 5)

── [1] user ──
<interview_memo>
{memo written after A1, A2 and A3}
</interview_memo>

<interview_conversation>
<interviewer>
Why do you want to leave your current job?
</interviewer>
</interview_conversation>

<question>
Why do you want to leave your current job?
</question>

Answer the <question> now, as the transcript of me saying it: stops, hesitations and self-corrections included.
```

The `问` turn of step 6 is not in the memo: memo updates follow `答` and `持续` turns only.
