/**
 * Ported from Pi Pocket `web/calls.js` (github.com/TannerMidd/pi-pocket, commit de612d5), MIT,
 * © 2026 Tanner Middleton – see NOTICE.md.
 *
 * A tool call in one line, as transcripts and peek tiles show it. Pure (node:test). Changes from Pocket: typed.
 */

const short = (text: unknown, max = 90): string => {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export type CallLike = { name: string; args?: Record<string, unknown> | null };
/** `icon`: a text glyph; `label`: the tool's word (empty for bash); `subject`: what it acts on; `mono`: code font. */
export type CallLine = { icon: string; label: string; subject: string; mono: boolean };

const str = (value: unknown): string => (value === undefined || value === null ? '' : String(value));

/** A tool call in one line: an icon, a label, and what it acts on. Peek tiles describe calls this way too. */
export function describeCall(call: CallLike): CallLine {
  const args = call.args ?? {};

  switch (call.name) {
    case 'read': {
      const range = args.offset ? `:${str(args.offset)}${args.limit ? `+${str(args.limit)}` : ''}` : '';

      return { icon: '▤', label: 'Read', subject: `${str(args.path)}${range}`, mono: true };
    }

    case 'write':
      return { icon: '✎', label: 'Write', subject: str(args.path), mono: true };
    case 'edit':
      return { icon: '✎', label: 'Edit', subject: str(args.path), mono: true };
    case 'bash':
      return { icon: '>_', label: '', subject: short(args.command, 140), mono: true };
    case 'artifact':
      return { icon: '✦', label: 'Artifact', subject: str(args.title ?? args.id), mono: false };

    case 'codemode': {
      // The first line that does something: not the options line, a comment, or blank.
      const line = String(args.code ?? '')
        .split('\n')
        .map((each) => each.trim())
        .find((each) => each !== '' && !each.startsWith('//'));

      return { icon: '{}', label: 'Codemode', subject: short(line ?? '', 140), mono: true };
    }

    case 'browser': {
      const firstLine = String(args.script ?? '')
        .split('\n')
        .find((each) => each.trim() !== '');
      const what =
        (args.url as string | undefined) ??
        (args.ref ? `[${String(args.ref).replace(/^\[|\]$/g, '')}]` : undefined) ??
        (args.selector as string | undefined) ??
        (args.label ? `“${str(args.label)}”` : undefined) ??
        (args.key as string | undefined) ??
        (args.viewport as string | undefined) ??
        firstLine ??
        (args.text !== undefined ? `“${str(args.text)}”` : '');
      const typed = args.action === 'type' && args.text !== undefined && what !== `“${str(args.text)}”` ? ` ← “${str(args.text)}”` : '';

      return { icon: '◎', label: `Browser ${str(args.action)}`, subject: short(`${str(what)}${typed}`, 120), mono: true };
    }

    case 'subagent':
      return {
        icon: '⧉',
        label: `Subagent ${str(args.action)}`,
        subject: [args.name, args.message && short(args.message, 60)].filter(Boolean).map(str).join(' · '),
        mono: true,
      };
    default:
      return { icon: '⚙', label: call.name, subject: short(JSON.stringify(args), 100), mono: true };
  }
}
