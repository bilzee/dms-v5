'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, AlertTriangle, AlertCircle, Info, X, BarChart3, UserCheck, Eye, Heart, Wheat, Droplets, Home, Shield } from '@/lib/icons';
import type { SummaryQuestionMeta } from '@/lib/questions/gap-summary';

interface IndividualEntityGapInfoPopupProps {
  isOpen: boolean;
  onClose: () => void;
  assessmentType?: 'health' | 'food' | 'wash' | 'shelter' | 'security';
  /** P10-4 (5b) — live registry projection; GAP rows render the field grid. */
  questions?: SummaryQuestionMeta[];
}

/** Presentation-only config (title/icon/colors stay static; fields are registry-driven). */
const assessmentPresentation = {
  health: {
    title: 'Health Assessment',
    icon: Heart,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200'
  },
  food: {
    title: 'Food Security',
    icon: Wheat,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200'
  },
  wash: {
    title: 'WASH (Water & Sanitation)',
    icon: Droplets,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200'
  },
  shelter: {
    title: 'Shelter Assessment',
    icon: Home,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200'
  },
  security: {
    title: 'Security Assessment',
    icon: Shield,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200'
  }
};

export function IndividualEntityGapInfoPopup({
  isOpen,
  onClose,
  assessmentType = 'health',
  questions
}: IndividualEntityGapInfoPopupProps) {
  if (!isOpen) return null;

  const config = assessmentPresentation[assessmentType];

  // P10-4 (5b) — the field list is the live registry projection (labels and
  // gap meanings always match the current registry; new GAP questions appear
  // here without code changes). CONTEXT questions never render.
  const gapQuestions = (questions ?? [])
    .filter((question) => question.category === 'GAP')
    .sort((a, b) => a.order - b.order);

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Eye className="h-5 w-5 text-blue-600" />
              Understanding {config.title} for Individual Entities
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          {/* Overview */}
          <div className="space-y-3">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-green-600" />
              What This Assessment Shows
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              Individual entity assessments evaluate gap indicators at a <span className="font-medium">specific location or facility</span>. 
              Unlike aggregated &quot;All Entities&quot; view which shows patterns across many locations, this assessment focuses on 
              the actual conditions at <span className="font-medium">this specific entity</span>.
            </p>
          </div>

          {/* Severity Hierarchy */}
          <div className="space-y-3">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-purple-600" />
              Understanding Severity Hierarchy
            </h3>
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-purple-200 rounded-lg p-4 space-y-4">
              <p className="text-sm text-foreground">
                Severity is calculated through a clear three-level hierarchy that connects individual field conditions to overall entity priority:
              </p>
              
              <div className="space-y-3">
                {/* Level 1 */}
                <div className="bg-card rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                    <span className="font-semibold text-blue-700">Individual Field Severity</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Each gap field (e.g., &quot;Functional Clinic&quot;, &quot;Clean Water Access&quot;) is assigned a severity level in <strong>Gap Field Severity Management</strong>:
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-red-600 rounded-full"></div>
                      <span>CRITICAL</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-orange-600 rounded-full"></div>
                      <span>HIGH</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-yellow-600 rounded-full"></div>
                      <span>MEDIUM</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-green-600 rounded-full"></div>
                      <span>LOW</span>
                    </div>
                  </div>
                </div>

                {/* Level 2 */}
                <div className="bg-card rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                    <span className="font-semibold text-purple-700">Assessment Severity</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Each assessment type (Health, Food, WASH, etc.) gets its severity from the <strong>highest severity among its gap fields that have gaps</strong>:
                  </p>
                  <div className="bg-purple-50 rounded p-2 text-xs text-purple-800">
                    Example: If Health assessment has fields with severities [HIGH, MEDIUM, LOW], the Assessment Severity = HIGH
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    The assessment badge shows this severity level with appropriate color and icon.
                  </p>
                </div>

                {/* Level 3 */}
                <div className="bg-card rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                    <span className="font-semibold text-green-700">Entity Severity</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Entity severity is the <strong>highest assessment severity across all assessment types</strong> for that entity:
                  </p>
                  <div className="bg-green-50 rounded p-2 text-xs text-green-800">
                    Example: If assessments show [HEALTH: HIGH, FOOD: MEDIUM, WASH: LOW], the Entity Severity = HIGH (with count = 1)
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    The entity badge shows this severity with the count of assessments that have this highest severity.
                  </p>
                </div>
              </div>

              <div className="mt-4 p-3 bg-muted rounded-lg">
                <p className="text-xs font-semibold text-foreground mb-1">Priority Order:</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>CRITICAL</span>
                  <span>&gt;</span>
                  <span>HIGH</span>
                  <span>&gt;</span>
                  <span>MEDIUM</span>
                  <span>&gt;</span>
                  <span>LOW</span>
                </div>
              </div>
            </div>
          </div>

          {/* How Gap Detection Works */}
          <div className="space-y-3">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-purple-600" />
              How Gaps Are Identified
            </h3>
            <div className="bg-muted rounded-lg p-4 space-y-3">
              <p className="text-sm text-foreground">
                Gaps are identified through rapid assessments where field teams evaluate specific criteria:
              </p>
              
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 bg-orange-600 rounded-full"></div>
                  <div>
                    <span className="font-semibold">Gap Detected (❌)</span> - Field doesn&apos;t meet required standards
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 bg-green-600 rounded-full"></div>
                  <div>
                    <span className="font-semibold">No Gap (✅)</span> - Field meets required standards
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* What the Colors Mean */}
          <div className="space-y-3">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              What the Colors Indicate
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-600 rounded-full"></div>
                  <span className="text-sm font-medium text-red-700">Red (Critical)</span>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  Life-threatening or immediate safety risks
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-orange-600 rounded-full"></div>
                  <span className="text-sm font-medium text-orange-700">Orange (High)</span>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  Significant impact on service delivery
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-yellow-600 rounded-full"></div>
                  <span className="text-sm font-medium text-yellow-700">Yellow (Medium)</span>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  Moderate issues affecting service quality
                </p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-green-600 rounded-full"></div>
                  <span className="text-sm font-medium text-green-700">Green (Low)</span>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  No significant issues detected
                </p>
              </div>
            </div>
          </div>

          {/* Specific Assessment Fields */}
          <div className="space-y-3">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <config.icon className={cn('h-4 w-4', config.color)} />
              <span>{config.title} Fields</span>
            </h3>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
              <p className="text-sm text-blue-800">
                This assessment evaluates the following gap indicators for {config.title}:
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {gapQuestions.length > 0 ? (
                  gapQuestions.map((question) => (
                    <div key={question.key} className="bg-card rounded border border-blue-200 p-3">
                      <div className="font-medium text-sm text-foreground mb-1">
                        {question.label}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {question.gapMeaning || question.gapLabel || question.label}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="bg-card rounded border border-blue-200 p-3 md:col-span-2">
                    <p className="text-xs text-muted-foreground">
                      Gap indicator definitions are maintained in the question registry; no gap questions are currently published for this assessment type.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Assessment Process */}
          <div className="space-y-3">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-600" />
              Assessment Process
            </h3>
            <div className="bg-muted rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold">1</div>
                  <div>
                    <div className="font-medium">Field Assessment</div>
                    <p className="text-muted-foreground">Evaluate each gap indicator against standards</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold">2</div>
                  <div>
                    <div className="font-medium">Gap Detection</div>
                    <p className="text-muted-foreground">Identify which indicators have gaps</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold">3</div>
                  <div>
                    <div className="font-medium">Severity Assignment</div>
                    <p className="text-muted-foreground">Assign severity level based on impact</p>
                  </div>
                </div>
              </div>
              
              <p className="text-xs text-muted-foreground mt-2">
                Assessment is conducted by trained field teams and verified by supervisors.
              </p>
            </div>
          </div>

          {/* Key Benefits */}
          <div className="space-y-3">
            <h3 className="font-semibold text-foreground">Key Benefits</h3>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>Provides detailed understanding of conditions at specific locations</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>Enables targeted interventions based on actual gaps identified</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>Supports monitoring of improvement over time at individual sites</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>Helps identify which specific resources are needed at each location</span>
              </li>
            </ul>
          </div>

          {/* Close Button */}
          <div className="flex justify-end pt-4 border-t">
            <Button onClick={onClose}>
              Got it, thanks!
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default IndividualEntityGapInfoPopup;