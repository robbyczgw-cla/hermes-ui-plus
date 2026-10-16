"""Check registry + report (report.md / report.json) for scripts/e2e/suite.py."""
import json, os, time, traceback


class Fail(Exception):
    """a check failed: message is the one-line reason for the report"""


class Skip(Exception):
    """a check could not run (a prerequisite failed)"""


def expect(cond, msg):
    if not cond:
        raise Fail(msg)


class Report:
    def __init__(self, out, meta):
        self.out, self.meta = out, dict(meta)
        self.checks, self.metrics = [], {}
        self.t0 = time.time()
        os.makedirs(os.path.join(out, 'shots'), exist_ok=True)

    def run(self, cid, title, fn, on_fail=None, needs=()):
        """runs fn() as check cid; Fail/exception → FAIL (+ screenshot + UI dump via on_fail), Skip → SKIP"""
        missing = [n for n in needs if not self.passed(n)]
        t = time.time()
        rec = dict(id=cid, title=title, status='PASS', seconds=0.0, detail='', evidence={})
        print(f'{time.strftime("%H:%M:%S")} ▶ {cid}: {title}', flush=True)
        try:
            if missing:
                raise Skip('needs ' + ', '.join(missing))
            ev = fn()
            if isinstance(ev, dict):
                rec['evidence'] = ev
        except Skip as e:
            rec.update(status='SKIP', detail=str(e))
        except Fail as e:
            rec.update(status='FAIL', detail=str(e))
        except Exception as e:  # driver/adb error: also a FAIL, with the trace in the JSON
            rec.update(status='FAIL', detail=f'{type(e).__name__}: {e}', trace=traceback.format_exc()[-1500:])
        rec['seconds'] = round(time.time() - t, 1)
        if rec['status'] == 'FAIL' and on_fail:
            try:
                rec['artifacts'] = on_fail(cid)
            except Exception as e:
                rec['artifacts'] = {'error': str(e)}
        self.checks.append(rec)
        print(f'{time.strftime("%H:%M:%S")}   {rec["status"]} {cid} ({rec["seconds"]} s) {rec["detail"]}', flush=True)
        return rec['status'] == 'PASS'

    def passed(self, cid):
        return any(c['id'] == cid and c['status'] == 'PASS' for c in self.checks)

    def metric(self, key, value):
        self.metrics[key] = value

    @property
    def failed(self):
        return [c for c in self.checks if c['status'] == 'FAIL']

    def write(self):
        total = round(time.time() - self.t0, 1)
        counts = {s: sum(c['status'] == s for c in self.checks) for s in ('PASS', 'FAIL', 'SKIP')}
        verdict = 'PASS' if not counts['FAIL'] and counts['PASS'] else 'FAIL'
        data = dict(verdict=verdict, partial=self.meta.get('selection', 'all') != 'all', counts=counts, suite_seconds=total,
                    meta=self.meta, metrics=self.metrics, checks=self.checks)
        with open(os.path.join(self.out, 'report.json'), 'w') as f:
            json.dump(data, f, indent=1, ensure_ascii=False)
        m = self.meta
        sel = m.get('selection', 'all')
        partial = sel != 'all'
        L = [f'# E2E smoke: {verdict}' + (f' (subset: {sel})' if partial else ''), '']
        if partial:
            L += [f'**Partial run, not the full suite** ({sel}). Not run: {", ".join(m.get("not_run") or []) or "-"}.', '']
        L += [
             f'{counts["PASS"]} pass, {counts["FAIL"]} fail, {counts["SKIP"]} skip · suite {total:.0f} s'
             f' (+ emulator boot {m.get("boot_s", "?")} s) · {m.get("started", "")}', '',
             f'APK `{m.get("apk", "")}` sha256 {m.get("apk_sha256", "")[:16]} · version `{m.get("version_label", "?")}` · '
             f'device {m.get("device", "?")} · selectors {m.get("selectors", "?")}', '',
             '| | check | s | detail |', '|---|---|---:|---|']
        for c in self.checks:
            mark = {'PASS': '✅', 'FAIL': '❌', 'SKIP': '⏭'}[c['status']]
            detail = c['detail'] or ', '.join(f'{k}={v}' for k, v in list(c['evidence'].items())[:4] if not isinstance(v, (dict, list)))
            L.append(f'| {mark} | `{c["id"]}` {c["title"]} | {c["seconds"]} | {detail.replace("|", "/")[:220]} |')
        if self.metrics:
            L += ['', '## Metrics', '']
            L += [f'- **{k}**: {json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v}' for k, v in self.metrics.items()]
        fails = self.failed
        if fails:
            L += ['', '## Failures', '']
            for c in fails:
                L.append(f'### `{c["id"]}` {c["title"]}')
                L.append(f'- reason: {c["detail"]}')
                for k, v in (c.get('artifacts') or {}).items():
                    L.append(f'- {k}: `{v}`')
                L.append('')
        L += ['', 'Raw: report.json (evidence per check), mock-requests.json (every request the mock saw), logcat-*.txt, '
              'gfx-*.txt. Screenshots and UI dumps of failed checks in shots/.']
        with open(os.path.join(self.out, 'report.md'), 'w') as f:
            f.write('\n'.join(L) + '\n')
        return verdict
