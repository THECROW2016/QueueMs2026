type Op = [method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, tag: string, summary: string, permission?: string];

/** Compact route table: the single source for the generated OpenAPI document. Keep in step with the routers. */
const OPS: Op[] = [
  ['post', '/auth/login', 'Auth', 'Sign in. Sets an HttpOnly session cookie and returns the CSRF token. Rate limited; accounts lock after repeated failures.'],
  ['get', '/auth/me', 'Auth', 'Current user, roles, permissions and a fresh CSRF token'],
  ['post', '/auth/logout', 'Auth', 'End the session'],
  ['post', '/auth/change-password', 'Auth', 'Change own password (revokes other sessions)'],
  ['post', '/auth/reset-password', 'Auth', 'Complete an administrator-issued password reset using a one-time token'],
  ['get', '/public/display', 'Public display', 'PII-free snapshot for the waiting-room screen (ticket numbers, counters, counts). Rate limited, no authentication.'],

  ['get', '/users', 'Administration', 'List users', 'users.manage'], ['post', '/users', 'Administration', 'Create a user', 'users.manage'],
  ['get', '/users/{id}', 'Administration', 'Get a user', 'users.manage'], ['patch', '/users/{id}', 'Administration', 'Update a user, roles, departments or active state', 'users.manage'],
  ['post', '/users/{id}/reset-password', 'Administration', 'Issue a one-time reset token', 'users.manage'], ['get', '/roles', 'Administration', 'List roles and permissions', 'users.manage'],
  ['get', '/departments', 'Administration', 'List departments'], ['post', '/departments', 'Administration', 'Create a department', 'departments.manage'], ['patch', '/departments/{id}', 'Administration', 'Update a department', 'departments.manage'],
  ['get', '/counters', 'Administration', 'List counters / rooms'], ['post', '/counters', 'Administration', 'Create a counter or room', 'counters.manage'], ['patch', '/counters/{id}', 'Administration', 'Update a counter or room', 'counters.manage'],
  ['get', '/routing-rules', 'Administration', 'List routing rules'], ['put', '/routing-rules', 'Administration', 'Create or update a routing rule', 'routing.manage'], ['delete', '/routing-rules/{id}', 'Administration', 'Delete a routing rule', 'routing.manage'],
  ['get', '/settings', 'Administration', 'Read settings'], ['patch', '/settings', 'Administration', 'Update settings', 'settings.manage'], ['get', '/audit-logs', 'Administration', 'Search the audit log', 'audit.view'],

  ['post', '/patients', 'Patients', 'Register a patient (duplicate check; 409 DUPLICATE_SUSPECTED unless confirmDuplicate)', 'patient.register'],
  ['get', '/patients', 'Patients', 'Search patients (q, min 2 chars)', 'patient.search'], ['get', '/patients/{id}', 'Patients', 'Get a patient', 'patient.view'], ['patch', '/patients/{id}', 'Patients', 'Edit a patient', 'patient.edit'],
  ['post', '/visits', 'Visits', 'Open a visit and issue the first ticket (idempotent via idempotencyKey)', 'visit.create'],
  ['get', '/visits', 'Visits', 'List visits the caller may see', 'visit.view'], ['get', '/visits/{id}', 'Visits', 'Get a visit', 'visit.view'],
  ['post', '/visits/{id}/cancel', 'Visits', 'Cancel a visit and its open tickets (reason required)', 'visit.cancel'], ['post', '/visits/{id}/close', 'Visits', 'Close a visit', 'visit.close'],
  ['get', '/visits/{id}/journey', 'Visits', 'Patient journey: full timeline for clinical roles, restricted summary otherwise', 'journey.view'],

  ['get', '/departments/{id}/queue', 'Queue', 'Department queue', 'queue.view'], ['post', '/departments/{id}/call-next', 'Queue', 'Call the next ticket to a counter (concurrency safe)', 'queue.call'],
  ['get', '/tickets/{id}', 'Queue', 'Get a ticket', 'queue.view'], ['get', '/tickets/{id}/history', 'Queue', 'Ticket history', 'queue.view'], ['get', '/tickets/{id}/slip', 'Queue', 'Printable ticket slip data'],
  ['post', '/tickets/{id}/recall', 'Queue', 'Recall a called ticket', 'queue.call'], ['post', '/tickets/{id}/start', 'Queue', 'Start service', 'queue.serve'],
  ['post', '/tickets/{id}/hold', 'Queue', 'Put on hold', 'queue.serve'], ['post', '/tickets/{id}/resume', 'Queue', 'Resume from hold', 'queue.serve'],
  ['post', '/tickets/{id}/absent', 'Queue', 'Mark the patient absent', 'queue.absent'], ['post', '/tickets/{id}/restore', 'Queue', 'Restore an absent patient to the queue', 'queue.absent'],
  ['post', '/tickets/{id}/skip', 'Queue', 'Skip (reason required)', 'queue.skip'], ['post', '/tickets/{id}/cancel', 'Queue', 'Cancel (reason required)', 'queue.cancel'],
  ['post', '/tickets/{id}/complete', 'Queue', 'Complete and optionally route to next departments', 'queue.complete'], ['post', '/tickets/{id}/transfer', 'Queue', 'Transfer to another department', 'queue.transfer'],
  ['post', '/tickets/{id}/priority', 'Queue', 'Change priority (clinical staff)', 'queue.priority'], ['post', '/tickets/{id}/workflow', 'Queue', 'Set the department workflow stage', 'queue.serve'],
  ['post', '/tickets/{id}/result-status', 'Queue', 'Mark a result / report as pending or available', 'results.status.update'],

  ['get', '/visits/{id}/invoices', 'Billing', 'List invoices', 'billing.view'], ['post', '/visits/{id}/invoices', 'Billing', 'Create an invoice', 'billing.manage'],
  ['post', '/visits/{id}/clear-billing', 'Billing', 'Mark billing cleared', 'billing.manage'], ['post', '/invoices/{id}/payments', 'Billing', 'Record a confirmed payment', 'billing.manage'],
  ['post', '/invoices/{id}/void', 'Billing', 'Void an unpaid invoice', 'billing.manage'], ['get', '/payments/{id}/receipt', 'Billing', 'Receipt data', 'billing.view'],

  ['get', '/notifications', 'Notifications', 'List notifications for the caller\'s departments', 'notifications.view'], ['post', '/notifications/read', 'Notifications', 'Mark notifications read', 'notifications.view'],
  ['get', '/dashboard', 'Reports', 'Live hospital dashboard', 'dashboard.admin'], ['get', '/reports/summary', 'Reports', 'Summary for a date range (from, to, departmentId, includeCancelled, includeTest)', 'reports.view'],
  ['get', '/reports/departments', 'Reports', 'Per-department metrics', 'reports.view'], ['get', '/reports/daily', 'Reports', 'Per-day registrations and visits', 'reports.view'],
  ['get', '/reports/export', 'Reports', 'CSV export (report=departments|daily|longest-waits)', 'reports.export'],
  ['get', '/health', 'System', 'Liveness and database check (no authentication)'],
];

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [method, path, tag, summary, permission] of OPS) {
    const open = path.startsWith('/public') || path === '/health' || path === '/auth/login' || path === '/auth/reset-password';
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'integer' } }));
    (paths[path] ??= {})[method] = {
      tags: [tag], summary, ...(permission ? { description: `Requires permission \`${permission}\`; department-scoped where applicable.` } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(method !== 'get' && method !== 'delete' ? { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } : {}),
      ...(open ? { security: [] } : {}),
      responses: {
        '200': { description: 'Success' },
        ...(open ? {} : { '401': { $ref: '#/components/responses/Error' }, '403': { $ref: '#/components/responses/Error' } }),
        '400': { $ref: '#/components/responses/Error' }, '409': { $ref: '#/components/responses/Error' },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: { title: 'Hospital Queue Management System API', version: '1.0.0', description: 'Cookie-session API. After login, send the returned CSRF token in the `X-CSRF-Token` header on every non-GET request. Errors use `{ "error": { "code", "message", "details", "requestId" } }`. Real-time events are delivered over Socket.IO (see README).' },
    servers: [{ url: '/api' }],
    security: [{ cookieAuth: [] }],
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'hqms_sid' } },
      responses: { Error: { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } } } } } } } } },
    },
    paths,
  };
}
