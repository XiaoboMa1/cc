## env
- window 11
- Node.js: v25.2.1，/d/develop/node-v25.2/node
- npm: 11.6.2, /d/develop/node-v25.2/npm

## requirement and doc


## terms

### in memory/disk
- S = screenshot image.
- E = extracted text from S. ai-ext output.
- TRA = accumulated speech transcript. each with speaker tag + timestamp.

### participants
- ier = interviewer
- iee = interviewee 

###  use cases
- live-code = live coding / system design with Ier. Screenshot + streaming. **MOST COMMON**.
- live-hr = behavioral interview with Ier. Streaming only, no screenshots.structure
- T = one QA turn. Ier asks a question (via speech or visible in S), system generates answer for Iee.
- session = scope of one problem or interview topic. No explicit session object in code — defined by when state groups are non-default. Borders differ by use case:

### actions and state (things the user or system does)
T-AU = Trigger audio streaming. Activates dual-channel continuous capture. Not a discrete record-then-stop — runs until pause or endSession.
T-S = Trigger screenshot 
T-MIC = Trigger microphone
K-A = `keep answering` mode 

### models (5 functional roles + 1 variant)
- ai-ext (`extractionModel`) — S(image) → E(JSON). Receives only screenshots. 
- ai-tra— audio → text via WebSocket. Two independent WS connections, one per audio channel.
- ai-ans (`answerModel`) — variant of ai-1st: same "text→text" LLM call, different prompt + trigger path. Generates oral suggestions (not code). Triggered by Ctrl+L pause (streaming pipeline), not Ctrl+Enter (screenshot pipeline). Accepts candidateProfile (resume, JD). Outputs verbal response for coding or STAR narrative for behavioral.

### participants
- Ier = interviewer
- Iee = interviewee (user)

## When coding
Do not add fragemnted methods everywhere;  If the logic is simple and the code is short, then just merge into existing functions instead of writing a new function for a trivial operation.