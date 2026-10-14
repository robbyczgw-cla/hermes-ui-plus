// Guard for async continuations of a chat action (retry's recovery check): capture a ticket when the action starts,
// check it before acting on the result. Pure, tested in turnTicket.test.ts; used by useHermesChat.retry().
//   superseded – the session changed meanwhile (newSession / switch): the result belongs to nobody, touch nothing
//   stopped    – same session, but stop() was pressed (or another turn generation began): release the busy state only
//   current    – go on

export type TurnTicket = { readonly session: string; readonly gen: number };
export type TicketState = 'current' | 'stopped' | 'superseded';

export function takeTicket(session: string, gen: number): TurnTicket {
  return { session, gen };
}

export function checkTicket(t: TurnTicket, session: string, gen: number): TicketState {
  if (t.session !== session) return 'superseded';
  return t.gen === gen ? 'current' : 'stopped';
}
