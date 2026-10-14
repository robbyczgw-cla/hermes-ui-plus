/**
 * Actions – executor for the HuiActions of SPEC-modules-v2 (see INTEGRATION.md).
 *
 *   <ActionRunnerProvider conversationId onToast onSend>   around the chat (renders the confirm sheet)
 *     const run = useActionRunner();  run({type:'calendar', …})   → Promise<ActionResult>
 *   <ActiveTimersBar />                                    floating timer pills
 *   appendToLatestChecklist / listBus                       add_to_list contract with the checklist module
 */
export { ActionRunnerProvider, useActionRunner, useOptionalActionRunner } from './ActionRunner';
export type { ActionRunnerProviderProps, RunAction, RunOptions } from './ActionRunner';
export { ActionConfirmSheet } from './ActionConfirmSheet';
export type { ActionConfirmSheetProps } from './ActionConfirmSheet';
export { ActiveTimersBar } from './ActiveTimersBar';
export type { ActiveTimersBarProps } from './ActiveTimersBar';
export { useTimers } from './useTimers';
export { getTimerStore } from './timers';
export { TimerStore } from './timerStore.ts';
export type { TimerRecord, TimerStatus } from './timerModel.ts';
export { formatClock } from './dates.ts';

export { validateAction, validateUrl, normalizePhone, isValidEmail, OPENABLE_SCHEMES } from './validate.ts';
export { describeAction, needsConfirmation } from './describe.ts';
export { executeAction } from './executor.ts';
export type { ExecEnv } from './executor.ts';
export { createNativeEnv } from './env';
export type { ValidAction, ValidationResult, ActionResult, ActionDescription } from './types.ts';

export { listBus, createListBus } from './listBus.ts';
export type { ListBus, ListBusEvent, ListBusListener } from './listBus.ts';
export { appendToLatestChecklist } from './appendToLatestChecklist';
export { isChecklistState, pickChecklist, appendItems, DEFAULT_LIST_TITLE } from './lists.ts';
export type { ChecklistNodeState, ChecklistStateItem, AppendResult } from './lists.ts';
