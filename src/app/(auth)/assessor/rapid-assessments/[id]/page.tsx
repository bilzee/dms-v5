'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, CheckCircle, AlertTriangle, Clock, FileText, MapPin } from '@/lib/icons'
import { apiGet } from '@/lib/api'
import {
  fromAnswers,
  questionKeysForType,
  RapidAssessmentAnswers,
  RapidAssessmentType,
} from '@/lib/questions/answers'

/** One snapshot-only (drifted) answered question for the read-only block. */
interface SnapshotDriftItem {
  key: string
  label: string
  value: unknown
}

/** Human-readable rendering of a drifted answer. */
function formatDriftValue(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.map((entry) => String(entry)).join(', ') : '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

/**
 * Snapshot-vs-catalog drift (P10-1): answered questions defined in the row's
 * frozen `questionSnapshot` but absent from the catalog key set this page's
 * typed cards render. Shown in a generic read-only block so registry churn
 * never makes historical answers vanish. Defensive — never throws.
 */
function collectSnapshotDrift(
  snapshot: unknown,
  answers: Record<string, unknown> | null | undefined,
  assessmentType: string
): SnapshotDriftItem[] {
  if (!snapshot || typeof snapshot !== 'object' || !answers) return []
  const sections = (snapshot as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return []
  let catalogKeys: Set<string>
  try {
    catalogKeys = new Set(questionKeysForType(assessmentType as RapidAssessmentType))
  } catch {
    return [] // unknown type — no typed cards, no drift to reconcile
  }
  const items: SnapshotDriftItem[] = []
  for (const section of sections) {
    const questions = (section as { questions?: unknown })?.questions
    if (!Array.isArray(questions)) continue
    for (const question of questions) {
      const key = (question as { key?: unknown })?.key
      if (typeof key !== 'string' || catalogKeys.has(key)) continue
      const value = answers[key]
      if (value === undefined || value === null || value === '') continue
      const label = (question as { label?: unknown })?.label
      items.push({
        key,
        label: typeof label === 'string' && label.length > 0 ? label : key,
        value,
      })
    }
  }
  return items
}

interface Assessment {
  id: string
  rapidAssessmentType: string
  rapidAssessmentDate: string
  assessorId: string
  entityId: string
  assessorName: string
  location: string
  coordinates?: { latitude: number; longitude: number; accuracy: number; timestamp: string; captureMethod: string }
  status: string
  priority: string
  versionNumber: number
  isOfflineCreated: boolean
  syncStatus: string
  verificationStatus: string
  verifiedAt?: string
  verifiedBy?: string
  rejectionReason?: string
  rejectionFeedback?: string
  mediaAttachments?: any[]
  createdAt: string
  updatedAt: string
  gapAnalysis: {
    hasGap: boolean
    severity: string
    gapFields: string[]
    recommendations: string[]
  } | null
  incidentId: string
  answers?: Record<string, unknown> | null
  /** The row's frozen question snapshot (P10-1 read-side drift). */
  questionSnapshot?: unknown
  healthAssessment?: {
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
    additionalHealthDetails: string
  }
  washAssessment?: {
    rapidAssessmentId: string
    waterSource: string[]
    isWaterSufficient: boolean
    hasCleanWaterAccess: boolean
    functionalLatrinesAvailable: number
    areLatrinesSufficient: boolean
    hasHandwashingFacilities: boolean
    hasOpenDefecationConcerns: boolean
    additionalWashDetails: string
  }
  foodAssessment?: {
    rapidAssessmentId: string
    isFoodSufficient: boolean
    hasRegularMealAccess: boolean
    hasInfantNutrition: boolean
    foodSource: string[]
    availableFoodDurationDays: number
    additionalFoodRequiredPersons: number
    additionalFoodRequiredHouseholds: number
    additionalFoodDetails: string
  }
  shelterAssessment?: {
    rapidAssessmentId: string
    areSheltersSufficient: boolean
    hasSafeStructures: boolean
    shelterTypes: string[]
    requiredShelterType: string[]
    numberSheltersRequired: number
    areOvercrowded: boolean
    provideWeatherProtection: boolean
    additionalShelterDetails: string
  }
  securityAssessment?: {
    rapidAssessmentId: string
    isSafeFromViolence: boolean
    gbvCasesReported: boolean
    hasSecurityPresence: boolean
    hasProtectionReportingMechanism: boolean
    vulnerableGroupsHaveAccess: boolean
    hasLighting: boolean
    additionalSecurityDetails: string
  }
  assessor: {
    id: string
    name: string
    email: string
  }
  entity: {
    id: string
    name: string
    type: string
    location: string
  }
}

export default function AssessmentDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [snapshotDrift, setSnapshotDrift] = useState<SnapshotDriftItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchAssessment = async () => {
      try {
        const result = await apiGet(`/api/v1/rapid-assessments/${params.id}`)
        if (!result.success) {
          throw new Error(result.error || 'Assessment not found')
        }
        // Hydrate the legacy typed payload view from the canonical answers map
        const data = result.data as Assessment
        const typedPropByType: Record<string, 'healthAssessment' | 'washAssessment' | 'foodAssessment' | 'shelterAssessment' | 'securityAssessment'> = {
          HEALTH: 'healthAssessment',
          WASH: 'washAssessment',
          FOOD: 'foodAssessment',
          SHELTER: 'shelterAssessment',
          SECURITY: 'securityAssessment',
        }
        const typedProp = typedPropByType[data.rapidAssessmentType]
        setAssessment(
          typedProp
            ? {
                ...data,
                [typedProp]: fromAnswers(
                  data.rapidAssessmentType as RapidAssessmentType,
                  (data.answers ?? {}) as RapidAssessmentAnswers
                ),
              }
            : data
        )
        // P10-1 — answered snapshot questions the typed cards cannot render.
        setSnapshotDrift(
          collectSnapshotDrift(data.questionSnapshot, data.answers ?? null, data.rapidAssessmentType)
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load assessment')
      } finally {
        setLoading(false)
      }
    }

    if (params.id) {
      fetchAssessment()
    }
  }, [params.id])

  const getStatusBadge = (assessment: Assessment) => {
    switch (assessment.verificationStatus) {
      case 'VERIFIED':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Verified</Badge>
      case 'AUTO_VERIFIED':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Auto-Verified</Badge>
      case 'REJECTED':
        return <Badge className="bg-red-100 text-red-800"><AlertTriangle className="w-3 h-3 mr-1" />Rejected</Badge>
      case 'SUBMITTED':
        return <Badge className="bg-yellow-100 text-yellow-800"><FileText className="w-3 h-3 mr-1" />Pending Review</Badge>
      case 'DRAFT':
        return <Badge className="bg-gray-100 text-gray-800"><Clock className="w-3 h-3 mr-1" />Draft</Badge>
      default:
        return <Badge variant="outline">{assessment.verificationStatus}</Badge>
    }
  }

  const getPriorityBadge = (priority: string) => {
    switch (priority.toLowerCase()) {
      case 'high':
        return <Badge variant="destructive">High Priority</Badge>
      case 'medium':
        return <Badge variant="secondary">Medium Priority</Badge>
      case 'low':
        return <Badge variant="outline">Low Priority</Badge>
      default:
        return <Badge variant="outline">{priority}</Badge>
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-lg">Loading assessment details...</div>
        </div>
      </div>
    )
  }

  if (error || !assessment) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="p-6">
            <div className="text-center">
              <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Assessment Not Found</h3>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={() => router.back()}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Go Back
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          onClick={() => router.back()}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Assessments
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Assessment Details</h1>
          <p className="text-muted-foreground hidden sm:block">
            {assessment.rapidAssessmentType} Assessment for {assessment.entity.name}
          </p>
        </div>
      </div>

      {/* Assessment Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Assessment Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Entity</label>
              <p className="font-semibold">{assessment.entity.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Assessment Type</label>
              <p className="font-semibold">{assessment.rapidAssessmentType}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Created</label>
              <p className="font-semibold">
                {new Date(assessment.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {getStatusBadge(assessment)}
            {getPriorityBadge(assessment.priority)}
            {assessment.gapAnalysis?.hasGap && (
              <Badge variant="outline">
                {assessment.gapAnalysis.gapFields.length} Gap{assessment.gapAnalysis.gapFields.length !== 1 ? 's' : ''} Identified
              </Badge>
            )}
            {assessment.gapAnalysis?.severity && (
              <Badge variant={assessment.gapAnalysis.severity === 'CRITICAL' ? 'destructive' : assessment.gapAnalysis.severity === 'HIGH' ? 'secondary' : 'outline'}>
                {assessment.gapAnalysis.severity} Severity
              </Badge>
            )}
          </div>

          {(assessment.location || assessment.entity.location) && (
            <div className="flex items-start gap-2 pt-2">
              <MapPin className="h-4 w-4 text-muted-foreground mt-1" />
              <div>
                <label className="text-sm font-medium text-muted-foreground">Location</label>
                <p className="text-sm">{assessment.location || assessment.entity.location}</p>
                {assessment.coordinates && (
                  <p className="text-xs text-muted-foreground">
                    {assessment.coordinates.latitude.toFixed(6)}, {assessment.coordinates.longitude.toFixed(6)} (±{assessment.coordinates.accuracy}m)
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assessment Details */}
      {assessment.healthAssessment && (
        <Card>
          <CardHeader>
            <CardTitle>Health Assessment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Functional Clinic</label>
                <p className={`font-semibold ${assessment.healthAssessment.hasFunctionalClinic ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.healthAssessment.hasFunctionalClinic ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Emergency Services</label>
                <p className={`font-semibold ${assessment.healthAssessment.hasEmergencyServices ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.healthAssessment.hasEmergencyServices ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Health Facilities</label>
                <p className="font-semibold">{assessment.healthAssessment.numberHealthFacilities} ({assessment.healthAssessment.healthFacilityType})</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Qualified Workers</label>
                <p className="font-semibold">{assessment.healthAssessment.qualifiedHealthWorkers}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Trained Staff</label>
                <p className={`font-semibold ${assessment.healthAssessment.hasTrainedStaff ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.healthAssessment.hasTrainedStaff ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Medicine Supply</label>
                <p className={`font-semibold ${assessment.healthAssessment.hasMedicineSupply ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.healthAssessment.hasMedicineSupply ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Medical Supplies</label>
                <p className={`font-semibold ${assessment.healthAssessment.hasMedicalSupplies ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.healthAssessment.hasMedicalSupplies ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Maternal & Child Services</label>
                <p className={`font-semibold ${assessment.healthAssessment.hasMaternalChildServices ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.healthAssessment.hasMaternalChildServices ? 'Yes' : 'No'}
                </p>
              </div>
            </div>
            {assessment.healthAssessment.commonHealthIssues && assessment.healthAssessment.commonHealthIssues.length > 0 && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Common Health Issues</label>
                <p className="text-sm">{assessment.healthAssessment.commonHealthIssues.join(', ')}</p>
              </div>
            )}
            {assessment.healthAssessment.additionalHealthDetails && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Additional Details</label>
                <p className="text-sm">{assessment.healthAssessment.additionalHealthDetails}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {assessment.washAssessment && (
        <Card>
          <CardHeader>
            <CardTitle>WASH Assessment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Water Sources</label>
                <p className="font-semibold">{assessment.washAssessment.waterSource.join(', ')}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Water Sufficient</label>
                <p className={`font-semibold ${assessment.washAssessment.isWaterSufficient ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.washAssessment.isWaterSufficient ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Clean Water Access</label>
                <p className={`font-semibold ${assessment.washAssessment.hasCleanWaterAccess ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.washAssessment.hasCleanWaterAccess ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Functional Latrines</label>
                <p className="font-semibold">{assessment.washAssessment.functionalLatrinesAvailable}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Latrines Sufficient</label>
                <p className={`font-semibold ${assessment.washAssessment.areLatrinesSufficient ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.washAssessment.areLatrinesSufficient ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Handwashing Facilities</label>
                <p className={`font-semibold ${assessment.washAssessment.hasHandwashingFacilities ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.washAssessment.hasHandwashingFacilities ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Open Defecation Concerns</label>
                <p className={`font-semibold ${assessment.washAssessment.hasOpenDefecationConcerns ? 'text-red-600' : 'text-green-600'}`}>
                  {assessment.washAssessment.hasOpenDefecationConcerns ? 'Yes' : 'No'}
                </p>
              </div>
            </div>
            {assessment.washAssessment.additionalWashDetails && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Additional Details</label>
                <p className="text-sm">{assessment.washAssessment.additionalWashDetails}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {assessment.foodAssessment && (
        <Card>
          <CardHeader>
            <CardTitle>Food Assessment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Food Sufficient</label>
                <p className={`font-semibold ${assessment.foodAssessment.isFoodSufficient ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.foodAssessment.isFoodSufficient ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Regular Meal Access</label>
                <p className={`font-semibold ${assessment.foodAssessment.hasRegularMealAccess ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.foodAssessment.hasRegularMealAccess ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Infant Nutrition</label>
                <p className={`font-semibold ${assessment.foodAssessment.hasInfantNutrition ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.foodAssessment.hasInfantNutrition ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Food Sources</label>
                <p className="font-semibold">{assessment.foodAssessment.foodSource.join(', ')}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Food Duration (Days)</label>
                <p className="font-semibold">{assessment.foodAssessment.availableFoodDurationDays}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Additional Food Needed</label>
                <p className="font-semibold">{assessment.foodAssessment.additionalFoodRequiredPersons} persons ({assessment.foodAssessment.additionalFoodRequiredHouseholds} households)</p>
              </div>
            </div>
            {assessment.foodAssessment.additionalFoodDetails && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Additional Details</label>
                <p className="text-sm">{assessment.foodAssessment.additionalFoodDetails}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {assessment.shelterAssessment && (
        <Card>
          <CardHeader>
            <CardTitle>Shelter Assessment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Shelters Sufficient</label>
                <p className={`font-semibold ${assessment.shelterAssessment.areSheltersSufficient ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.shelterAssessment.areSheltersSufficient ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Safe Structures</label>
                <p className={`font-semibold ${assessment.shelterAssessment.hasSafeStructures ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.shelterAssessment.hasSafeStructures ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Current Shelter Types</label>
                <p className="font-semibold">{assessment.shelterAssessment.shelterTypes.join(', ')}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Required Shelter Types</label>
                <p className="font-semibold">{assessment.shelterAssessment.requiredShelterType.join(', ')}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Shelters Required</label>
                <p className="font-semibold">{assessment.shelterAssessment.numberSheltersRequired}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Overcrowded</label>
                <p className={`font-semibold ${assessment.shelterAssessment.areOvercrowded ? 'text-red-600' : 'text-green-600'}`}>
                  {assessment.shelterAssessment.areOvercrowded ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Weather Protection</label>
                <p className={`font-semibold ${assessment.shelterAssessment.provideWeatherProtection ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.shelterAssessment.provideWeatherProtection ? 'Yes' : 'No'}
                </p>
              </div>
            </div>
            {assessment.shelterAssessment.additionalShelterDetails && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Additional Details</label>
                <p className="text-sm">{assessment.shelterAssessment.additionalShelterDetails}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {assessment.securityAssessment && (
        <Card>
          <CardHeader>
            <CardTitle>Security Assessment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Safe from Violence</label>
                <p className={`font-semibold ${assessment.securityAssessment.isSafeFromViolence ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.securityAssessment.isSafeFromViolence ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">GBV Cases Reported</label>
                <p className={`font-semibold ${assessment.securityAssessment.gbvCasesReported ? 'text-red-600' : 'text-green-600'}`}>
                  {assessment.securityAssessment.gbvCasesReported ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Security Presence</label>
                <p className={`font-semibold ${assessment.securityAssessment.hasSecurityPresence ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.securityAssessment.hasSecurityPresence ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Protection Reporting</label>
                <p className={`font-semibold ${assessment.securityAssessment.hasProtectionReportingMechanism ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.securityAssessment.hasProtectionReportingMechanism ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Vulnerable Groups Access</label>
                <p className={`font-semibold ${assessment.securityAssessment.vulnerableGroupsHaveAccess ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.securityAssessment.vulnerableGroupsHaveAccess ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Lighting Available</label>
                <p className={`font-semibold ${assessment.securityAssessment.hasLighting ? 'text-green-600' : 'text-red-600'}`}>
                  {assessment.securityAssessment.hasLighting ? 'Yes' : 'No'}
                </p>
              </div>
            </div>
            {assessment.securityAssessment.additionalSecurityDetails && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Additional Details</label>
                <p className="text-sm">{assessment.securityAssessment.additionalSecurityDetails}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* P10-1 — read-only drift: answered snapshot questions outside the
          catalog key set the typed cards above render */}
      {snapshotDrift.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Additional Registry Answers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {snapshotDrift.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between py-1"
                  data-testid={`snapshot-drift-${item.key}`}
                >
                  <span className="text-sm text-muted-foreground flex-1">{item.label}</span>
                  <span className="text-sm font-semibold text-foreground bg-muted px-2 py-1 rounded text-right min-w-0 flex-shrink-0">
                    {formatDriftValue(item.value)}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              These questions were part of the registry when this assessment was submitted. They are
              shown read-only from the assessment&apos;s frozen question snapshot.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Gap Analysis & Recommendations */}
      {assessment.gapAnalysis?.hasGap && (
        <Card>
          <CardHeader>
            <CardTitle>Gap Analysis & Recommendations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border rounded-lg p-4 bg-red-50 dark:bg-red-900/10">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <h4 className="font-semibold text-red-800 dark:text-red-200">Identified Gaps</h4>
                <Badge variant="destructive">{assessment.gapAnalysis.severity} Severity</Badge>
              </div>
              <div className="space-y-2">
                {assessment.gapAnalysis.gapFields.map((field: string, index: number) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-red-600 rounded-full"></div>
                    <span className="text-sm capitalize">{field.replace(/([A-Z])/g, ' $1').trim()}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="border rounded-lg p-4 bg-blue-50 dark:bg-blue-900/10">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="h-5 w-5 text-blue-600" />
                <h4 className="font-semibold text-blue-800 dark:text-blue-200">Recommendations</h4>
              </div>
              <div className="space-y-2">
                {assessment.gapAnalysis.recommendations.map((recommendation: string, index: number) => (
                  <div key={index} className="flex items-start gap-2">
                    <div className="w-2 h-2 bg-blue-600 rounded-full mt-2"></div>
                    <span className="text-sm">{recommendation}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assessor Information */}
      <Card>
        <CardHeader>
          <CardTitle>Assessment Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Assessor</label>
              <p className="font-semibold">{assessment.assessor.name}</p>
              <p className="text-sm text-muted-foreground">{assessment.assessor.email}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Assessment Date</label>
              <p className="font-semibold">{new Date(assessment.rapidAssessmentDate).toLocaleDateString()}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Version</label>
              <p className="font-semibold">v{assessment.versionNumber}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Sync Status</label>
              <Badge variant={assessment.syncStatus === 'SYNCED' ? 'default' : 'secondary'}>
                {assessment.syncStatus}
              </Badge>
            </div>
          </div>
          {assessment.verifiedAt && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">Verified At</label>
              <p className="font-semibold">{new Date(assessment.verifiedAt).toLocaleString()}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}