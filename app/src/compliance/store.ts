// React side of consent.ts / reports.ts: module-level state (no provider needed), persisted in AsyncStorage,
// read through useSyncExternalStore. Nothing here talks to the network.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AI_CONSENT_VERSION, CONSENT_STORAGE_KEY, consentCurrent, makeConsent, readConsent, writeConsent, type ConsentRecord } from './consent';
import { addReport, makeReport, readReports, removeReport, writeReports, type AnswerReport, type ReportReason } from './reports';

type Listener = () => void;
function emitter() {
  const ls = new Set<Listener>();
  return {
    subscribe(fn: Listener) {
      ls.add(fn);
      return () => void ls.delete(fn);
    },
    emit() {
      for (const l of Array.from(ls)) l();
    },
  };
}

// ---------------------------------------------------------------- consent

type ConsentState = { loaded: boolean; record: ConsentRecord | null };
let consent: ConsentState = { loaded: false, record: null };
const consentBus = emitter();
let consentLoad: Promise<void> | null = null;

function loadConsent(): Promise<void> {
  consentLoad ??= readConsent(AsyncStorage).then((record) => {
    // an accept() that happened while loading wins
    if (!consent.loaded) consent = { loaded: true, record };
    consentBus.emit();
  });
  return consentLoad;
}

/** Store the consent for the current text version. */
export async function acceptAiConsent(): Promise<void> {
  const record = makeConsent(AI_CONSENT_VERSION);
  consent = { loaded: true, record };
  consentBus.emit();
  settleConsentPrompt(true);
  await writeConsent(AsyncStorage, record).catch(() => {});
}

/** Withdraw the stored consent (the next remote send / voice use asks again). */
export async function revokeAiConsent(): Promise<void> {
  consent = { loaded: true, record: null };
  consentBus.emit();
  await AsyncStorage.removeItem(CONSENT_STORAGE_KEY).catch(() => {});
}

// Consent requested by non-chat code (remote voice: voice/consentGate.ts): <ConsentHost/> shows the sheet.
let promptWaiters: Array<(accepted: boolean) => void> = [];
const promptBus = emitter();
let promptOpen = false;

/** Answer a waiting requestAiConsent() (used by <ConsentHost/> "Später" and by tests). */
export function settleConsentPrompt(accepted: boolean): void {
  const ws = promptWaiters;
  promptWaiters = [];
  promptOpen = false;
  promptBus.emit();
  for (const w of ws) w(accepted);
}

/** Is a requestAiConsent() waiting for an answer? */
export const consentPromptOpen = (): boolean => promptOpen;

/** Ask for the AI data-sharing consent now. Resolves true once accepted (immediately when already current). */
export async function requestAiConsent(): Promise<boolean> {
  if (await isAiConsentCurrent()) return true;
  return new Promise<boolean>((resolve) => {
    promptWaiters.push(resolve);
    promptOpen = true;
    promptBus.emit();
  });
}

/** <ConsentHost/>: is a requestAiConsent() waiting, and the sheet's answers. */
export function useConsentPrompt(): { open: boolean; accept: () => void; later: () => void } {
  const open = useSyncExternalStore(promptBus.subscribe, () => promptOpen, () => promptOpen);
  return { open, accept: () => void acceptAiConsent(), later: () => settleConsentPrompt(false) };
}

/** Consent state; `current` = accepted for the current text version. Starts loading on first use. */
export function useAiConsent(): { loaded: boolean; current: boolean; accept: () => Promise<void> } {
  const state = useSyncExternalStore(consentBus.subscribe, () => consent, () => consent);
  useEffect(() => {
    void loadConsent();
  }, []);
  return { loaded: state.loaded, current: consentCurrent(state.record), accept: acceptAiConsent };
}

/** Synchronous view: true/false once the stored consent is loaded, null before (then use isAiConsentCurrent). */
export function aiConsentCurrentNow(): boolean | null {
  return consent.loaded ? consentCurrent(consent.record) : null;
}

/** Non-React check (e.g. onboarding deciding whether to show the consent step). */
export async function isAiConsentCurrent(): Promise<boolean> {
  await loadConsent();
  return consentCurrent(consent.record);
}

// ---------------------------------------------------------------- reports

let reports: AnswerReport[] = [];
let reportsLoaded = false;
const reportsBus = emitter();
let reportsLoad: Promise<void> | null = null;
/** answers the user chose to show again ("Gemeldet – anzeigen?") – this app session only */
let revealed: ReadonlySet<string> = new Set();

function loadReports(): Promise<void> {
  reportsLoad ??= readReports(AsyncStorage).then((list) => {
    // reports added while loading are merged on top of the stored ones
    let merged = list;
    for (const r of reports) merged = addReport(merged, r);
    reports = merged;
    reportsLoaded = true;
    reportsBus.emit();
  });
  return reportsLoad;
}

async function persistReports(): Promise<void> {
  await loadReports();
  await writeReports(AsyncStorage, reports).catch(() => {});
}

export function reportAnswer(input: { messageId: string; conversationId?: string; reason: ReportReason; comment?: string }): AnswerReport {
  const r = makeReport(input);
  reports = addReport(reports, r);
  if (revealed.has(r.messageId)) {
    const next = new Set(revealed);
    next.delete(r.messageId);
    revealed = next;
  }
  reportsBus.emit();
  void persistReports();
  return r;
}

export function withdrawReport(messageId: string): void {
  reports = removeReport(reports, messageId);
  reportsBus.emit();
  void persistReports();
}

export function revealReported(messageId: string, show = true): void {
  const next = new Set(revealed);
  if (show) next.add(messageId);
  else next.delete(messageId);
  revealed = next;
  reportsBus.emit();
}

type ReportView = { report: AnswerReport | undefined; hidden: boolean };
const NONE: ReportView = { report: undefined, hidden: false };
const viewCache = new Map<string, ReportView>();

function viewOf(messageId: string): ReportView {
  const report = reports.find((r) => r.messageId === messageId);
  if (!report) {
    viewCache.delete(messageId);
    return NONE;
  }
  const hidden = !revealed.has(messageId);
  const prev = viewCache.get(messageId);
  if (prev && prev.report === report && prev.hidden === hidden) return prev;
  const v = { report, hidden };
  viewCache.set(messageId, v);
  return v;
}

/** Report state of one answer (stable object while nothing changes → cheap for memoized rows). */
export function useAnswerReport(messageId: string): ReportView & { reveal: () => void; hideAgain: () => void } {
  const snap = useCallback(() => viewOf(messageId), [messageId]);
  const view = useSyncExternalStore(reportsBus.subscribe, snap, snap);
  useEffect(() => {
    if (!reportsLoaded) void loadReports();
  }, []);
  const reveal = useCallback(() => revealReported(messageId, true), [messageId]);
  const hideAgain = useCallback(() => revealReported(messageId, false), [messageId]);
  return { ...view, reveal, hideAgain };
}
