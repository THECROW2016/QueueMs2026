/** Static definitions shared by the seed script, the services and the tests. */

export const PERMISSIONS: Record<string, string> = {
  // Administration
  'users.manage': 'Create, edit, deactivate users and assign roles/departments',
  'departments.manage': 'Configure departments, prefixes and workflow stages',
  'counters.manage': 'Configure service counters and rooms',
  'routing.manage': 'Configure permitted routing rules',
  'settings.manage': 'Manage system settings and display configuration',
  'audit.view': 'View audit logs',
  'reports.view': 'View operational reports',
  'reports.export': 'Export reports as CSV',
  'system.health': 'View system health and integration status',
  'dashboard.admin': 'View the hospital-wide operations dashboard',
  // Queue (department scoped)
  'queue.view': 'View the department queue',
  'queue.call': 'Call and recall tickets',
  'queue.serve': 'Start, hold, resume service and update workflow stage',
  'queue.complete': 'Complete service and route the patient onwards',
  'queue.transfer': 'Transfer a ticket to another department',
  'queue.skip': 'Skip a ticket with a reason',
  'queue.cancel': 'Cancel a ticket with a reason',
  'queue.absent': 'Mark a patient absent and restore them',
  'queue.priority': 'Raise ticket priority (urgent / emergency)',
  'queue.emergency': 'Use emergency routing pathways',
  // Clinical
  'referral.create': 'Create clinical referrals',
  'referral.notes.view': 'View clinical notes attached to referrals',
  'results.status.update': 'Update result / report availability status',
  'results.status.view': 'View result / report availability status',
  // Patients and visits
  'patient.register': 'Register new patients',
  'patient.search': 'Search patients',
  'patient.view': 'View patient demographic details',
  'patient.edit': 'Edit patient demographic details',
  'visit.create': 'Create visits and issue tickets',
  'visit.view': 'View visit details',
  'visit.cancel': 'Cancel a visit',
  'visit.close': 'Complete the administrative closure of a visit',
  'journey.view': 'View the restricted patient journey summary',
  'journey.view_full': 'View the full patient journey timeline',
  // Billing
  'billing.view': 'View invoices and balances',
  'billing.manage': 'Create invoices and record confirmed payments',
  // Notifications
  'notifications.view': 'Receive and read department notifications',
};

const ALL_QUEUE_OPS = [
  'queue.view', 'queue.call', 'queue.serve', 'queue.complete', 'queue.transfer',
  'queue.skip', 'queue.cancel', 'queue.absent', 'notifications.view', 'patient.search', 'patient.view', 'visit.view', 'journey.view',
];

export const ROLES: Record<string, { name: string; description: string; permissions: string[] }> = {
  SYSTEM_ADMIN: {
    name: 'System Administrator',
    description: 'Configures the system and monitors hospital-wide operations',
    permissions: [
      'users.manage', 'departments.manage', 'counters.manage', 'routing.manage', 'settings.manage',
      'audit.view', 'reports.view', 'reports.export', 'system.health', 'dashboard.admin',
      'queue.view', 'notifications.view', 'patient.search', 'patient.view', 'visit.view',
      'journey.view', 'journey.view_full',
    ],
  },
  RECEPTION: {
    name: 'Reception',
    description: 'Registers patients, creates visits and issues tickets',
    permissions: [
      ...ALL_QUEUE_OPS, 'patient.register', 'patient.edit', 'visit.create', 'visit.cancel',
    ],
  },
  TRIAGE: {
    name: 'Triage',
    description: 'Assesses arriving patients and sets clinical priority',
    permissions: [
      ...ALL_QUEUE_OPS, 'queue.priority', 'queue.emergency', 'referral.create', 'referral.notes.view', 'journey.view_full',
    ],
  },
  CONSULTATION: {
    name: 'Consultation',
    description: 'Clinicians who consult and create referrals',
    permissions: [
      ...ALL_QUEUE_OPS, 'queue.priority', 'queue.emergency', 'referral.create', 'referral.notes.view',
      'results.status.view', 'journey.view_full',
    ],
  },
  LABORATORY: {
    name: 'Laboratory',
    description: 'Laboratory staff',
    permissions: [
      ...ALL_QUEUE_OPS, 'referral.create', 'referral.notes.view', 'results.status.update', 'results.status.view',
    ],
  },
  RADIOLOGY: {
    name: 'Radiology',
    description: 'Imaging staff',
    permissions: [
      ...ALL_QUEUE_OPS, 'referral.create', 'referral.notes.view', 'results.status.update', 'results.status.view',
    ],
  },
  PHARMACY: {
    name: 'Pharmacy',
    description: 'Pharmacy staff',
    permissions: [...ALL_QUEUE_OPS, 'referral.notes.view'],
  },
  ACCOUNTS: {
    name: 'Accounts',
    description: 'Billing and payments',
    permissions: [...ALL_QUEUE_OPS, 'billing.view', 'billing.manage', 'visit.close'],
  },
};

export const ADMIN_ROLE = 'SYSTEM_ADMIN';

export interface DepartmentSeed {
  code: string;
  name: string;
  prefix: string;
  clinical: boolean;
  stages: string[];
  serviceTypes?: string[];
  counters: string[];
  counterKind: 'COUNTER' | 'ROOM';
}

export const DEPARTMENTS: DepartmentSeed[] = [
  {
    code: 'RECEPTION', name: 'Reception', prefix: 'R', clinical: false, counterKind: 'COUNTER',
    stages: ['REGISTERING', 'REGISTRATION_COMPLETE'], counters: ['Counter 1', 'Counter 2'],
  },
  {
    code: 'TRIAGE', name: 'Triage', prefix: 'T', clinical: true, counterKind: 'ROOM',
    stages: ['ASSESSMENT_IN_PROGRESS', 'URGENT_ASSESSMENT', 'ASSESSMENT_COMPLETE'], counters: ['Triage Room 1', 'Triage Room 2'],
  },
  {
    code: 'CONSULTATION', name: 'Consultation', prefix: 'C', clinical: true, counterKind: 'ROOM',
    stages: ['IN_CONSULTATION', 'AWAITING_RESULTS', 'REVIEW'], counters: ['Room 1', 'Room 2', 'Room 3'],
  },
  {
    code: 'LABORATORY', name: 'Laboratory', prefix: 'L', clinical: true, counterKind: 'COUNTER',
    stages: ['ARRIVED', 'SAMPLE_COLLECTED', 'PROCESSING', 'RESULTS_READY'],
    serviceTypes: ['HAEMATOLOGY', 'BIOCHEMISTRY', 'MICROBIOLOGY', 'OTHER'], counters: ['Counter 1'],
  },
  {
    code: 'RADIOLOGY', name: 'Radiology', prefix: 'RAD', clinical: true, counterKind: 'ROOM',
    stages: ['ARRIVED', 'EXAM_IN_PROGRESS', 'EXAM_COMPLETE', 'REPORT_PENDING', 'REPORT_AVAILABLE'],
    serviceTypes: ['X-RAY', 'ULTRASOUND', 'CT'], counters: ['X-Ray Room', 'Ultrasound Room', 'CT Room'],
  },
  {
    code: 'PHARMACY', name: 'Pharmacy', prefix: 'P', clinical: false, counterKind: 'COUNTER',
    stages: ['PRESCRIPTION_RECEIVED', 'DISPENSING', 'DISPENSED'], counters: ['Counter 1'],
  },
  {
    code: 'ACCOUNTS', name: 'Accounts', prefix: 'A', clinical: false, counterKind: 'COUNTER',
    stages: ['INVOICE_PREPARED', 'PAYMENT_PENDING', 'PAID', 'CLEARED'], counters: ['Counter 1'],
  },
];

/**
 * Default permitted transitions. Administrators can add, disable or tighten them.
 * [from, to, { requiresReason, emergencyOnly }]
 */
export const DEFAULT_RULES: Array<[string, string, { requiresReason?: boolean; emergencyOnly?: boolean }?]> = [
  ['RECEPTION', 'TRIAGE'],
  ['RECEPTION', 'CONSULTATION', { emergencyOnly: true, requiresReason: true }],
  ['RECEPTION', 'ACCOUNTS'],
  ['TRIAGE', 'CONSULTATION'],
  ['TRIAGE', 'ACCOUNTS'],
  ['CONSULTATION', 'LABORATORY'],
  ['CONSULTATION', 'RADIOLOGY'],
  ['CONSULTATION', 'PHARMACY'],
  ['CONSULTATION', 'ACCOUNTS'],
  ['LABORATORY', 'CONSULTATION'],
  ['LABORATORY', 'RADIOLOGY'],
  ['LABORATORY', 'PHARMACY'],
  ['LABORATORY', 'ACCOUNTS'],
  ['RADIOLOGY', 'CONSULTATION'],
  ['RADIOLOGY', 'LABORATORY'],
  ['RADIOLOGY', 'PHARMACY'],
  ['RADIOLOGY', 'ACCOUNTS'],
  ['PHARMACY', 'ACCOUNTS'],
  ['PHARMACY', 'CONSULTATION', { requiresReason: true }],
  ['ACCOUNTS', 'CONSULTATION', { requiresReason: true }],
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  'hospital.name': 'AfriQueue Hospital',
  'hospital.logoUrl': '',
  'display.instructions': 'Please keep your ticket and listen for your number. Thank you for your patience.',
  'display.showClock': true,
  'display.recentCount': 6,
  'display.language': 'en-KE',
  'display.speechRate': 0.9,
  'queue.priorityOrdering': 'priority_then_arrival', // or "arrival_only"
  'queue.absentGraceMinutes': 30,
  'ticket.footer': 'Please wait until your number is called. Keep this ticket until you leave.',
};

export const TICKET_ACTIVE: string[] = ['WAITING', 'CALLED', 'IN_SERVICE', 'ON_HOLD', 'ABSENT'];
export const PRIORITY = { ROUTINE: 0, URGENT: 1, EMERGENCY: 2 } as const;
