/** Response shapes of the Hermes session API as returned by a Hermes Agent server (2026-10-10), ids/texts shortened. Test data only. */
export const LIST_FIXTURE = {
  object: 'list',
  limit: 25,
  offset: 0,
  has_more: true,
  data: [
    { id: 'hermes-ui-dev-1791659144', source: 'api_server', title: 'Nur mit OK antworten', message_count: 6, started_at: 1791659146.34572, last_active: 1791659157.6420763, preview: 'Antworte nur mit OK', pinned: false, archived: false, hidden: false, parent_session_id: null, is_internal_child: false, tool_call_count: 1, model: 'kimi-k2' },
    { id: '20260820_061107_454a1c7f', source: 'telegram', title: 'Hoffe der Login klappt', message_count: 176, started_at: 1787206267.472091, last_active: 1791657861.921712, preview: 'Hoffe der Login geht gut ??', pinned: false, parent_session_id: 'x' },
    { id: 'broken' },
    { source: 'cli' },
  ],
};

export const MESSAGES_FIXTURE = {
  object: 'list',
  session_id: 'hermes-ui-dev-1791659144',
  pagination: { limit: 50, offset: 0, order: 'latest', returned: 6 },
  data: [
    { id: 339193, session_id: 'hermes-ui-dev-1791659144', role: 'user', content: 'Antworte nur mit OK', tool_call_id: null, tool_calls: null, tool_name: null, timestamp: 1791659146.2172606, finish_reason: null, reasoning: null, reasoning_content: null, display_kind: null },
    { id: 339194, role: 'assistant', content: 'OK', tool_calls: null, timestamp: 1791659148.8001847, finish_reason: 'stop', reasoning: null },
    { id: 339195, role: 'user', content: 'Wie spät ist es? Nutze ein Tool falls nötig', timestamp: 1791659152.423901 },
    {
      id: 339196,
      role: 'assistant',
      content: 'Ich hole die aktuelle Uhrzeit direkt vom System.',
      tool_calls: [
        {
          id: 'call-f29c2b49-f3b3-4e0c-a08c-7a64aed091ee-0',
          call_id: 'call-f29c2b49-f3b3-4e0c-a08c-7a64aed091ee-0',
          response_item_id: 'fc_x',
          type: 'function',
          function: { name: 'terminal', arguments: '{"command":"date"}' },
        },
      ],
      timestamp: 1791659154.1279283,
      finish_reason: 'tool_calls',
    },
    { id: 339197, role: 'tool', content: '{"output": "Sat Oct 10 19:05:54 UTC 2026", "exit_code": 0, "error": null}', tool_call_id: 'call-f29c2b49-f3b3-4e0c-a08c-7a64aed091ee-0', tool_name: 'terminal', timestamp: 1791659154.189734 },
    { id: 339198, role: 'assistant', content: 'Samstag, 10. Oktober 2026, 21:05 Uhr.', timestamp: 1791659157.6420763, finish_reason: 'stop', reasoning: 'Der Nutzer fragt nach der aktuellen Uhrzeit.', reasoning_content: 'Der Nutzer fragt nach der aktuellen Uhrzeit.' },
  ],
};

