export interface AuthUser {
  id: number; username: string; fullName: string; email: string | null; isAdmin: boolean; roles: string[];
  permissions: string[]; departmentIds: number[]; mustChangePassword: boolean;
}
export interface Department {
  id: number; code: string; name: string; ticketPrefix: string; sortOrder: number; isActive: boolean; isClinical: boolean;
  sequencePolicy: 'DAILY' | 'CONTINUOUS'; workflowStages: string[]; serviceTypes: string[];
}
export interface Counter { id: number; departmentId: number; name: string; kind: 'COUNTER' | 'ROOM'; isActive: boolean }
export type TicketStatus = 'WAITING' | 'CALLED' | 'IN_SERVICE' | 'ON_HOLD' | 'ABSENT' | 'COMPLETED' | 'REFERRED' | 'SKIPPED' | 'CANCELLED';
export interface PatientCard { id: number; mrn: string; fullName: string; age: number | null; sex: string }
export interface Ticket {
  id: number; displayNumber: string; status: TicketStatus; priority: number; priorityReason: string | null; serviceType: string | null;
  workflowStage: string | null; resultStatus: 'NOT_APPLICABLE' | 'PENDING' | 'AVAILABLE'; callCount: number; statusReason: string | null;
  department: { id: number; name: string; code: string }; counter: { id: number; name: string } | null; visitId: number; visitNumber: string;
  isEmergency: boolean; enteredAt: string; firstCalledAt: string | null; lastCalledAt: string | null; serviceStartedAt: string | null;
  completedAt: string | null; patient: PatientCard | null; position?: number; waitingSeconds?: number | null; serviceSeconds?: number | null;
  referral?: { fromDepartment: string; serviceType: string | null; notes?: string | null } | null;
}
export interface DepartmentQueue {
  department: { id: number; name: string; code: string; workflowStages: string[]; serviceTypes: string[] };
  counts: { waiting: number; inService: number; called: number; absent: number; incomingReferrals: number };
  nextEligible: Ticket | null; waiting: Ticket[]; active: Ticket[]; absent: Ticket[]; recentlyCompleted: Ticket[];
  averageWaitSeconds: number | null; generatedAt: string;
}
export interface Patient {
  id: number; mrn: string; fullName: string; dateOfBirth: string | null; age: number | null; sex: string; phone: string | null;
  nationalId?: string | null; address?: string | null; createdAt?: string;
}
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export interface Notification { id: number; type: string; title: string; body: string | null; ticketId: number | null; visitId: number | null; createdAt: string; department: { id: number; name: string }; read: boolean }
export interface RoutingRule { id: number; fromDepartmentId: number; toDepartmentId: number; isActive: boolean; requiresReason: boolean; emergencyOnly: boolean; from: { id: number; name: string; code: string }; to: { id: number; name: string; code: string } }
export interface StaffUser {
  id: number; username: string; fullName: string; email: string | null; isActive: boolean; mustChangePassword: boolean; lockedUntil: string | null;
  lastLoginAt: string | null; roles: Array<{ code: string; name: string }>; departments: Array<{ id: number; code: string; name: string }>;
}
export interface Role { code: string; name: string; description: string | null; permissions: string[] }
export interface DisplaySnapshot {
  generatedAt: string; lastEventId: number;
  settings: { hospitalName: string; logoUrl: string; instructions: string; showClock: boolean; recentCount: number; language: string; speechRate: number };
  nowServing: Array<{ ticketId: number; displayNumber: string; department: string; departmentId: number; counter: string | null; calledAt: string; callKey: string }>;
  departments: Array<{ id: number; code: string; name: string; waiting: number; nextUp: string[]; serving: Array<{ displayNumber: string; counter: string | null }> }>;
}
