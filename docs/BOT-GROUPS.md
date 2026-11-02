# Bot groups (beta)

A group chat of 2 to 6 of your bots. You write once; the bots you name answer, hand work to each other and stop when
they have nothing to add. Off until the owner of the server switches it on.

## Switch it on

Groups need the UI bridge with a state directory (the setup wizard creates one) and at least two bots
(see [BOTS-SERVER.md](BOTS-SERVER.md)).

```sh
hermes-ui-plus-bridge groups enable     # or: disable, status
```

`BRIDGE_GROUPS=on|off` in the bridge's environment overrides the switch. With the admin token the app can also flip it
(`PUT /bridge/groups/rights {"enabled": true}`). Once it is on, every paired device sees the "Group" button in the Bots
tab; paired devices cannot change the switch.

## How a round works

- A message starts a round. The bots you name with `@` answer, in that order. Without `@` the first bot of the group
  (the leader) answers. `@alle` / `@all` / `@everyone` / `@todos` asks every member.
- A bot with nothing new to add answers exactly `(pass)` and stays invisible. A bot you named directly that passes is
  asked once more to answer or say why it cannot.
- A bot that names a teammate with `@` hands work over: the group shows a grey line ("Hermes to Scout: compare train
  prices") and that teammate gets the next turn.
- At most 8 turns per message, passes included: every turn is one model call. Then the group waits for you and says
  who is still open. "Stop" ends the round at once; a half-written answer stays marked as stopped.
- If nobody had anything to add, the group says so instead of staying silent.

The rules travel in each member's turn, so every existing bot can join a group without a change to its profile.

## Approvals stay out of the group

When a member needs your approval (a command, a deletion), the group only shows "Scout is waiting for an approval in
its chat" with "Open". The card itself is in that bot's own chat, marked "From the group …", and the usual approval
push names the bot. The round goes on after you answered there (or Hermes' approval timeout ran out).

## What runs where

Hermes has hosted rooms (`groups.*`), but in Hermes v0.22.x they are only reachable through the dashboard WebSocket
with the admin credential; the API server has no room hosting. So the bridge drives the rounds over the normal chat API:

- each member talks in its own hidden Hermes session titled `Group: <group id>` (session id
  `huigroup-<group id>-<bot>`, the same title Hermes Desktop uses for its groups), fed only the room messages that are
  new since its last turn;
- the bridge keeps the group's log in `<state-dir>/groups.json` (at most 30 groups, the last 400 entries each);
- at most 3 groups answer at the same time on one bridge;
- deleting a group deletes its member sessions on Hermes; the bots and their own chats stay.

A bridge restart in the middle of a round ends it; the group then says the round was interrupted.

## API (bridge)

| Route | |
|---|---|
| `GET /bridge/groups` | `{enabled, reason?, admin, limits, groups, approvals}`; `reason`: `owner_off`, `bridge_off` |
| `POST /bridge/groups` | `{name, members}` (2 to 6 bot names, `default` for the main profile) → `201 {group}` |
| `GET /bridge/groups/<id>?since=<seq>` | `{group, seq, entries, round}`; `round` while it runs: turns, speaker, partial text, waiting approvals |
| `PATCH /bridge/groups/<id>` | `{name?, members?}` |
| `DELETE /bridge/groups/<id>` | `204` |
| `POST /bridge/groups/<id>/messages` | `{text}` → `202`; `409 round_running` while the group answers |
| `POST /bridge/groups/<id>/stop` | `{stopped}` |
| `GET/PUT /bridge/groups/rights` | admin token only: `{setting, enabled}` |

Errors: `groups_off` (404), `unknown_group` (404), `invalid_members` (400), `round_running` (409), `members_gone`
(409, fewer than two members still served), `busy` (429), `limit` (409).

Entries: `user`, `bot` (`partial` when stopped), `handoff` (`bot` → `to`, `text` = the handed-over sentence) and `note`
(`approval`, `error` with a code, `capped` with the bots still waiting, `stopped`, `quiet`, `interrupted`).
