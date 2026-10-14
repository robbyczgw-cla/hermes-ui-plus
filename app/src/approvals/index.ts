/**
 * Approvals workstream – UI for Hermes `approval.request` events. See INTEGRATION.md.
 *
 *   <ApprovalSheet approval={chat.approval} onRespond={chat.respondApproval} onDismiss={hide} />
 *   <ApprovalStack approvals={chat.approvals} onRespond={chat.respondApprovalFor} onClose={chat.dismissApproval} />
 *   <ApprovalHistory log={message.approvalLog} />   persistent rows in the message
 *   openPendingApproval(conversationId, runId)       notification tap entry point
 *   <ApprovalDemo />    visual-check gallery (mount from a route file)
 */
export { ApprovalSheet } from './ApprovalSheet';
export type { ApprovalSheetProps } from './ApprovalSheet';
export { ApprovalDemo } from './ApprovalDemo';
export { ApprovalStack } from './ApprovalStack';
export type { ApprovalStackProps } from './ApprovalStack';
export { ApprovalHistory } from './ApprovalHistory';
export { openPendingApproval, takePendingApproval, onPendingApproval } from './stackModel';
export type { PendingApprovalTarget } from './stackModel';
export { usePendingApprovalTarget } from './usePendingApprovalTarget';
export {
  toApprovalView,
  normalizeChoices,
  assessRisk,
  describeResponseError,
  formatCountdown,
  remainingSeconds,
  remainingFraction,
  DEFAULT_APPROVAL_TIMEOUT_S,
  historyLine,
  needsConfirm,
} from './approvalModel';
export type { ApprovalChoiceValue, ApprovalInput, ApprovalView, ChoiceView, ChoiceKind, RiskLevel, ResponseError } from './approvalModel';
