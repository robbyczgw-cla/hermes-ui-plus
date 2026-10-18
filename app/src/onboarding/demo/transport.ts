// Offline demo transport: turns a scenario into the same SSE text the mock server / Hermes would send
// (OpenAI chunks + `hermes.tool.progress`, `hermes.status`, `hermes.ui.route`, `approval.request`) and
// feeds it through the real SSE parser and frame mapper (hermes/sse.ts + hermes/events.ts), so the
// demo exercises the production parsing + rendering path. No network. Pure (timers injectable), tested.
import { createSseParser } from '../../hermes/sse.ts';
import { mapFrame } from '../../hermes/events.ts';
import { toolDetailFrom } from '../../hermes/sessionMapping.ts';
import type { ApprovalChoice, HermesEvent } from '../../hermes/types';
import { L, pickScenario, type DemoLang, type DemoStep } from './scenarios.ts';

export type DemoTiming = {
  /** delay per prose token (ms) */
  token: () => number;
  /** delay per chunk inside fenced code / hui blocks (bigger chunks) */
  block: () => number;
  /** scale for scripted waits / tool durations (1 = as scripted, 0 = instant) */
  waitScale: number;
};

/** Mock-like jitter: 12–38 ms per token. */
export const DEFAULT_TIMING: DemoTiming = {
  token: () => 12 + Math.random() * 26,
  block: () => 10 + Math.random() * 14,
  waitScale: 1,
};
export const INSTANT_TIMING: DemoTiming = { token: () => 0, block: () => 0, waitScale: 0 };

export type DemoTurnParams = {
  text: string;
  sessionId: string;
  /** UI language of the chat (default German) */
  lang?: DemoLang;
  /** 1-based number of this turn in the session */
  turn: number;
  /** earlier user messages, newest first (a reformat chip reshapes the last answer that is not itself a reformat) */
  history?: string[];
  signal?: AbortSignal;
  onEvent: (ev: HermesEvent) => void;
  /** resolves with the user's choice for an approval request (DemoSession wires the approval sheet) */
  waitForApproval: (runId: string) => Promise<ApprovalChoice | 'timeout'>;
  timing?: DemoTiming;
  now?: () => Date;
  /** sleep implementation (tests) */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type DemoTurnResult = { aborted: boolean; scenario: string };

const frame = (data: unknown, event?: string) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;

/** Prose → word-ish tokens (≤ 7 chars, like the mock); fenced blocks → 24–40 char slices. */
export function tokenize(text: string): { tok: string; block: boolean }[] {
  const out: { tok: string; block: boolean }[] = [];
  const parts = text.split(/(```[\s\S]*?(?:```|$))/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('```')) {
      for (let i = 0; i < part.length; ) {
        const n = 24 + ((i * 7) % 17);
        out.push({ tok: part.slice(i, i + n), block: true });
        i += n;
      }
      continue;
    }
    for (const m of part.match(/\s*\S+|\s+/g) ?? []) {
      let s = m;
      while (s.length > 7) {
        const n = 3 + (s.length % 4);
        out.push({ tok: s.slice(0, n), block: false });
        s = s.slice(n);
      }
      if (s) out.push({ tok: s, block: false });
    }
  }
  return out;
}

function abortError(): Error {
  const e = new Error('Abgebrochen');
  e.name = 'AbortError';
  return e;
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

let seq = 0;
function completionId(): string {
  seq = (seq + 1) % 1e6;
  return `chatcmpl-demo-${Date.now().toString(36)}${seq.toString(36)}`;
}

/** Replay one demo turn. Resolves when finished; `aborted` when the signal fired. Never throws for aborts. */
export async function runDemoTurn(p: DemoTurnParams): Promise<DemoTurnResult> {
  const timing = p.timing ?? DEFAULT_TIMING;
  const sleep = p.sleep ?? defaultSleep;
  const { name, scenario } = pickScenario(p.text);
  const lang = p.lang ?? 'de';
  const previousScenario = (p.history ?? []).map((h) => pickScenario(h).name).find((n) => n !== 'reformat');
  const steps: DemoStep[] = scenario.steps({ userText: p.text, turn: p.turn, sessionId: p.sessionId, now: (p.now ?? (() => new Date()))(), lang, previousScenario });
  const id = completionId();
  const model = 'hermes-demo';
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}) => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  });

  const parser = createSseParser();
  const write = (sse: string) => {
    for (const f of parser.push(sse)) for (const ev of mapFrame(f)) p.onEvent(ev);
  };
  const wait = (ms: number) => sleep(Math.round(ms * timing.waitScale), p.signal);
  let all = '';
  let toolSeq = 0;
  const usage = () => ({ prompt_tokens: 1200 + p.text.length, completion_tokens: Math.ceil(all.length / 4), total_tokens: 1200 + p.text.length + Math.ceil(all.length / 4) });

  try {
    await wait(120);
    write(frame({ format: scenario.format, confidence: scenario.format === 'text' ? 0.62 : 0.93, reason: L({ lang }, `Demo-Szenario „${name}“`, `Demo scenario “${name}”`, `Escenario de demo «${name}»`), model: 'demo-router', ms: 0 }, 'hermes.ui.route'));
    write(frame(chunk({ role: 'assistant' })));
    await wait(250);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if ('text' in step) {
        for (const { tok, block } of tokenize(step.text)) {
          all += tok;
          write(frame(chunk({ content: tok })));
          await sleep(block ? timing.block() : timing.token(), p.signal);
        }
      } else if ('reasoning' in step) {
        for (const { tok } of tokenize(step.reasoning)) {
          write(frame(chunk({ reasoning_content: tok })));
          await sleep(timing.token(), p.signal);
        }
      } else if ('tool' in step) {
        const callId = `call-demo-${id}-${toolSeq++}`;
        write(frame({ tool: step.tool.name, emoji: step.tool.emoji, label: step.tool.label, toolCallId: callId, status: 'running' }, 'hermes.tool.progress'));
        await wait(step.tool.ms);
        write(frame({ tool: step.tool.name, toolCallId: callId, status: 'completed' }, 'hermes.tool.progress'));
        const result = step.tool.result;
        if (result) {
          // what Hermes stores for the call (arguments + raw result), as the post-turn session fetch would add it
          const { detail } = toolDetailFrom({ id: callId, name: step.tool.name, arguments: result.args }, { id: callId, role: 'tool', content: result.output, toolCallId: callId });
          p.onEvent({ type: 'tool', callId, name: step.tool.name, status: 'done', detail });
        }
      } else if ('status' in step) {
        write(frame(step.status, 'hermes.status'));
      } else if ('wait' in step) {
        await wait(step.wait);
      } else if ('approval' in step) {
        const a = step.approval;
        write(
          frame(
            {
              command: a.command,
              pattern_key: a.pattern_key,
              pattern_keys: a.pattern_keys,
              description: a.description,
              // the demo offers exactly "Allow once" / "Deny": a global allowlist makes no sense without a server
              allow_permanent: false,
              allow_session: false,
              request_id: `req-${id}`,
              run_id: id,
              timestamp: Date.now() / 1000,
              session_id: p.sessionId,
              choices: ['once', 'deny'],
            },
            'approval.request',
          ),
        );
        const choice = await raceAbort(p.waitForApproval(id), p.signal);
        const denied = choice === 'deny' || choice === 'timeout';
        const follow: DemoStep[] = denied
          ? (a.deny ?? [{ text: L({ lang }, '\n\nOkay, der Befehl wurde abgelehnt; ich lasse alles unverändert.', '\n\nOkay, the command was denied; I am leaving everything unchanged.', '\n\nDe acuerdo, el comando fue denegado; dejo todo sin cambios.') }])
          : (a.allow ?? [{ tool: { name: 'terminal', label: a.command, emoji: '\u{1F4BB}', ms: 800 } }, { text: L({ lang }, '\n\nErledigt. Im Demo-Modus wurde natürlich nichts ausgeführt.', '\n\nDone. Of course nothing was run in demo mode.', '\n\nHecho. Por supuesto, en el modo demo no se ejecutó nada.') }]);
        steps.splice(i + 1, 0, ...follow);
      } else if ('fail' in step) {
        const msg = L({ lang }, 'Demo-Fehler: Werkzeug terminal wurde mit Exit-Code 1 beendet.', 'Demo error: the terminal tool exited with code 1.', 'Error de demo: la herramienta terminal terminó con el código 1.');
        write(frame(chunk({}, 'error', { usage: usage(), error: { message: msg, type: 'agent_error' }, hermes: { completed: false, partial: true, failed: true, error: msg, error_code: 'agent_error' } })));
        write('data: [DONE]\n\n');
        return { aborted: false, scenario: name };
      }
    }
    write(frame(chunk({}, 'stop', { usage: usage() })));
    write('data: [DONE]\n\n');
    for (const f of parser.flush()) for (const ev of mapFrame(f)) p.onEvent(ev);
    return { aborted: false, scenario: name };
  } catch (e) {
    if (p.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) return { aborted: true, scenario: name };
    throw e;
  }
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
