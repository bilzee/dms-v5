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
import type { RapidAssessmentType } from '@/lib/questions/answers'

// Registry-driven assessment form (P4) — one component for every type
import { DynamicAssessmentForm, type AssessmentFormSubmitPayload } from '@/components/forms/assessment/DynamicAssessmentForm'

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

          // The registry answers map hydrates the dynamic form directly —
          // no typed payload projection needed anymore.
          setAssessment(assessmentData)
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

  const handleAssessmentSubmit = async (payload: AssessmentFormSubmitPayload) => {
    try {
      setIsSubmitting(true)
      setError(null)
      
      // Answers-based payload + resubmit for verification (the service resets
      // the rejection stamps when verificationStatus is SUBMITTED).
      const result = await apiPut(`/api/v1/rapid-assessments/${assessmentId}`, {
        ...payload,
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

    return (
      <DynamicAssessmentForm
        assessmentType={assessment.rapidAssessmentType as RapidAssessmentType}
        entityId={assessment.entityId}
        incidentId={assessment.incidentId}
        initialAnswers={assessment.answers ?? null}
        onSubmit={handleAssessmentSubmit}
        onCancel={handleGoBack}
        isReassessment
        previousAssessmentDate={
          assessment.rapidAssessmentDate
            ? new Date(assessment.rapidAssessmentDate).toLocaleDateString()
            : undefined
        }
        // Disable incident and entity selection for editing
        lockIncidentEntity
        readonlyFields={['incidentId', 'entityId']}
      />
    )
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
