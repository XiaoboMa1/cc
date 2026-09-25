## env
- window 11
- Node.js: v25.2.1，/d/develop/node-v25.2/node
- npm: 11.6.2, /d/develop/node-v25.2/npm

## requirement and doc
D:\dev-assist\meet-copilot\chat\req

## terms

### media
- `sys-au` = system audio; `ier` voice only comes from `sys-au`
- `mic` = system microphone.  `iee` voice only comes from `mic`
- S: one screenshot region the user captured. Held in memory only.
- E: the text ai-ext extracted from one S. Shown as that thumbnail's tooltip.
- TRA: the session's transcript: one bubble per utterance, marked `对方` (ier, system audio) or `我` (iee, microphone), in time order.

### participants
- ier = interviewer
- iee = interviewee 

###  use cases
- session: one entry of the session dropdown in the answer pane, e.g. `my-star`. Each session has its own TRA, answer turns, screenshot queue, resume, JD, interview memo and interview type; choosing another entry shows that session's.
- topic: one problem (live-code) or one behavioral topic (live-hr) inside a session. 
- T: one question–answer turn: the ier asks (aloud, or as text visible in an S) and the overlay produces one answer turn.
- live-code = coding / system design / techical concepts with Ier. Screenshot + streaming.
- live-hr = behavioral interview with Ier. Streaming only, no screenshots.structure

### actions and state (things the user or system does)
T-AU = Trigger audio streaming. Activates dual-channel continuous capture. Not a discrete record-then-stop — runs until pause or endSession.
T-S = Trigger screenshot 
T-MIC = Trigger microphone
K-A = Trigger `keep answering` 

### models (5 functional roles + 1 variant)
- ai-ext: S(image) → E(plain text). Receives only screenshots. 
- ai-tra: audio → text via WebSocket. Two independent WS connections, one per audio channel.
- ai-ans: "text→text" LLM call, different prompt + trigger path. Accepts resume, JD. Outputs verbal response for coding or STAR narrative for behavioral.

## for claude
1. if task = coding:
- Do not add fragemnted methods everywhere;  If the logic is simple and the code is short, then just merge into existing functions instead of writing a new function for a trivial operation.
- clean, maintable; no code file should exceed 660 lines.
2. if task = write requiement doc:
the requiremnet doc must:
-  describe  ONLY user view: operation sequence, what is seen after each operation; requirement specification is not implementation doc
- contain multi-turn use cases 