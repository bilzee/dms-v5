'use client';

import React, { useMemo, useState } from 'react';
import { cn, formatNumber, formatArrayValue } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { getBadgeClasses } from '@/components/shared/StatusBadge';
import { Calendar, User, AlertTriangle, CheckCircle, Info, AlertCircle, Heart, Wheat, Droplets, Home, Shield, Users } from '@/lib/icons';
import { GapIndicator } from './GapIndicator';
import type { 
  HealthAssessmentData, 
  FoodAssessmentData, 
  WASHAssessmentData,
  ShelterAssessmentData,
  SecurityAssessmentData,
  PopulationAssessmentData
} from '@/app/api/v1/dashboard/situation/route';

interface AssessmentCategorySummaryProps {
  category: 'health' | 'food' | 'wash' | 'shelter' | 'security' | 'population';
  assessment: any;
  gapAnalysis?: any;
  layout: 'split' | 'full';
  className?: string;
  showRecommendations?: boolean;
  isAggregated?: boolean; // New prop to indicate this is aggregated data
}

// Category configuration
const categoryConfig = {
  health: {
    title: 'Health Assessment',
    Icon: Heart,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200'
  },
  food: {
    title: 'Food Security',
    Icon: Wheat,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200'
  },
  wash: {
    title: 'WASH (Water & Sanitation)',
    Icon: Droplets,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200'
  },
  shelter: {
    title: 'Shelter & Housing',
    Icon: Home,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200'
  },
  security: {
    title: 'Security & Protection',
    Icon: Shield,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200'
  },
  population: {
    title: 'Population Overview',
    Icon: Users,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    borderColor: 'border-border'
  }
} as const;

// Units mapping for numeric fields
const fieldUnits = {
  // Health
  numberHealthFacilities: 'facilities',
  qualifiedHealthWorkers: 'workers',
  
  // Food
  availableFoodDurationDays: 'days',
  additionalFoodRequiredPersons: 'persons',
  additionalFoodRequiredHouseholds: 'households',
  
  // WASH
  functionalLatrinesAvailable: 'latrines',
  
  // Shelter
  numberSheltersRequired: 'shelters',
  
  // Population
  totalPopulation: 'people',
  totalHouseholds: 'households',
  populationMale: 'people',
  populationFemale: 'people',
  populationUnder5: 'children',
  pregnantWomen: 'women',
  lactatingMothers: 'mothers',
  personWithDisability: 'people',
  elderlyPersons: 'people',
  separatedChildren: 'children',
  numberLivesLost: 'lives',
  numberInjured: 'people'
} as const;

// Field definitions for gap vs non-gap indicating fields
const fieldDefinitions = {
  health: {
    gapIndicators: [
      { key: 'hasFunctionalClinic', label: 'Functional Clinic', boolean: true },
      { key: 'hasEmergencyServices', label: 'Emergency Services', boolean: true },
      { key: 'hasTrainedStaff', label: 'Trained Staff', boolean: true },
      { key: 'hasMedicineSupply', label: 'Medicine Supply', boolean: true },
      { key: 'hasMedicalSupplies', label: 'Medical Supplies', boolean: true },
      { key: 'hasMaternalChildServices', label: 'Maternal/Child Services', boolean: true }
    ],
    nonGapIndicators: [
      { key: 'numberHealthFacilities', label: 'Health Facilities', boolean: false },
      { key: 'healthFacilityType', label: 'Facility Type', boolean: false },
      { key: 'qualifiedHealthWorkers', label: 'Qualified Workers', boolean: false },
      { key: 'commonHealthIssues', label: 'Common Issues', boolean: false }
    ]
  },
  food: {
    gapIndicators: [
      { key: 'isFoodSufficient', label: 'Food Sufficiency', boolean: true },
      { key: 'hasRegularMealAccess', label: 'Regular Meal Access', boolean: true },
      { key: 'hasInfantNutrition', label: 'Infant Nutrition', boolean: true }
    ],
    nonGapIndicators: [
      { key: 'foodSource', label: 'Food Source', boolean: false },
      { key: 'availableFoodDurationDays', label: 'Food Duration (Days)', boolean: false },
      { key: 'additionalFoodRequiredPersons', label: 'Additional Food Needed (Persons)', boolean: false },
      { key: 'additionalFoodRequiredHouseholds', label: 'Additional Food Needed (Households)', boolean: false }
    ]
  },
  wash: {
    gapIndicators: [
      { key: 'isWaterSufficient', label: 'Water Sufficiency', boolean: true },
      { key: 'hasCleanWaterAccess', label: 'Clean Water Access', boolean: true },
      { key: 'areLatrinesSufficient', label: 'Sufficient Latrines', boolean: true },
      { key: 'hasHandwashingFacilities', label: 'Handwashing Facilities', boolean: true },
      { key: 'hasOpenDefecationConcerns', label: 'Open Defecation Concerns', boolean: true, invert: true }
    ],
    nonGapIndicators: [
      { key: 'waterSource', label: 'Water Source', boolean: false },
      { key: 'functionalLatrinesAvailable', label: 'Functional Latrines', boolean: false }
    ]
  },
  shelter: {
    gapIndicators: [
      { key: 'areSheltersSufficient', label: 'Sufficient Shelters', boolean: true },
      { key: 'hasSafeStructures', label: 'Safe Structures', boolean: true },
      { key: 'areOvercrowded', label: 'Overcrowding', boolean: true, invert: true },
      { key: 'provideWeatherProtection', label: 'Weather Protection', boolean: true }
    ],
    nonGapIndicators: [
      { key: 'shelterTypes', label: 'Shelter Types', boolean: false },
      { key: 'requiredShelterType', label: 'Required Shelter Type', boolean: false },
      { key: 'numberSheltersRequired', label: 'Shelters Required', boolean: false }
    ]
  },
  security: {
    gapIndicators: [
      { key: 'isSafeFromViolence', label: 'Safe from Violence', boolean: true },
      { key: 'gbvCasesReported', label: 'GBV Cases', boolean: true, invert: true },
      { key: 'hasSecurityPresence', label: 'Security Presence', boolean: true },
      { key: 'hasProtectionReportingMechanism', label: 'Protection Reporting', boolean: true },
      { key: 'vulnerableGroupsHaveAccess', label: 'Vulnerable Groups Access', boolean: true },
      { key: 'hasLighting', label: 'Lighting', boolean: true }
    ],
    nonGapIndicators: []
  },
  population: {
    gapIndicators: [], // Population doesn't have gap indicators
    nonGapIndicators: [
      { key: 'totalPopulation', label: 'Total Population', boolean: false },
      { key: 'totalHouseholds', label: 'Total Households', boolean: false },
      { key: 'populationMale', label: 'Male Population', boolean: false },
      { key: 'populationFemale', label: 'Female Population', boolean: false },
      { key: 'populationUnder5', label: 'Children Under 5', boolean: false },
      { key: 'pregnantWomen', label: 'Pregnant Women', boolean: false },
      { key: 'lactatingMothers', label: 'Lactating Mothers', boolean: false },
      { key: 'personWithDisability', label: 'Persons with Disability', boolean: false },
      { key: 'elderlyPersons', label: 'Elderly Persons', boolean: false },
      { key: 'separatedChildren', label: 'Separated Children', boolean: false },
      { key: 'numberLivesLost', label: 'Lives Lost', boolean: false },
      { key: 'numberInjured', label: 'Injured', boolean: false }
    ]
  }
} as const;

/**
 * AssessmentCategorySummary Component
 * 
 * Displays assessment data for a specific category with:
 * - Split layout: Non-gap indicators on left, gap indicators on right
 * - Gap analysis with visual indicators
 * - Assessment metadata (date, assessor)
 * - No data state when assessment is missing
 */

const severityIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  CRITICAL: AlertTriangle,
  HIGH: AlertCircle,
  MEDIUM: Info,
  LOW: Info
};

const severityFlashMap: Record<string, string> = {
  CRITICAL: 'animate-pulse',
  HIGH: 'animate-pulse',
  MEDIUM: '',
  LOW: ''
};
export function AssessmentCategorySummary({
  category,
  assessment,
  gapAnalysis,
  layout = 'split',
  className,
  showRecommendations = false,
  isAggregated = false
}: AssessmentCategorySummaryProps) {
  const config = categoryConfig[category];
  const fieldConfig = fieldDefinitions[category];
  
  // Severity comes from the registry-derived `fieldSeverityMap` the situation
  // route attaches to gapAnalysis (Question.severity at analysis time); the
  // static lists below are a display-only fallback for legacy payloads.
  const gapFields = gapAnalysis?.gapFields || [];
  const fieldSeverityMap = gapAnalysis?.fieldSeverityMap || {};

  const getFieldSeverity = (fieldName: string): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' => {
    // Registry-derived severity from the gap analysis
    if (fieldSeverityMap[fieldName]) {
      return fieldSeverityMap[fieldName];
    }

    // If this field is not in the gap fields, no gap
    if (!gapFields.includes(fieldName)) {
      return 'LOW'; // No gap
    }

    // Display-only fallback for gap fields without a severity map
    const criticalFields = [
      'hasEmergencyServices', 'hasFunctionalClinic', 'isWaterSufficient', 
      'areSheltersSufficient', 'hasSafetyConcerns', 'hasImmediateThreats'
    ];
    
    const highFields = [
      'hasCleanWaterAccess', 'hasTrainedStaff', 'hasMedicineSupply',
      'isFoodSufficient', 'hasRegularMealAccess', 'hasSafeStructures'
    ];
    
    const mediumFields = [
      'hasHandwashingFacilities', 'areLatrinesSufficient', 'hasMedicalSupplies',
      'hasInfantNutrition', 'areOvercrowded', 'provideWeatherProtection'
    ];

    if (criticalFields.includes(fieldName)) {
      return 'CRITICAL';
    } else if (highFields.includes(fieldName)) {
      return 'HIGH';
    } else if (mediumFields.includes(fieldName)) {
      return 'MEDIUM';
    }
    
    // Default to HIGH for any other gap fields not explicitly categorized
    return 'HIGH';
  };

  if (!assessment) {
    return (
      <Card className={cn("opacity-60 border-dashed border-2", config.borderColor, className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
            <config.Icon className={cn("h-4 w-4 opacity-50", config.color)} />
            {config.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <div className="text-2xl mb-2 opacity-50">📋</div>
            <p className="text-sm font-medium">Assessment Missing</p>
            <p className="text-xs mt-1">This assessment hasn&apos;t been completed yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const renderField = (key: string, label: string, boolean: boolean, invert = false) => {
    const value = assessment[key];
    
    if (boolean) {
      if (isAggregated && gapAnalysis?.fieldCounts?.[key]) {
        // For aggregated data, show count of entities with gaps
        const fieldCount = gapAnalysis.fieldCounts[key];
        const severity = fieldCount.gaps > 0 ? (gapAnalysis.fieldSeverityMap[key] || 'HIGH') : 'LOW';
        const hasGap = fieldCount.gaps > 0;
        
        return (
          <div key={key} className="flex items-center justify-between py-1">
            <span className="text-sm text-muted-foreground">{label}</span>
            <div className="flex items-center gap-2">
              {hasGap ? (
                <>
                  <GapIndicator hasGap={true} severity={severity} size="sm" />
                  <span className="text-[11px] text-muted-foreground bg-muted px-2 py-1 rounded">
                    {fieldCount.gaps} of {fieldCount.total}
                  </span>
                </>
              ) : (
                <>
                  <GapIndicator hasGap={false} severity="LOW" size="sm" />
                  <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded">
                    No gaps
                  </span>
                </>
              )}
            </div>
          </div>
        );
      } else {
        // Individual entity data (original logic)
        const hasGap = invert ? value : !value;
        const severity = hasGap ? getFieldSeverity(key) : 'LOW';
        return (
          <div key={key} className="flex items-center justify-between py-1">
            <span className="text-sm text-muted-foreground">{label}</span>
            <GapIndicator hasGap={hasGap} severity={severity} size="sm" />
          </div>
        );
      }
    }

    // Format non-boolean values with improved styling
    let displayValue: string;
    let unit: string = '';
    
    if (typeof value === 'number') {
      displayValue = formatNumber(value);
      // Add unit if available
      const fieldKey = key as keyof typeof fieldUnits;
      if (fieldUnits[fieldKey]) {
        unit = fieldUnits[fieldKey];
      }
    } else if (typeof value === 'object' && value !== null) {
      displayValue = formatArrayValue(value);
    } else if (typeof value === 'string' && (value.startsWith('[') || value.includes(','))) {
      // Handle string arrays
      displayValue = formatArrayValue(value);
    } else {
      displayValue = value ? String(value) : 'N/A';
    }

    // Check if this is being rendered in the Overview section (non-gap fields)
    const isOverviewField = fieldConfig.nonGapIndicators.some(field => field.key === key);

    if (isOverviewField) {
      // Overview layout: variable name and value on same row, minimizing vertical space
      return (
        <div key={key} className="flex items-center justify-between py-0.5">
          <div className="text-muted-foreground font-medium uppercase tracking-wide leading-tight" style={{fontSize: '8px'}}>
            {label}
          </div>
          <div className="text-sm font-medium text-foreground">
            {displayValue}
            {unit && <span className="text-xs text-muted-foreground ml-1">{unit}</span>}
          </div>
        </div>
      );
    }

    // Gap analysis layout: regular row format
    return (
      <div key={key} className="flex items-center justify-between py-1">
        <span className="text-sm text-muted-foreground flex-1">{label}</span>
        <span className="text-sm font-semibold text-foreground bg-muted px-2 py-1 rounded text-right min-w-0 flex-shrink-0">
          {displayValue}
          {unit && <span className="text-xs text-muted-foreground ml-1">{unit}</span>}
        </span>
      </div>
    );
  };

  const gapFieldElements = fieldConfig.gapIndicators.map(field => 
    renderField(field.key, field.label, field.boolean, (field as any).invert)
  );
  
  const nonGapFieldElements = fieldConfig.nonGapIndicators.map(field => 
    renderField(field.key, field.label, field.boolean)
  );

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <config.Icon className={cn("h-4 w-4", config.color)} />
            {config.title}
          </CardTitle>
          {gapAnalysis && (
            <div className="flex items-center gap-2">
              {gapAnalysis.hasGap ? (
                (() => {
                  const IconComponent = severityIconMap[gapAnalysis.severity] || Info;
                  const badgeClass = getBadgeClasses('severity', gapAnalysis.severity);
                  return (
                    <Badge 
                      variant="outline" 
                      className={cn("text-xs font-bold", badgeClass, severityFlashMap[gapAnalysis.severity] || '')}
                    >
                      <IconComponent className="h-3 w-3 mr-1" />
                      {gapAnalysis.severity}
                    </Badge>
                  );
                })()
              ) : (
                <Badge 
                  variant="outline" 
                  className={cn("text-xs font-bold", getBadgeClasses('severity', 'LOW'))}
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  No Gaps
                </Badge>
              )}
            </div>
          )}
        </div>
        
        {/* Assessment metadata */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {assessment.rapidAssessmentDate && (
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(assessment.rapidAssessmentDate).toLocaleDateString()}
            </div>
          )}
          {assessment.assessorName && (
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {assessment.assessorName}
            </div>
          )}
          {assessment.verificationStatus && (
            <Badge variant="outline" className="text-xs">
              {assessment.verificationStatus}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {isAggregated ? (
          // Aggregated view - show only gap indicators
          <div className="space-y-2">
            {gapFieldElements.length > 0 ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-foreground">Gap Analysis (All Entities)</h4>
                  <span className="text-xs text-muted-foreground">Select entity for details</span>
                </div>
                {gapFieldElements}
              </>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <CheckCircle className="h-6 w-6 mx-auto mb-2 text-green-500" />
                <p className="text-xs">No gap indicators across all entities</p>
              </div>
            )}
          </div>
        ) : layout === 'split' && gapFieldElements.length > 0 ? (
          <div className="space-y-4">
            {/* Gap indicators (top section) */}
            <div className="space-y-2">
              {gapFieldElements.length > 0 ? (
                <>
                  <div className="border border-border rounded-lg p-3">
                    <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Gap Analysis
                    </h4>
                    <div className="space-y-2">
                      {gapFieldElements}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-4 text-muted-foreground bg-green-50 rounded-lg border border-green-200">
                  <CheckCircle className="h-6 w-6 mx-auto mb-2 text-green-500" />
                  <p className="text-xs text-green-700">No gap indicators</p>
                </div>
              )}
            </div>

            {/* Non-gap indicators (bottom section) */}
            <div className="space-y-2">
              {nonGapFieldElements.length > 0 ? (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <h4 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
                      <Info className="h-4 w-4" />
                      Context
                    </h4>
                    <div className="space-y-1">
                      {nonGapFieldElements}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-4 text-muted-foreground bg-muted rounded-lg">
                  <Info className="h-6 w-6 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No overview data</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          // Full layout - all fields together
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground mb-2">Assessment Details</h4>
            {[...nonGapFieldElements, ...gapFieldElements]}
          </div>
        )}

        {/* Recommendations - only show if enabled */}
        {showRecommendations && gapAnalysis?.recommendations && gapAnalysis.recommendations.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium text-foreground mb-2">Recommendations</h4>
            <ul className="space-y-1">
              {gapAnalysis.recommendations.map((recommendation: string, index: number) => (
                <li key={index} className="text-xs text-muted-foreground flex items-start gap-1">
                  <span className="text-blue-500 mt-0.5">•</span>
                  {recommendation}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AssessmentCategorySummary;