import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import {
  SseParser,
  extractDelta,
  extractMessageText,
  toProxyRules,
  chatOnce,
  chatStream,
  type ChatMessage,
} from '../electron/llm/adapter';
import {
  buildAnswerMessages,
  buildExtractionMessages,
  buildMemoUpdateMessages,
  buildPrewarmMessages,
  buildStablePrefix,
  buildTranslateMessages,
  buildVisionMessages,
  clampMemo,
  clampTranscript,
  smartClip,
  JD_PRIORITY,
  MAX_BACKGROUND_CHARS,
  MAX_CONTEXT_CHARS,
  MAX_MEMO_CHARS,
  PROMPT_HR,
  PROMPT_TECH,
  RESUME_PRIORITY,
} from '../electron/llm/prompts';
import { isLikelyQuestion } from '../shared/textHeuristics';
import type { TranscriptLine } from '../shared/protocol';

const line = (id: number, speaker: 'them' | 'me', text: string): TranscriptLine => ({ id, speaker, text });
const lastUser = (msgs: ChatMessage[]) => msgs[msgs.length - 1].content as string;

describe('SseParser', () => {
  it('parses complete events', () => {
    const p = new SseParser();
    expect(p.push('data: {"a":1}\n\ndata: {"b":2}\n\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('handles payloads split across chunks', () => {
    const p = new SseParser();
    expect(p.push('data: {"a"')).toEqual([]);
    expect(p.push(':1}\n')).toEqual(['{"a":1}']);
  });

  it('handles CRLF and ignores non-data lines', () => {
    const p = new SseParser();
    expect(p.push(': comment\r\nevent: x\r\ndata: {"a":1}\r\n\r\n')).toEqual(['{"a":1}']);
  });

  it('stops at [DONE]', () => {
    const p = new SseParser();
    expect(p.push('data: {"a":1}\n\ndata: [DONE]\n\ndata: {"b":2}\n\n')).toEqual(['{"a":1}']);
    expect(p.done).toBe(true);
    expect(p.push('data: {"c":3}\n\n')).toEqual([]);
  });
});

describe('extractDelta', () => {
  it('extracts streaming delta content', () => {
    expect(extractDelta('{"choices":[{"delta":{"content":"你好"}}]}')).toBe('你好');
  });
  it('tolerates role-only/empty deltas and bad json', () => {
    expect(extractDelta('{"choices":[{"delta":{"role":"assistant"}}]}')).toBe('');
    expect(extractDelta('not json')).toBe('');
  });
});

describe('buildAnswerMessages (segment / continuous)', () => {
  it('puts the question in <question> after the conversation and ends with the instruction', () => {
    const msgs = buildAnswerMessages({
      mode: 'segment',
      question: 'What is the time complexity?',
      transcript: [line(1, 'them', 'Here is the problem.'), line(2, 'them', 'What is the time complexity?')],
    });
    expect(msgs[0].role).toBe('system');
    const user = lastUser(msgs);
    expect(user).toContain('<question>\nWhat is the time complexity?\n</question>');
    expect(user.indexOf('<conversation>')).toBeLessThan(user.indexOf('<question>'));
    expect(user.endsWith('Answer the <question> now, in the words I will say.')).toBe(true);
  });

  it('groups consecutive lines of one speaker into one element', () => {
    const msgs = buildAnswerMessages({
      mode: 'continuous',
      question: 'what about another case',
      transcript: [
        line(1, 'them', 'let me give you an example. if i'),
        line(2, 'them', 'what is the number of the operations needed?'),
        line(3, 'me', 'I think n minus one.'),
        line(4, 'them', 'what about another case'),
      ],
    });
    expect(lastUser(msgs)).toContain(
      '<conversation>\n<interviewer>\nlet me give you an example. if i\nwhat is the number of the operations needed?\n</interviewer>\n' +
        '<interviewee>\nI think n minus one.\n</interviewee>\n<interviewer>\nwhat about another case\n</interviewer>\n</conversation>',
    );
  });

  it('omits empty blocks instead of printing a placeholder', () => {
    const user = lastUser(buildAnswerMessages({ mode: 'continuous', question: 'q', transcript: [], visualContext: [] }));
    expect(user).not.toContain('<conversation>');
    expect(user).not.toContain('<visual_context>');
    expect(user.startsWith('<question>')).toBe(true);
  });

  it('without a question it answers from the screen and the conversation', () => {
    const user = lastUser(buildAnswerMessages({ mode: 'continuous', transcript: [], visualContext: ['Two Sum'] }));
    expect(user).not.toContain('<question>');
    expect(user).toContain('No question has been asked aloud yet');
  });

  it('leaves < and > in transcript and screenshot text unescaped', () => {
    const user = lastUser(
      buildAnswerMessages({
        mode: 'segment',
        question: 'q',
        transcript: [line(1, 'them', 'use a vector<int> here')],
        visualContext: ['Map<String, Integer> counts'],
      }),
    );
    expect(user).toContain('vector<int>');
    expect(user).toContain('Map<String, Integer>');
  });

  it('free mode passes the user question through', () => {
    const msgs = buildAnswerMessages({ mode: 'free', freeQuestion: 'Summarize the conversation', transcript: [] });
    // no context/material => no system prompt at all, just the raw question
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: 'user', content: 'Summarize the conversation' });
  });

  it('free mode offers material as reference only, never the teleprompter prompt (truthful model identity)', () => {
    const msgs = buildAnswerMessages({
      mode: 'free',
      freeQuestion: 'Which model are you?',
      transcript: [line(1, 'them', 'some talk')],
      background: 'my resume',
    });
    const sys = msgs[0].content as string;
    expect(sys).toContain('Reference material');
    expect(sys).toContain('<resume>\nmy resume\n</resume>');
    expect(sys).toContain('<interviewer>\nsome talk\n</interviewer>');
    expect(sys).not.toContain('teleprompter');
    expect(lastUser(msgs)).toBe('Which model are you?');
  });
});

describe('interview type picks the system prompt', () => {
  it('hr uses PROMPT_HR; tech and the default use PROMPT_TECH', () => {
    const ask = (interviewType?: 'hr' | 'tech') =>
      buildAnswerMessages({ mode: 'segment', question: 'q', transcript: [], interviewType })[0].content;
    expect(ask('hr')).toBe(PROMPT_HR);
    expect(ask('tech')).toBe(PROMPT_TECH);
    expect(ask()).toBe(PROMPT_TECH);
  });

  it('sets the default length of each interview type', () => {
    expect(PROMPT_HR).toContain('240-350 words');
    expect(PROMPT_TECH).toContain('400 words or more');
  });

  it('carries the anti-AI-wording rules at system level in both prompts', () => {
    for (const p of [PROMPT_HR, PROMPT_TECH]) {
      expect(p).toContain('<style>');
      expect(p).toContain('Who else could say it?');
      expect(p).toContain('"A, not B"');
      expect(p).toContain('<input_format>');
    }
  });

  it('is English only', () => {
    for (const p of [PROMPT_HR, PROMPT_TECH]) expect(p).not.toMatch(/[一-鿿]/);
  });
});

describe('buildAnswerMessages visual context (R6: queued-screenshot E)', () => {
  it('numbers each cached extraction and puts the block before the conversation', () => {
    const user = lastUser(
      buildAnswerMessages({
        mode: 'continuous',
        question: 'How would you solve it?',
        transcript: [line(1, 'them', 'How would you solve it?')],
        visualContext: ['Reverse a linked list.', 'The whiteboard shows a binary tree.'],
      }),
    );
    expect(user).toContain(
      '<visual_context>\n<screenshot index="1">\nReverse a linked list.\n</screenshot>\n' +
        '<screenshot index="2">\nThe whiteboard shows a binary tree.\n</screenshot>\n</visual_context>',
    );
    expect(user.indexOf('<visual_context>')).toBeLessThan(user.indexOf('<conversation>'));
  });

  it('drops blank entries and never leaks into free/translate modes', () => {
    const user = lastUser(
      buildAnswerMessages({ mode: 'segment', question: 'x', transcript: [], visualContext: ['  ', 'real content'] }),
    );
    expect(user).toContain('<screenshot index="1">\nreal content\n</screenshot>');
    expect(user).not.toContain('index="2"');

    const free = buildAnswerMessages({ mode: 'free', freeQuestion: 'hi', transcript: [], visualContext: ['leaked?'] });
    expect(JSON.stringify(free)).not.toContain('leaked?');
    const translate = buildAnswerMessages({ mode: 'translate', question: 'hi', transcript: [], visualContext: ['leaked?'] });
    expect(JSON.stringify(translate)).not.toContain('leaked?');
  });
});

describe('isLikelyQuestion (continuous-mode gate)', () => {
  it('accepts real questions (zh + en)', () => {
    expect(isLikelyQuestion('你们的核心优势是什么？')).toBe(true);
    expect(isLikelyQuestion('能不能介绍一下你的项目')).toBe(true);
    expect(isLikelyQuestion('请问你怎么看这个方向')).toBe(true);
    expect(isLikelyQuestion('Could you tell me about your experience?')).toBe(true);
    expect(isLikelyQuestion('How do you handle conflict')).toBe(true);
  });
  it('rejects short/statement fragments', () => {
    expect(isLikelyQuestion('嗯')).toBe(false);
    expect(isLikelyQuestion('好的')).toBe(false);
    expect(isLikelyQuestion('我明白了')).toBe(false);
  });
  it('treats long utterances (>=40 chars) as likely-answerable', () => {
    const long = '我们这边其实一直在做这个方向的落地大概有三年了积累了不少经验和数据也踩过很多坑希望多交流一下';
    expect(long.length).toBeGreaterThanOrEqual(40);
    expect(isLikelyQuestion(long)).toBe(true);
  });
});

describe('buildAnswerMessages history (session coherence)', () => {
  it('wraps earlier questions in <question> and keeps earlier answers as they are', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ];
    const msgs = buildAnswerMessages({ mode: 'segment', question: 'new question', transcript: [], history });
    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: '<question>\nprevious question\n</question>' });
    expect(msgs[2]).toEqual(history[1]);
    expect(lastUser(msgs)).toContain('new question');
  });
  it('translate mode ignores history entirely', () => {
    const msgs = buildAnswerMessages({
      mode: 'translate',
      question: 'Hello',
      transcript: [],
      history: [{ role: 'user', content: 'leak?' }],
    });
    expect(JSON.stringify(msgs)).not.toContain('leak?');
  });
});

describe('dual-slot material injection (resume / JD)', () => {
  it('injects resume + JD as <resume> and <job_description> blocks of the system prompt', () => {
    const sys = buildAnswerMessages({
      mode: 'segment',
      question: 'x',
      transcript: [],
      resume: 'Built a live transcription app with whisper + DirectML.',
      jd: 'Responsibilities: build voice products.',
    })[0].content as string;
    expect(sys).toContain('<resume>\nBuilt a live transcription app with whisper + DirectML.\n</resume>');
    expect(sys).toContain('<job_description>\nResponsibilities: build voice products.\n</job_description>');
  });
  it('legacy background is treated as resume material (compat)', () => {
    const sys = buildAnswerMessages({ mode: 'segment', question: 'x', transcript: [], background: 'global KB text' })[0]
      .content as string;
    expect(sys).toContain('<resume>\nglobal KB text\n</resume>');
  });
  it('omits the blocks when empty', () => {
    const sys = buildAnswerMessages({ mode: 'segment', question: 'x', transcript: [], background: '  ' })[0]
      .content as string;
    // the rules mention <resume> by name; only the blocks close the tag
    expect(sys).not.toContain('</resume>');
    expect(sys).not.toContain('</job_description>');
  });
  it('caps oversized material to the char budget', () => {
    const sys = buildAnswerMessages({ mode: 'segment', question: 'x', transcript: [], resume: 'A'.repeat(20000) })[0]
      .content as string;
    expect(sys.length).toBeLessThan(PROMPT_TECH.length + MAX_BACKGROUND_CHARS + 100);
  });
  it('translate mode never carries material', () => {
    const joined = JSON.stringify(
      buildAnswerMessages({ mode: 'translate', question: 'Hello', transcript: [], resume: 'secret resume', jd: 'secret JD' }),
    );
    expect(joined).not.toContain('secret resume');
    expect(joined).not.toContain('secret JD');
  });
});

describe('buildStablePrefix (prefix-cache friendliness)', () => {
  it('is byte-stable: identical inputs yield the identical string', () => {
    const a = buildStablePrefix('tech', 'resume text', 'JD text');
    expect(buildStablePrefix('tech', 'resume text', 'JD text')).toBe(a);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{13}/); // no dates / timestamps
  });
  it('is the entire system message of segment/continuous requests', () => {
    const msgs = buildAnswerMessages({
      mode: 'segment',
      question: 'q',
      transcript: [line(1, 'them', 'a')],
      resume: 'R',
      jd: 'J',
      interviewType: 'hr',
    });
    expect(msgs[0].content).toBe(buildStablePrefix('hr', 'R', 'J'));
  });
  it('differs per interview type', () => {
    expect(buildStablePrefix('hr', 'R', 'J')).not.toBe(buildStablePrefix('tech', 'R', 'J'));
  });
  it('gives the full budget to a lone slot', () => {
    expect(buildStablePrefix('tech', '', 'B'.repeat(20000))).toContain('B'.repeat(MAX_BACKGROUND_CHARS));
  });
});

describe('smartClip (priority-aware budget truncation)', () => {
  it('returns text unchanged when under budget', () => {
    expect(smartClip('短文本', 100, RESUME_PRIORITY)).toBe('短文本');
  });
  it('keeps priority paragraphs (project experience / JD requirements) over filler', () => {
    const filler = '自我评价：热爱学习。'.repeat(30); // ~300 chars, no keyword
    const proj = '项目经历：做了实时转录系统，负责 ASR 链路。';
    const text = `${filler}\n\n${proj}\n\n${filler}`;
    const out = smartClip(text, proj.length + 10, JD_PRIORITY.test(proj) ? JD_PRIORITY : RESUME_PRIORITY);
    expect(out).toContain('项目经历');
    expect(out.length).toBeLessThanOrEqual(proj.length + 10);
  });
  it('hard-slices a single oversized paragraph', () => {
    expect(smartClip('A'.repeat(500), 100, RESUME_PRIORITY)).toHaveLength(100);
  });
});

describe('buildMemoUpdateMessages / clampMemo (P1-5 pure logic)', () => {
  it('folds the old notes and the new Q&A into four XML sections', () => {
    const msgs = buildMemoUpdateMessages(
      '<asked_questions>\nself intro\n</asked_questions>',
      'What are your strengths?',
      'Backend concurrency.',
    );
    expect(msgs).toHaveLength(2);
    const sys = msgs[0].content as string;
    expect(sys).toContain('at most 250 words');
    for (const tag of ['<asked_questions>', '<claimed_facts>', '<interviewer_focus>', '<cautions>']) {
      expect(sys).toContain(tag);
    }
    const user = msgs[1].content as string;
    expect(user).toContain('<current_notes>\n<asked_questions>\nself intro\n</asked_questions>\n</current_notes>');
    expect(user).toContain('<question>\nWhat are your strengths?\n</question>');
    expect(user).toContain('<answer>\nBackend concurrency.\n</answer>');
  });
  it('marks first-time notes as empty', () => {
    expect(buildMemoUpdateMessages('', 'q', 'a')[1].content).toContain('<current_notes>\nempty\n</current_notes>');
  });
  it('clampMemo hard-caps the stored memo', () => {
    expect(clampMemo('x'.repeat(5000))).toHaveLength(MAX_MEMO_CHARS);
    expect(clampMemo('  ok  ')).toBe('ok');
  });
});

describe('buildPrewarmMessages (P1-6 prefix-cache warm)', () => {
  it('system message is byte-identical to real answer requests', () => {
    const warm = buildPrewarmMessages(buildStablePrefix('tech', 'resume', 'JD'));
    const real = buildAnswerMessages({ mode: 'segment', question: 'q', transcript: [], resume: 'resume', jd: 'JD' });
    expect(warm[0].role).toBe('system');
    expect(warm[0].content).toBe(real[0].content);
    // the user turn is tiny and CONSTANT (no timestamps → deterministic)
    expect(warm[1]).toEqual({ role: 'user', content: 'ok' });
  });
});

describe('memo block (rolling interview memo, P1)', () => {
  it('sits between the stable prefix and the history', () => {
    const msgs = buildAnswerMessages({
      mode: 'segment',
      question: 'new question',
      transcript: [],
      memo: 'claimed: three years of backend work',
      history: [{ role: 'user', content: 'old question' }],
    });
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toBe('<interview_memo>\nclaimed: three years of backend work\n</interview_memo>');
    expect(msgs[2].role).toBe('assistant');
    expect(msgs[3]).toEqual({ role: 'user', content: '<question>\nold question\n</question>' });
  });
  it('is omitted entirely when empty', () => {
    const msgs = buildAnswerMessages({ mode: 'segment', question: 'q', transcript: [], memo: ' ' });
    // system + the question message only; <input_format> names the tag, so check messages, not text
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user']);
    expect(lastUser(msgs).startsWith('<question>')).toBe(true);
  });
});

describe('extractMessageText (non-stream reply)', () => {
  it('pulls choices[0].message.content', () => {
    expect(extractMessageText('{"choices":[{"message":{"content":"你好"}}]}')).toBe('你好');
    expect(extractMessageText('bad json')).toBe('');
    expect(extractMessageText('{"choices":[]}')).toBe('');
  });
});

describe('toProxyRules', () => {
  it('formats bare host:port for both schemes', () => {
    expect(toProxyRules('127.0.0.1:7897')).toBe('http=127.0.0.1:7897;https=127.0.0.1:7897');
    expect(toProxyRules('http://127.0.0.1:7897')).toBe('http=127.0.0.1:7897;https=127.0.0.1:7897');
    expect(toProxyRules('')).toBe('');
    expect(toProxyRules(undefined)).toBe('');
  });
});

describe('buildTranslateMessages / translate mode', () => {
  it('targets Simplified Chinese, output-only, no context', () => {
    const msgs = buildTranslateMessages('Could you introduce your company?');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toContain('Simplified Chinese');
    expect(msgs[0].content).toContain('Output only the translation');
    expect(msgs[1].content).toBe('Could you introduce your company?');
  });

  it('translate mode routes through buildAnswerMessages without transcript context', () => {
    const msgs = buildAnswerMessages({
      mode: 'translate',
      question: 'Hello world',
      transcript: [line(1, 'them', 'irrelevant context')],
    });
    expect(JSON.stringify(msgs)).not.toContain('irrelevant context');
    expect(msgs[1].content).toBe('Hello world');
  });
});

describe('buildVisionMessages', () => {
  it('builds one multimodal user message: image first, question second', () => {
    const msgs = buildVisionMessages('What is this slide about?', 'data:image/png;base64,AAA');
    expect(msgs).toHaveLength(2);
    const content = msgs[1].content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } });
    expect(content[1]).toEqual({ type: 'text', text: 'What is this slide about?' });
    expect(msgs[0].content).toContain('in English');
  });

  it('falls back to a default question when empty', () => {
    const content = buildVisionMessages('  ', 'data:image/png;base64,AAA')[1].content as Array<{ type: string; text?: string }>;
    expect(content[1].text).toContain('key points');
  });
});

describe('buildExtractionMessages (R6: ai-ext, S -> E)', () => {
  it('builds one multimodal user message with no question — extraction only', () => {
    const msgs = buildExtractionMessages('data:image/png;base64,CCC');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    const content = msgs[1].content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,CCC' } });
    expect(content[1].type).toBe('text');
  });

  it('instructs the model to only extract, never answer or guess', () => {
    const sys = buildExtractionMessages('data:image/png;base64,CCC')[0].content as string;
    expect(sys).toContain('do not answer, solve or comment');
    expect(sys).toContain('do not guess');
  });
});

describe('clampTranscript', () => {
  it('keeps the newest lines within budget', () => {
    const lines = [
      line(1, 'them', 'a'.repeat(MAX_CONTEXT_CHARS)),
      line(2, 'me', 'b'.repeat(MAX_CONTEXT_CHARS / 2)),
      line(3, 'them', 'c'.repeat(MAX_CONTEXT_CHARS / 4)),
    ];
    expect(clampTranscript(lines, MAX_CONTEXT_CHARS).map((l) => l.id)).toEqual([2, 3]);
  });
  it('returns all lines when under budget', () => {
    expect(clampTranscript([line(1, 'them', 'a'), line(2, 'me', 'b')])).toHaveLength(2);
  });
});

describe('chatStream (mock OpenAI-compatible server)', () => {
  let server: Server;
  let baseUrl: string;
  let lastReq: { url?: string; auth?: string; body?: any } = {};
  let behavior: 'stream' | 'error401' | 'slow' | 'json' = 'stream';

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        lastReq = { url: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') };
        if (behavior === 'error401') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end('{"error":{"message":"bad key"}}');
          return;
        }
        if (behavior === 'json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: '好' } }],
              usage: { prompt_tokens: 100, prompt_cache_hit_tokens: 64, prompt_cache_miss_tokens: 36 },
            }),
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunks = [
          'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"建议"}}]}\n\ndata: {"choices":[{"delta":{"content":"这样"}}]}\n\n',
          // split one event across two TCP writes
          'data: {"choices":[{"delta":{"content":"回',
          '答"}}]}\n\n',
          'data: [DONE]\n\n',
        ];
        if (behavior === 'slow') {
          let i = 0;
          const timer = setInterval(() => {
            if (i < chunks.length) res.write(chunks[i++]);
            else {
              clearInterval(timer);
              res.end();
            }
          }, 40);
          req.on('close', () => clearInterval(timer));
        } else {
          for (const c of chunks) res.write(c);
          res.end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}/v1`;
  });

  afterAll(() => {
    server.close();
  });

  const cfg = () => ({ baseUrl, model: 'deepseek-v4-flash', apiKey: 'sk-test' });
  const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }];

  it('sends the right request shape and assembles streamed deltas', async () => {
    behavior = 'stream';
    const deltas: string[] = [];
    const r = await chatStream(cfg(), msgs, { onDelta: (d) => deltas.push(d) });
    expect(r.text).toBe('建议这样回答');
    expect(deltas.join('')).toBe('建议这样回答');
    expect(lastReq.url).toBe('/v1/chat/completions');
    expect(lastReq.auth).toBe('Bearer sk-test');
    expect(lastReq.body.model).toBe('deepseek-v4-flash');
    expect(lastReq.body.stream).toBe(true);
    expect(lastReq.body.messages).toEqual(msgs);
  });

  it('passes multimodal content through unchanged (vision payloads)', async () => {
    behavior = 'stream';
    const vmsgs = buildVisionMessages('看图', 'data:image/png;base64,BBB');
    await chatStream(cfg(), vmsgs, { onDelta: () => {} });
    expect(lastReq.body.messages).toEqual(JSON.parse(JSON.stringify(vmsgs)));
  });

  it('throws a useful error on HTTP failure', async () => {
    behavior = 'error401';
    await expect(chatStream(cfg(), msgs, { onDelta: () => {} })).rejects.toThrow(/401/);
  });

  it('chatOnce: non-streaming, max_tokens for prewarm, returns cache usage', async () => {
    behavior = 'json';
    const r = await chatOnce(cfg(), buildPrewarmMessages('前缀'), { maxTokens: 1 });
    expect(r.text).toBe('好');
    expect(r.usage?.prompt_cache_hit_tokens).toBe(64);
    expect(r.usage?.prompt_cache_miss_tokens).toBe(36);
    expect(lastReq.body.stream).toBe(false);
    expect(lastReq.body.max_tokens).toBe(1);
    expect(lastReq.body.messages[0].content).toBe('前缀');
  });

  it('chatOnce: omits max_tokens by default and honors temperature (memo path)', async () => {
    behavior = 'json';
    await chatOnce(cfg(), [{ role: 'user', content: 'x' }], { temperature: 0.2 });
    expect(lastReq.body.max_tokens).toBeUndefined();
    expect(lastReq.body.temperature).toBe(0.2);
  });

  it('supports aborting mid-stream', async () => {
    behavior = 'slow';
    const ac = new AbortController();
    const deltas: string[] = [];
    const p = chatStream(cfg(), msgs, { onDelta: (d) => deltas.push(d) }, ac.signal);
    setTimeout(() => ac.abort(), 100);
    await expect(p).rejects.toThrow();
    expect(deltas.join('').length).toBeLessThan('建议这样回答'.length);
  });
});
