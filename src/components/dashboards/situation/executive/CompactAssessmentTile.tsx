'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { apiGet } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getBadgeClasses } from '@/components/shared/StatusBadge';
import {
  FileText,
  Shield,
  Truck,
  Droplets,
  Wheat,
  Heart,
  Home,
  Users,
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  AlertCircle
} from '@/lib/icons';

// Types
interface CompactAssessmentTileProps {
  incidentId: string;
  className?: string;
}

interface AssessmentSummary {
  type: string;
  total: number;
  verified: number;
  pending: number;
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

interface AssessmentsData {
  assessments: AssessmentSummary[];
}

// Assessment type configuration
const assessmentTypeConfig: Record<string, { 
  icon: React.ComponentType<{ className?: string }>, 
  color: string, 
  label: string 
}> = {
  'HEALTH': { icon: Heart, color: 'text-red-600', label: 'Health' },
  'FOOD': { icon: Wheat, color: 'text-orange-600', label: 'Food Security' },
  'WASH': { icon: Droplets, color: 'text-blue-600', label: 'WASH' },
  'SHELTER': { icon: Home, color: 'text-green-600', label: 'Shelter' },
  'SECURITY': { icon: Shield, color: 'text-purple-600', label: 'Security' },
  'POPULATION': { icon: Users, color: 'text-muted-foreground', label: 'Population' },
  'LOGISTICS': { icon: Truck, color: 'text-yellow-600', label: 'Logistics' }
};

const shouldFlashMap: Record<string, boolean> = {
  CRITICAL: true,
  HIGH: true,
  MEDIUM: false,
  LOW: false
};

/**
 * Calculate completion percentage
 */
const getCompletionPercentage = (verified: number, total: number): number => {
  if (total === 0) return 0;
  return Math.round((verified / total) * 100);
};

// Fetch assessments data
const fetchAssessmentsData = async (incidentId: string): Promise<AssessmentsData> => {
  // Get dashboard data with entity assessments
  const dashboardParams = new URLSearchParams({ 
    incidentId,
    entityId: 'all'  // Required to get aggregatedAssessments data
  });
  const dashboardResponse = await apiGet(`/api/v1/dashboard/situation?${dashboardParams}`);
  if (!dashboardResponse.success) {
    throw new Error(dashboardResponse.error || 'Failed to fetch dashboard data');
  }

  const assessmentTypes = ['HEALTH', 'FOOD', 'WASH', 'SHELTER', 'SECURITY'];
  const assessmentSummaries: AssessmentSummary[] = [];
  
  // Use aggregatedAssessments for severity information
  const aggregatedAssessments = dashboardResponse.data.aggregatedAssessments || {};
  
  // Use entityAssessments to count verified/pending from latest assessments per entity
  const entityAssessments = dashboardResponse.data.entityAssessments || [];
  
  // Use aggregateMetrics for overall counts
  const aggregateMetrics = dashboardResponse.data.aggregateMetrics || {};
  
  assessmentTypes.forEach(type => {
    const typeKey = type.toLowerCase();
    const aggregatedData = aggregatedAssessments[typeKey];
    
    let total = 0;
    let verified = 0; 
    let pending = 0;
    let maxSeverity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    
    // The correct verified count is what appears in aggregated data totalEntities
    // This represents verified assessments that have been completed and processed
    if (aggregatedData && aggregatedData.totalEntities > 0) {
      // The totalEntities IS the verified assessment count (this matches standard view)
      verified = aggregatedData.totalEntities;
    } else {
      // Fallback: count verified from entity assessments  
      entityAssessments.forEach((entity: any) => {
        const latestAssessments = entity.latestAssessments || {};
        const assessment = latestAssessments[type];
        
        if (assessment && assessment.verified) {
          verified++;
        }
      });
    }
    
    // For executive view, we only show verified assessments (like standard view)
    total = verified;
    pending = 0; // Don't show pending since we can't accurately determine it
    
    // Get severity from the P7 ranked category gap summary
    if (aggregatedData?.gapSummary?.overallSeverity) {
      maxSeverity = aggregatedData.gapSummary.overallSeverity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    }
    
    // Always include all assessment types, even if they have 0 assessments
    assessmentSummaries.push({
      type,
      total,
      verified,
      pending,
      severity: maxSeverity
    });
  });
  
  return { assessments: assessmentSummaries };
};

/**
 * CompactAssessmentTile Component
 * 
 * Displays a simplified view of assessments by type showing only:
 * - Assessment type and icon
 * - Total count and completion status
 * - Highest severity level
 */
export function CompactAssessmentTile({ incidentId, className }: CompactAssessmentTileProps) {
  // Fetch assessments data
  const {
    data: assessmentsData,
    isLoading,
    error
  } = useQuery({
    queryKey: ['compact-assessments', incidentId],
    queryFn: () => fetchAssessmentsData(incidentId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!incidentId
  });

  // Handle loading state
  if (isLoading) {
    return (
      <Card className={cn("h-fit", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Assessment Status Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Loading assessments...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle error state
  if (error || !assessmentsData) {
    return (
      <Card className={cn("h-fit", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            Assessment Status Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-red-600">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Failed to load assessments</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const assessments = assessmentsData.assessments || [];

  // No assessments
  if (assessments.length === 0) {
    return (
      <Card className={cn("h-fit", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Assessment Status Overview
            <Badge variant="secondary" className="text-xs">
              No data
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No assessments available</p>
            <p className="text-xs text-muted-foreground mt-1">
              Complete assessments to see status overview
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate overall stats
  const totalAssessments = assessments.reduce((sum, a) => sum + a.total, 0);
  const totalVerified = assessments.reduce((sum, a) => sum + a.verified, 0);
  const overallCompletion = getCompletionPercentage(totalVerified, totalAssessments);

  return (
    <Card className={cn("h-fit", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Assessment Status Overview
          </div>
          <Badge variant="secondary" className="text-xs">
            {overallCompletion}% complete
          </Badge>
        </CardTitle>
      </CardHeader>
      
      <CardContent>
        <div className="grid grid-cols-5 gap-3">
          {assessments.map((assessment) => {
            const config = assessmentTypeConfig[assessment.type] || {
              icon: AlertTriangle,
              color: 'text-muted-foreground',
              label: assessment.type
            };
            const Icon = config.icon;
            const completion = getCompletionPercentage(assessment.verified, assessment.total);
            const severityBadgeClasses = assessment.severity ? getBadgeClasses('severity', assessment.severity) : '';
            const shouldFlash = assessment.severity ? (shouldFlashMap[assessment.severity] ?? false) : false;
            
            return (
              <div key={assessment.type} className="p-3 bg-muted rounded-lg border border-border hover:border-gray-300 transition-colors relative">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", config.color)} />
                    <span className="font-medium text-sm text-foreground">{config.label}</span>
                  </div>
                  {assessment.severity && (
                    <div className="relative">
                      <Badge 
                        variant="outline"
                        className={cn(
                          "text-xs border transition-all duration-300 gap-1", 
                          severityBadgeClasses,
                          shouldFlash && "animate-pulse"
                        )}
                      >
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {assessment.severity}
                      </Badge>
                    </div>
                  )}
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-center text-xs text-muted-foreground">
                    <span>Verified Assessments</span>
                  </div>
                  
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {assessment.verified}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      completed
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Overall Summary */}
        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>Total Assessments</span>
            </div>
            <div className="font-semibold text-foreground">
              {totalVerified}/{totalAssessments} completed ({overallCompletion}%)
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default CompactAssessmentTile;