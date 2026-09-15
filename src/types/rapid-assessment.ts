import { RapidAssessment, AssessmentType, Priority, SyncStatus, VerificationStatus } from '@prisma/client'

export { AssessmentType, Priority, SyncStatus, VerificationStatus }

// Type for assessments with their specific data included.
// Type-specific answers now live in the canonical `answers` map on
// RapidAssessment and are hydrated via `fromAnswers`
// (see src/lib/questions/legacy-convert.ts).
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

// Health Assessment
export interface HealthAssessment {
  rapidAssessmentId: string
  hasFunctionalClinic: boolean
  hasEmergencyServices: boolean
  numberHealthFacilities: number
  healthFacilityType: string
  qualifiedHealthWorkers: number
  hasTrainedStaff: boolean
  hasMedicineSupply: boolean
  hasMedicalSupplies: boolean
  hasMaternalChildServices: boolean
  commonHealthIssues: string[]
  additionalHealthDetails?: any
}

// Population Assessment
export interface PopulationAssessment {
  rapidAssessmentId: string
  totalHouseholds: number
  totalPopulation: number
  populationMale: number
  populationFemale: number
  populationUnder5: number
  pregnantWomen: number
  lactatingMothers: number
  personWithDisability: number
  elderlyPersons: number
  separatedChildren: number
  numberLivesLost: number
  numberInjured: number
  additionalPopulationDetails?: string
}

// Food Assessment
export interface FoodAssessment {
  rapidAssessmentId: string
  isFoodSufficient: boolean
  hasRegularMealAccess: boolean
  hasInfantNutrition: boolean
  foodSource: string[]
  availableFoodDurationDays: number
  additionalFoodRequiredPersons: number
  additionalFoodRequiredHouseholds: number
  additionalFoodDetails?: any
}

// WASH Assessment
export interface WASHAssessment {
  rapidAssessmentId: string
  waterSource: string[]
  isWaterSufficient: boolean
  hasCleanWaterAccess: boolean
  functionalLatrinesAvailable: number
  areLatrinesSufficient: boolean
  hasHandwashingFacilities: boolean
  hasOpenDefecationConcerns: boolean
  additionalWashDetails?: any
}

// Shelter Assessment
export interface ShelterAssessment {
  rapidAssessmentId: string
  areSheltersSufficient: boolean
  hasSafeStructures: boolean
  shelterTypes: string[]
  requiredShelterType: string[]
  numberSheltersRequired: number
  areOvercrowded: boolean
  provideWeatherProtection: boolean
  additionalShelterDetails?: any
}

// Security Assessment
export interface SecurityAssessment {
  rapidAssessmentId: string
  isSafeFromViolence: boolean
  gbvCasesReported: boolean
  hasSecurityPresence: boolean
  hasProtectionReportingMechanism: boolean
  vulnerableGroupsHaveAccess: boolean
  hasLighting: boolean
  additionalSecurityDetails?: any
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

// Form Props Types
export interface BaseAssessmentFormProps {
  entityId: string
  incidentId?: string
  initialData?: any
  onSubmit: (data: any) => Promise<void>
  onCancel: () => void
  isSubmitting?: boolean
  disabled?: boolean
  lockIncidentEntity?: boolean
  onIncidentEntityChange?: (incidentId: string, entityId: string) => void
  isReassessment?: boolean
  previousAssessmentDate?: string
}

export interface HealthAssessmentFormProps extends BaseAssessmentFormProps {
  initialData?: HealthAssessment
}

export interface PopulationAssessmentFormProps extends BaseAssessmentFormProps {
  initialData?: PopulationAssessment
}

export interface FoodAssessmentFormProps extends BaseAssessmentFormProps {
  initialData?: FoodAssessment
}

export interface WASHAssessmentFormProps extends BaseAssessmentFormProps {
  initialData?: WASHAssessment
}

export interface ShelterAssessmentFormProps extends BaseAssessmentFormProps {
  initialData?: ShelterAssessment
}

export interface SecurityAssessmentFormProps extends BaseAssessmentFormProps {
  initialData?: SecurityAssessment
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