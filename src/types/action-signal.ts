export type SignalReason =
  | 'reassessment-needed'
  | 'overdue'
  | 'awaiting-plan'
  | 'awaiting-plan-for-commitment'
  | 'awaiting-delivery'
  | 'partially-covered'
  | 'assessment-needs-response'
  | 'plan-needs-commitment'
  | 'partially-fulfilled'
  | 'assessment-awaiting-verification'
  | 'delivery-awaiting-verification'
  | 'verification-overdue'
  | 'entity-needs-responder'
  | 'entity-needs-donor';

export type SignalPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type SignalTargetRole = 'ASSESSOR' | 'RESPONDER' | 'DONOR' | 'COORDINATOR';

export interface ActionSignalItem {
  id: string;
  userId: string;
  entityId: string;
  incidentId: string | null;
  type: string;
  signalReason: SignalReason;
  priority: SignalPriority;
  context: SignalContext;
  createdAt: Date;
  resolvedAt: Date | null;
  entity: {
    id: string;
    name: string;
    type: string;
    location: string | null;
    coordinates: unknown;
  };
  incident?: {
    id: string;
    name: string;
    severity: string;
  } | null;
}

export interface SignalContext {
  entityName?: string;
  assessmentType?: string;
  assessmentId?: string;
  responseId?: string;
  responseType?: string;
  commitmentId?: string;
  donorName?: string;
  coveragePercent?: number;
  itemBreakdown?: ItemCoverage[];
  deadline?: string;
  lastAssessmentDate?: string;
}

export interface ItemCoverage {
  itemName: string;
  plannedQuantity: number;
  committedQuantity: number;
  coveragePercent: number;
}

export interface SignalGroup {
  entityId: string;
  entityName: string;
  entityType: string;
  entityLocation: string | null;
  entityCoordinates: unknown;
  type: string;
  signals: ActionSignalItem[];
  count: number;
  highestPriority: SignalPriority;
}

export interface SignalListResponse {
  success: boolean;
  data: {
    signals: ActionSignalItem[];
    groups: SignalGroup[];
    totalCount: number;
    unresolvedCount: number;
    criticalCount: number;
  };
  meta: {
    timestamp: string;
    version: string;
    requestId: string;
  };
}

export interface SignalTriggerPayload {
  trigger:
    | 'assessment-created'
    | 'assessment-submitted'
    | 'assessment-verified'
    | 'assessment-rejected'
    | 'response-created'
    | 'response-verified'
    | 'response-rejected'
    | 'response-delivered'
    | 'commitment-created'
    | 'commitment-updated'
    | 'coordinator-scan';
  entityId: string;
  incidentId?: string | null;
  assessmentId?: string;
  assessmentType?: string;
  assessmentPriority?: string;
  responseId?: string;
  responseType?: string;
  responsePriority?: string;
  commitmentId?: string;
  donorId?: string;
  deliveryStatus?: string;
}

export const SIGNAL_REASON_ROLES: Record<SignalReason, SignalTargetRole[]> = {
  'reassessment-needed': ['ASSESSOR', 'COORDINATOR'],
  'overdue': ['ASSESSOR', 'COORDINATOR'],
  'awaiting-plan': ['RESPONDER', 'COORDINATOR'],
  'awaiting-plan-for-commitment': ['RESPONDER', 'COORDINATOR'],
  'awaiting-delivery': ['RESPONDER', 'COORDINATOR'],
  'partially-covered': ['DONOR', 'COORDINATOR'],
  'assessment-needs-response': ['DONOR', 'COORDINATOR'],
  'plan-needs-commitment': ['DONOR', 'COORDINATOR'],
  'partially-fulfilled': ['DONOR', 'RESPONDER', 'COORDINATOR'],
  'assessment-awaiting-verification': ['COORDINATOR'],
  'delivery-awaiting-verification': ['COORDINATOR'],
  'verification-overdue': ['COORDINATOR'],
  'entity-needs-responder': ['COORDINATOR'],
  'entity-needs-donor': ['COORDINATOR'],
};

export const NOTIFICATION_TEMPLATES: Record<SignalReason, { title: string; body: string }> = {
  'reassessment-needed': {
    title: 'Reassessment needed',
    body: '{entityName} — situation changed after verified {responseType} response.',
  },
  'overdue': {
    title: 'Population assessment overdue',
    body: '{entityName} — population assessment deadline has passed.',
  },
  'awaiting-plan': {
    title: 'Response plan needed',
    body: '{entityName} — verified {assessmentType} assessment awaits a response plan.',
  },
  'awaiting-plan-for-commitment': {
    title: 'Commitment needs a plan',
    body: '{donorName} committed resources for {entityName} — no response plan linked.',
  },
  'awaiting-delivery': {
    title: 'Delivery confirmation needed',
    body: '{entityName} — response plan for {responseType} awaits delivery confirmation.',
  },
  'partially-covered': {
    title: 'Plan partially covered',
    body: '{entityName} — response plan has partial commitment coverage ({coveragePercent}%).',
  },
  'assessment-needs-response': {
    title: 'Assessment needs response',
    body: '{entityName} — verified {assessmentType} assessment needs resources.',
  },
  'plan-needs-commitment': {
    title: 'Plan needs commitment',
    body: '{entityName} — response plan for {responseType} needs donor commitments.',
  },
  'partially-fulfilled': {
    title: 'Commitment partially fulfilled',
    body: '{entityName} — your commitment is partially delivered.',
  },
  'entity-needs-responder': {
    title: 'Entity needs responder',
    body: '{entityName} — no responder has been assigned.',
  },
  'entity-needs-donor': {
    title: 'Entity needs donor',
    body: '{entityName} — no donor has been assigned.',
  },
  'assessment-awaiting-verification': {
    title: 'Assessment awaiting review',
    body: '{entityName} — {assessmentType} assessment submitted for verification.',
  },
  'delivery-awaiting-verification': {
    title: 'Delivery awaiting review',
    body: '{entityName} — {responseType} response delivery submitted for verification.',
  },
  'verification-overdue': {
    title: 'Verification overdue',
    body: '{entityName} — submission has been awaiting verification for over 48 hours.',
  },
};
