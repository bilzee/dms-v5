'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { RoleBasedRoute } from '@/components/shared/RoleBasedRoute'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, AlertTriangle, CheckCircle, Save } from '@/lib/icons'
import { apiGet, apiPut } from '@/lib/api'
import { fromAnswers, RapidAssessmentAnswers, RapidAssessmentType } from '@/lib/questions/legacy-convert'

// Import assessment forms
import { 
  HealthAssessmentForm,
  PopulationAssessmentForm,
  FoodAssessmentForm,
  WASHAssessmentForm,
  ShelterAssessmentForm,
  SecurityAssessmentForm
} from '@/components/forms/assessment'

const assessmentTypes = [
  { 
    value: 'HEALTH', 
    label: 'Health Assessment', 
    color: 'bg-red-100 text-red-800',
    icon: '🏥'
  },
  { 
    value: 'POPULATION', 
    label: 'Population Assessment', 
    color: 'bg-blue-100 text-blue-800',
    icon: '👥'
  },
  { 
    value: 'FOOD', 
    label: 'Food Security Assessment', 
    color: 'bg-orange-100 text-orange-800',
    icon: '🍲'
  },
  { 
    value: 'WASH', 
    label: 'WASH Assessment', 
    color: 'bg-cyan-100 text-cyan-800',
    icon: '💧'
  },
  { 
    value: 'SHELTER', 
    label: 'Shelter Assessment', 
    color: 'bg-purple-100 text-purple-800',
    icon: '🏠'
  },
  { 
    value: 'SECURITY', 
    label: 'Security Assessment', 
    color: 'bg-gray-100 text-gray-800',
    icon: '🛡️'
  }
]

function EditAssessmentContent() {
  const router = useRouter()
  const params = useParams()
  const [assessment, setAssessment] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const assessmentId = params.id as string

  useEffect(() => {
    const fetchAssessment = async () => {
      try {
        const result = await apiGet(`/api/v1/rapid-assessments/${assessmentId}`)
        
        if (result.success) {
          const assessmentData = result.data
          
          // Check if assessment is rejected
          const isRejected = assessmentData.verificationStatus === 'REJECTED'
          
          if (!isRejected) {
            setError('Only rejected assessments can be edited.')
            return
          }

          // Hydrate the legacy typed payload the forms read (e.g.
          // initialData.healthAssessment) from the canonical answers map.
          const typedPropByType: Record<string, string> = {
            HEALTH: 'healthAssessment',
            POPULATION: 'populationAssessment',
            FOOD: 'foodAssessment',
            WASH: 'washAssessment',
            SHELTER: 'shelterAssessment',
            SECURITY: 'securityAssessment',
          }
          const typedProp = typedPropByType[assessmentData.rapidAssessmentType]
          setAssessment({
            ...assessmentData,
            ...(typedProp
              ? {
                  [typedProp]: fromAnswers(
                    assessmentData.rapidAssessmentType as RapidAssessmentType,
                    (assessmentData.answers ?? {}) as RapidAssessmentAnswers
                  ),
                }
              : {}),
          })
        } else {
          setError('Failed to load assessment')
        }
      } catch (err) {
        setError('Error loading assessment')
        console.error('Error fetching assessment:', err)
      } finally {
        setIsLoading(false)
      }
    }

    if (assessmentId) {
      fetchAssessment()
    }
  }, [assessmentId])

  const handleGoBack = () => {
    router.push('/assessor/rapid-assessments')
  }

  const handleAssessmentSubmit = async (formData: any) => {
    try {
      setIsSubmitting(true)
      setError(null)
      
      // The form's handleSubmit already returns the complete assessment object
      // with type-specific data nested (e.g., { type, entityId, incidentId, foodData: {...} })
      // So we just spread it directly and add verification status for resubmit
      const result = await apiPut(`/api/v1/rapid-assessments/${assessmentId}`, {
        ...formData,
        verificationStatus: 'SUBMITTED'
      })
      
      if (result.success) {
        console.log('Assessment updated successfully:', result.data)
        router.push('/assessor/rapid-assessments')
      } else {
        setError(result.error || 'Failed to update assessment')
      }
    } catch (err) {
      setError('Error updating assessment')
      console.error('Error updating assessment:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const renderAssessmentForm = () => {
    const selectedAssessmentType = assessmentTypes.find(t => t.value === assessment.rapidAssessmentType)
    
    if (!assessment || !selectedAssessmentType) {
      return (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Invalid assessment data
          </AlertDescription>
        </Alert>
      )
    }

    const commonProps = {
      entityId: assessment.entityId,
      initialData: assessment,
      onSubmit: handleAssessmentSubmit,
      onCancel: handleGoBack,
      isSubmitting,
      disabled: isSubmitting,
      // Disable incident and entity selection for editing
      readonlyFields: ['incidentId', 'entityId']
    }

    switch (assessment.rapidAssessmentType) {
      case 'HEALTH':
        return <HealthAssessmentForm {...commonProps} />
      case 'POPULATION':
        return <PopulationAssessmentForm {...commonProps} />
      case 'FOOD':
        return <FoodAssessmentForm {...commonProps} />
      case 'WASH':
        return <WASHAssessmentForm {...commonProps} />
      case 'SHELTER':
        return <ShelterAssessmentForm {...commonProps} />
      case 'SECURITY':
        return <SecurityAssessmentForm {...commonProps} />
      default:
        return (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Unsupported assessment type
            </AlertDescription>
          </Alert>
        )
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading assessment...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleGoBack}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Assessments
          </Button>
        </div>
        
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!assessment) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleGoBack}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Assessments
          </Button>
        </div>
        
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Assessment not found</AlertDescription>
        </Alert>
      </div>
    )
  }

  const selectedAssessmentType = assessmentTypes.find(t => t.value === assessment.rapidAssessmentType)

  return (
    <RoleBasedRoute requiredRole="ASSESSOR">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleGoBack}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Assessments
          </Button>
          
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Edit Assessment
            </h1>
            <p className="text-gray-600 mt-2 hidden sm:block">
              Update the {selectedAssessmentType?.label.toLowerCase()} to resubmit for verification
            </p>
          </div>

          {selectedAssessmentType && (
            <Badge className={selectedAssessmentType.color}>
              <span className="mr-2">{selectedAssessmentType.icon}</span>
              {selectedAssessmentType.value}
            </Badge>
          )}
        </div>

        {/* Rejection Warning */}
        {assessment.verificationComment && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Previous Rejection Reason:</strong> {assessment.verificationComment}
            </AlertDescription>
          </Alert>
        )}

        {/* Assessment Form */}
        <div className="space-y-6">
          {renderAssessmentForm()}
        </div>
      </div>
    </RoleBasedRoute>
  )
}

export default function EditAssessmentPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <EditAssessmentContent />
    </Suspense>
  )
}