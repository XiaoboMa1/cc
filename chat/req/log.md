## log
need to write one that covers: - The prompt that is sent at each model call, but transcribed texts inherited from turn 1 (already recoreded in call 1 prompt log) will not show in call2 (turn 2) log? - the reponse given by each ai answerer call, appended after each prompt 

1. revise logging trigger method, this is my local use, I will never push to github so no security concern, I want to be as convenient as possible, effect is: 
```npm run install --debug-log``` or ```./start.bat/ --debug-log` -> automatically create D:\github\meet\debug-log\<month-day-start-hour-and-minute>.log and write there
2. log output is strange: 
D:\meet-debug\prompts.log. it shows there is NO `### user` and only `### interviewer` , is the speaker header attched rightly??

## prompt building
1. how is The final prompt assesmbled ?
2. we need to first ensure The debug log is implemented correctly and output the role prompt as AI see it, so that We can diagnose the code issues, now it is unclear what is for each turn, how?