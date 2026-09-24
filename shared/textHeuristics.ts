/**
 * Shared pure text heuristics used by both the renderer (continuous-mode gate)
 * and the main process (prompt building). Kept in shared/ so neither side
 * imports across the electron/renderer project boundary.
 */

const QUESTION_WORDS =
  /(what|how|why|whether|can you|could you|is it possible|should we|is there|please|talk about|discuss|introduce|tell me|explain|what do you think|how do you see|how many|which|\?|\bwhen\b|\bwhere\b|\bwould you\b)/i;

/**
 * Does the other party's line look like a question worth auto-answering
 * (continuous-mode gate, to avoid answering every fragment)?
 */
export function isLikelyQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (/[?？]$/.test(t)) return true;
  if (QUESTION_WORDS.test(t)) return true;
  // long utterances often carry an implicit ask even without a marker
  return t.length >= 40;
}

// ---------- question-type hint (prompt v2) ----------

export type QuestionKind = 'behavioral' | 'technical' | 'smalltalk' | 'other';

/** greetings / audio checks / pleasantries — a one-liner reply is enough */
const SMALLTALK =
  /(hello|hi|hey|good (morning|afternoon|evening)|can you hear me|can you hear clearly|is the audio clear|signal|network( good| not good| issue)|microphone|sorry|thanks for waiting|appreciate your effort|thanks for your time|shall we start|are you ready|have we started|nice to meet)/i;

/** experience / motivation / self-intro — answer with STAR from the resume */
const BEHAVIORAL =
  /(introduce yourself|tell me about yourself|(why|what made you).{0,12}(leave|quit|change jobs|switch jobs|join us|choose us|apply|apply for)|reason for leaving|strengths|weaknesses|strengths and weaknesses|most memorable|greatest achievement|(biggest|most difficult) (challenge|difficulty|failure)|how.*(challenge|handle)|failure experience|colleague.*(conflict|disagreement)|teamwork|team conflict|how (do you )?(lead|manage) a team|how.*handle pressure|what do you think about overtime|career (plan|development)|future plan|salary expectation|do you have any questions|why (do|did|would) you (want|leave|join|choose)|(greatest|biggest) (strength|weakness|challenge|failure)|a time (when|you)|conflict with|career (plan|goal)|salary expectation)/i;

/** knowledge / design / algorithm — answer with idea → key points → complexity */
const TECHNICAL =
  /(algorithm|complexity|data structure|linked list|binary tree|hash|sorting|dynamic programming|write code|implement (a|some)? (code|function)|architecture|system design|design a|what is|principle|underlying|source code|implementation|difference|compare|pros and cons|optimization|performance tuning|performance|concurrency|multithreading|thread|process|coroutine|lock|deadlock|memory (leak|management|model)|garbage collection|index|transaction|isolation level|distributed|consistency|high availability|cache|message queue|rate limiting|http|https|tcp|udp|dns|rest|grpc|sql|nosql|redis|kafka|mysql|mongo|docker|k8s|kubernetes|linux|shell|git|python|java(script)?|typescript|golang|rust|c\+\+|react|vue|node|spring|django|machine learning|deep learning|neural network|large language model|transformer|fine-tuning|inference|training|prompt|rag|agent|embedding|how (does|do|would) .+ work|difference between|implement|time complexity|design (a|an)|explain how)/i;

/**
 * Rough interview-question triage. The result only feeds a one-line hint in
 * the user message (zero latency, advisory — the model may override it), so
 * precision matters more than recall: unknown stays 'other' (no hint).
 * Order: smalltalk (short pleasantries) → behavioral → technical.
 */
export function classifyQuestion(text: string): QuestionKind {
  const t = text.trim();
  if (!t) return 'other';
  if (t.length <= 30 && SMALLTALK.test(t) && !TECHNICAL.test(t)) return 'smalltalk';
  if (BEHAVIORAL.test(t)) return 'behavioral';
  if (TECHNICAL.test(t)) return 'technical';
  return 'other';
}
