import { RapidAssessment, AssessmentType, Priority, SyncStatus, VerificationStatus } from '@prisma/client'

export { AssessmentType, Priority, SyncStatus, VerificationStatus }

// Type for assessments with their specific data included.
// Type-specific answers live in the canonical `answers` map on
// RapidAssessment (see src/lib/questions/answers.ts); the dynamic form
// (DynamicAssessmentForm.tsx) renders them straight from the registry.
export interface RapidAssessmentWithData extends RapidAssessment {
  assessor?: {
    id: string
    name: string
    email: string
  }
  entity?: {
    id: string
    name: string
    type: string
    location: string
  }
  incident?: {
    id: string
    type: string
    subType?: string
    createdAt: Date
    severity: string
  }
}

// API Response Types
export interface RapidAssessmentResponse {
  success?: true
  data: RapidAssessmentWithData
  meta: {
    timestamp: string
    version: string
    requestId: string
  }
}

export interface RapidAssessmentListResponse {
  success?: true
  data: RapidAssessmentWithData[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  meta: {
    timestamp: string
    version: string
    requestId: string
  }
}

// GPS Coordinate Type
export interface GPSCoordinates {
  latitude: number
  longitude: number
  accuracy?: number
  timestamp: Date
  captureMethod: 'GPS' | 'MANUAL'
}

// Assessment Summary for Dashboard
export interface AssessmentSummary {
  id: string
  type: AssessmentType
  verificationStatus: VerificationStatus
  priority: Priority
  entityName: string
  assessmentDate: Date
  hasGaps: boolean
  syncStatus: SyncStatus
  createdAt: Date
}

// Gap Analysis Results
export interface GapAnalysisResult {
  assessmentType: AssessmentType
  totalGaps: number
  gapFields: string[]
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  recommendations: string[]
}

// Entity Assignment for Assessment
export interface AssessableEntity {
  id: string
  name: string
  type: string
  location: string
  assignmentStatus: 'ACTIVE' | 'INACTIVE'
  assignedAt: Date
}

// Assessment Statistics
export interface AssessmentStats {
  total: number
  byType: Record<AssessmentType, number>
  byVerificationStatus: Record<VerificationStatus, number>
  byPriority: Record<Priority, number>
  recentActivity: number
  pendingVerification: number
}