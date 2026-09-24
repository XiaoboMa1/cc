/**
 * Prompt construction for meeting/interview answering (pure logic, TDD).
 * Every prompt is English and every answer is English, except
 * buildTranslateMessages, whose job is a Chinese translation.
 *
 * ai-ans (segment / continuous) — cache-friendly three-layer layout:
 *   stable prefix = PROMPT_HR | PROMPT_TECH + <resume> + <job_description>
 *                   (BYTE-STABLE per interview type + material → DeepSeek prefix cache)
 *   slow state    = <interview_memo> (refreshed after each answer)
 *   fast context  = history turns, then <visual_context> <conversation> <question>
 * A block with nothing in it is left out entirely.
 */
import type { ChatMessage } from './adapter';
import type { InterviewType, TranscriptLine } from '../../shared/protocol';

/** transcript chars per request, newest lines kept; sized so a few spoken
 * answers of 240-400+ words still fit next to the interviewer's lines */
export const MAX_CONTEXT_CHARS = 6000;

// ---------- ai-ans system prompts ----------

/** how every answer must sound, for both interview types (anti-AI-wording rules) */
const STYLE = `<style>
Every sentence has to carry something only I could say. Before each sentence, run two checks:
1. Where does it come from? My own work in <resume>, what was said in <conversation> and what is on screen in <visual_context> count. The job description, the question itself and general knowledge of the field do not: use them only as the premise of a conclusion drawn from my own work, in the same sentence as that conclusion.
2. Who else could say it? If another candidate could say it unchanged about another company and another system, replace it with the specific instance: which system, how many users or requests, what broke, what I changed, what the number was afterwards.

Never write:
- A tautology, where the predicate restates the subject ("a fix only one person can follow is a fix that works once"). Say what was observed instead.
- A sentence true of every system, team or employer ("keeps the platform correct as it changes", "lets the team focus on what matters"). Say what is specific to this one: how many callers, what breaks first, what the last incident was.
- An ordinary activity dressed up as a skill ("reading systems I didn't write"). Say the plain version and move on, or give the instance that is not ordinary.
- The job description or the question handed back in new words.
- A contrast with something nobody proposed: "A, not B", "not A but B", "rather than", "X isn't Y, it's Z". Use one only when B was a real option I tried or rejected, and then say what happened to B.
- A second sentence that re-says the first.
- A closing line that generalizes past the story ("in the end, the system is always telling you what it does").
- Systems described as people ("the code lied", "the tests were rotting"). Say the mechanism: "the error path never set the status, so the response went out as a success". Field terms such as listener or supervisor are fine.
- Category words in place of the instance: layer, surface, silent, ecosystem, landscape, space, journey, "the shape of X". Say which wrong output, which component, which constraint.
- Setup-then-payoff ("there were two challenges, and only the second one was real"). Describe both, and give the second more words.
- An em-dash insert that only restates ("one quality — persistence — carried the project").
- A balanced pair of clauses at the end ("Without them I could only assert it. With them I could show it.").
Apply these while writing and never mention them.
</style>`;

/** what each tag in the request holds, for both interview types */
const INPUT_FORMAT = `<input_format>
- <conversation>: the live transcript, oldest first. <interviewer> is the interviewer's audio; <interviewee> is my microphone, so it is what I actually said.
- <visual_context>: text extracted from screenshots I took, in capture order.
- <question>: what the interviewer has said since your previous answer. This is what you answer.
- <interview_memo> and your earlier replies in this chat: what has been said so far. Stay consistent with both.
</input_format>`;

/** interview type 'hr': behavioral, motivation, CV deep dive */
export const PROMPT_HR = [
  `<role>
You are my teleprompter in a live behavioral interview: motivation, past experience and deep dives into my CV. You see the transcript as it happens. What you write is exactly what I say next, read aloud word for word.
</role>`,
  `<answer_rules>
- Speak as me: first person, spoken English, short sentences, contractions. I must be able to read it out without changing a word.
- Plain text only: no headings, bullets, numbering or bold. Start a new line for each new point so I can keep my place.
- Length follows the question. A full behavioral, motivation or CV deep-dive answer: 240-350 words. A narrow follow-up (a date, a number, "what was your role?"): two to four sentences. Small talk or an audio check: one sentence.
- The first sentence answers the question directly. Then the story.
- Experience questions: the situation, my task, the actions I took, the result with its number. Most of the words go to the actions.
- Motivation questions ("why this role", "why us", "why are you leaving"): tie a specific item in <job_description> to a specific piece of my work in <resume>.
- Use only facts from <resume> and from what I have already said in <conversation>. Never invent a company, project, number or date.
- End a full answer with the outcome, then one sentence naming a task from <job_description> and what I would do in it. A short follow-up just stops.
- If the question is unclear or I have no matching experience, give the closest real example, or one natural line that buys a moment to think.
</answer_rules>`,
  STYLE,
  INPUT_FORMAT,
].join('\n\n');

/** interview type 'tech': online coding, system design, concept explanation */
export const PROMPT_TECH = [
  `<role>
You are my teleprompter in a live technical interview: online coding, system design, and explaining concepts, frameworks or languages. You see the transcript and the text of any problem on my screen. What you write is exactly what I say next, read aloud word for word while I code or draw.
</role>`,
  `<answer_rules>
- Speak as me: first person, spoken English, short sentences, contractions. I must be able to read it out without changing a word.
- Plain text only: no headings, bullets, numbering, bold or code blocks. Say identifiers and operations in words I can speak. Start a new line for each step so I can keep my place.
- Length follows the question. Walking through a solution, a design or how something works: as long as the steps need, often 400 words or more. A narrow follow-up ("what's the time complexity?", "why a hash map?"): two to four sentences.
- Coding: the approach in one sentence; the steps in the order I will write them; the time and space complexity with the reason; the edge cases I will test. Take every number, constraint and example from <visual_context> exactly as written.
- System design: the requirements and the scale I assume, said as assumptions; the components and how one request flows through them; the data model; the first bottleneck and how I remove it; the trade-offs I choose.
- Concepts, frameworks, languages: what it does, the mechanism underneath, when I would use it, and where I have used it if <resume> shows that.
- When I mention my own projects, use only facts from <resume>. Never invent a company, project or number.
- If the question is ambiguous, state the assumption I am making in one sentence, then answer.
</answer_rules>`,
  STYLE,
  INPUT_FORMAT,
].join('\n\n');

/** total injected background budget; keeps prompts bounded regardless of size */
export const MAX_BACKGROUND_CHARS = 8000;
/** when both slots are present the resume gets the bigger share */
export const RESUME_BUDGET = 5000;
export const JD_BUDGET = MAX_BACKGROUND_CHARS - RESUME_BUDGET;

/** resume: keep project/work-experience sections when over budget */
export const RESUME_PRIORITY =
  /(项目|经历|经验|工作|实习|成果|职责|Project|Experience|Work|Achievement)/i;
/** JD: keep responsibilities/requirements sections when over budget */
export const JD_PRIORITY =
  /(职责|要求|责任|任职|资格|技能|优先|加分|Responsibilit|Requirement|Qualification|Skill)/i;

/**
 * Deterministic budget clip that prefers paragraphs matching `priority`
 * (e.g. a resume's project experience, a JD's requirements) instead of a
 * blind head-truncation. Output order stays the original document order.
 */
export function smartClip(text: string, budget: number, priority: RegExp): string {
  const t = text.trim();
  if (t.length <= budget) return t;
  const paras = t.split(/\n{2,}/);
  const picked = new Set<number>();
  let used = 0;
  const tryTake = (i: number) => {
    if (picked.has(i)) return;
    const cost = paras[i].length + 2; // + join separator
    if (used + cost > budget) return;
    picked.add(i);
    used += cost;
  };
  for (let i = 0; i < paras.length; i++) if (priority.test(paras[i])) tryTake(i);
  for (let i = 0; i < paras.length; i++) tryTake(i);
  if (picked.size === 0) return t.slice(0, budget); // one giant paragraph
  return paras
    .map((p, i) => (picked.has(i) ? p : null))
    .filter((p): p is string => p !== null)
    .join('\n\n');
}

/**
 * The BYTE-STABLE system prompt: the interview type's prompt + resume + JD.
 * Same inputs MUST yield the identical string (no timestamps / randomness) —
 * the LLM prewarm request and every real request share this prefix so the
 * provider's prefix cache (DeepSeek 0.1x pricing + faster prefill) hits.
 */
export function buildStablePrefix(type: InterviewType, resume: string, jd: string): string {
  const parts = [type === 'hr' ? PROMPT_HR : PROMPT_TECH];
  const r = resume.trim();
  const j = jd.trim();
  if (r) {
    parts.push(`<resume>\n${smartClip(r, j ? RESUME_BUDGET : MAX_BACKGROUND_CHARS, RESUME_PRIORITY)}\n</resume>`);
  }
  if (j) {
    parts.push(
      `<job_description>\n${smartClip(j, r ? JD_BUDGET : MAX_BACKGROUND_CHARS, JD_PRIORITY)}\n</job_description>`,
    );
  }
  return parts.join('\n\n');
}

// ---------- P1-5: rolling interview memo (consistency > compression) ----------

/** hard bound on the stored memo (the prompt asks for ≤250 words, the clamp defends) */
export const MAX_MEMO_CHARS = 2000;

export function clampMemo(text: string): string {
  const t = text.trim();
  return t.length > MAX_MEMO_CHARS ? t.slice(0, MAX_MEMO_CHARS) : t;
}

/**
 * Fold one finished Q&A into the rolling memo (async, off the critical path).
 * The memo keeps the interview self-consistent: what was asked, what I have
 * claimed as fact, what the interviewer cares about.
 */
export function buildMemoUpdateMessages(oldMemo: string, question: string, answer: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You keep the running notes of a job interview. Merge the new exchange into the notes and output the complete updated notes: at most 250 words, in exactly these four sections, writing "none" in an empty one.
<asked_questions>
(one line per question, newest last)
</asked_questions>
<claimed_facts>
(numbers, experience and positions I have stated; later answers must not contradict them)
</claimed_facts>
<interviewer_focus>
(what the interviewer cares about, inferred from the questions)
</interviewer_focus>
<cautions>
(points I answered shakily or need to come back to)
</cautions>
Merge duplicates. When over length, drop the oldest asked questions first. Output the notes only, with no explanation.`,
    },
    {
      role: 'user',
      content: `<current_notes>\n${oldMemo.trim() || 'empty'}\n</current_notes>\n\n<new_exchange>\n<question>\n${question.trim()}\n</question>\n<answer>\n${answer.trim()}\n</answer>\n</new_exchange>`,
    },
  ];
}

// ---------- P1-6: prefix-cache prewarm ----------

/**
 * The prewarm request: system prompt byte-identical to real answer requests
 * (that's the whole point — DeepSeek caches the common token prefix), plus a
 * constant one-word user turn; max_tokens=1 upstream, reply discarded.
 */
export function buildPrewarmMessages(stablePrefix: string): ChatMessage[] {
  return [
    { role: 'system', content: stablePrefix },
    { role: 'user', content: 'ok' },
  ];
}

export interface AnswerPromptInput {
  /** the sentence to answer (segment/continuous) or the text to translate */
  question?: string;
  /** recent transcript, oldest first */
  transcript: TranscriptLine[];
  mode: 'segment' | 'continuous' | 'free' | 'translate';
  /** free-form user question (mode === 'free') */
  freeQuestion?: string;
  /** selects PROMPT_HR / PROMPT_TECH (segment/continuous); default 'tech' */
  interviewType?: InterviewType;
  /** prior Q&A turns for a coherent session (oldest first) */
  history?: ChatMessage[];
  /** resume slot (双槽资料); falls back to `background` */
  resume?: string;
  /** job-description slot (双槽资料) */
  jd?: string;
  /** legacy single-slot KB / global default — treated as resume material */
  background?: string;
  /** rolling interview memo (P1) — slow-changing block, its own message */
  memo?: string;
  /** R6: cached extracted text (E) from every screenshot currently queued,
   * oldest first — segment/continuous only, folded in as <visual_context> */
  visualContext?: string[];
}

/** Keep the most recent lines within the char budget (oldest dropped first). */
export function clampTranscript(
  lines: readonly TranscriptLine[],
  maxChars = MAX_CONTEXT_CHARS,
): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const len = lines[i].text.length + 1;
    if (total + len > maxChars) break;
    out.unshift(lines[i]);
    total += len;
  }
  return out;
}

/** <conversation> with consecutive lines of one speaker in one element; '' when empty */
function conversationXml(lines: readonly TranscriptLine[]): string {
  const groups: { speaker: TranscriptLine['speaker']; texts: string[] }[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const last = groups[groups.length - 1];
    if (last?.speaker === line.speaker) last.texts.push(text);
    else groups.push({ speaker: line.speaker, texts: [text] });
  }
  if (!groups.length) return '';
  const body = groups.map((g) => {
    const tag = g.speaker === 'me' ? 'interviewee' : 'interviewer';
    return `<${tag}>\n${g.texts.join('\n')}\n</${tag}>`;
  });
  return `<conversation>\n${body.join('\n')}\n</conversation>`;
}

/**
 * Translate a transcript line to Chinese (R: 翻译功能). Fixed target = 中文,
 * output only the translation. If the text is already Chinese the model
 * simply echoes it.
 */
export function buildTranslateMessages(text: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        "You are a translation engine. Translate the user's text into Simplified Chinese. Output only the translation: no quotes, no explanation, no restating of the original. If the text is already Chinese, return it unchanged.",
    },
    { role: 'user', content: text.trim() },
  ];
}

/** R5: screenshot Q&A — one multimodal user message for a vision model. */
export function buildVisionMessages(
  question: string,
  imageDataUrl: string,
  background?: string,
): ChatMessage[] {
  const bg = (background ?? '').trim();
  const sys =
    "You are a meeting assistant. The user sends a screenshot, usually a slide, a document or a coding problem the other side shared. Answer the user's question about it briefly, in English. If the screenshot holds a question or a problem, give the points I can say, or the approach to solve it." +
    (bg ? `\n\n<background>\n${bg.slice(0, MAX_BACKGROUND_CHARS)}\n</background>` : '');
  return [
    {
      role: 'system',
      content: sys,
    },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageDataUrl } },
        {
          type: 'text',
          text: question.trim() || 'Summarize the key points on this screen and suggest how I should respond.',
        },
      ],
    },
  ];
}

/**
 * R6: screenshot -> extracted text (ai-ext). No question, no persona — just
 * transcribe what is useful on screen as plain text so it can be cached (E)
 * and later folded into the next teleprompter answer as visual context.
 */
export function buildExtractionMessages(imageDataUrl: string): ChatMessage[] {
  const sys = [
    'You extract information from a screenshot. Extract only: do not answer, solve or comment.',
    '- Text (a problem statement, code, a document, a chat): copy the legible key text word for word, keeping every number, constraint and example exact.',
    '- A chart, UI or diagram: one or two sentences on what it shows.',
    '- Anything blurry or cut off: say it is unreadable; do not guess.',
    'Output the extracted content only, with no preamble such as "This screenshot shows".',
  ].join('\n');
  return [
    { role: 'system', content: sys },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageDataUrl } },
        { type: 'text', text: 'Extract the key information from this screenshot.' },
      ],
    },
  ];
}

export function buildAnswerMessages(input: AnswerPromptInput): ChatMessage[] {
  if (input.mode === 'translate') {
    return buildTranslateMessages(input.question ?? '');
  }

  const conversation = conversationXml(clampTranscript(input.transcript));
  const resume = (input.resume ?? '').trim() || (input.background ?? '').trim();
  const jd = (input.jd ?? '').trim();

  // Free "随便问": raw pass-through — NO teleprompter prompt, so identity
  // / "which model are you" questions get the model's truthful answer. The
  // transcript + material are offered only as optional reference.
  if (input.mode === 'free') {
    const refs: string[] = [];
    if (resume) refs.push(`<resume>\n${resume.slice(0, MAX_BACKGROUND_CHARS)}\n</resume>`);
    if (jd) refs.push(`<job_description>\n${jd.slice(0, MAX_BACKGROUND_CHARS)}\n</job_description>`);
    if (conversation) refs.push(conversation);
    const msgs: ChatMessage[] = [];
    if (refs.length) {
      msgs.push({ role: 'system', content: `Reference material. Use it only if my question needs it.\n\n${refs.join('\n\n')}` });
    }
    msgs.push(...(input.history ?? []));
    msgs.push({ role: 'user', content: (input.freeQuestion ?? '').trim() });
    return msgs;
  }

  // segment / continuous: teleprompter with the stable prefix
  const msgs: ChatMessage[] = [
    { role: 'system', content: buildStablePrefix(input.interviewType ?? 'tech', resume, jd) },
  ];

  const memo = (input.memo ?? '').trim();
  if (memo) {
    // slow-changing block sits BETWEEN the stable prefix and the fast history,
    // so a memo refresh only invalidates the cache from this point on
    msgs.push({ role: 'user', content: `<interview_memo>\n${memo}\n</interview_memo>` });
    msgs.push({ role: 'assistant', content: "Noted. I'll stay consistent with it." });
  }

  // earlier turns: the user side is the question that answer was given for
  for (const m of input.history ?? []) {
    msgs.push(
      m.role === 'user' && typeof m.content === 'string'
        ? { role: 'user', content: `<question>\n${m.content.trim()}\n</question>` }
        : m,
    );
  }

  const blocks: string[] = [];
  const visual = (input.visualContext ?? []).map((e) => e.trim()).filter(Boolean);
  if (visual.length) {
    const shots = visual.map((e, i) => `<screenshot index="${i + 1}">\n${e}\n</screenshot>`);
    blocks.push(`<visual_context>\n${shots.join('\n')}\n</visual_context>`);
  }
  if (conversation) blocks.push(conversation);
  const q = (input.question ?? '').trim();
  if (q) {
    blocks.push(`<question>\n${q}\n</question>`, 'Answer the <question> now, in the words I will say.');
  } else {
    blocks.push(
      'No question has been asked aloud yet: answer from <visual_context> and <conversation> now, in the words I will say.',
    );
  }
  msgs.push({ role: 'user', content: blocks.join('\n\n') });
  return msgs;
}
