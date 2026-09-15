import { prisma } from '@/lib/db/client';
import { AssessmentType } from '@prisma/client';
import { fromAnswers, RapidAssessmentAnswers, RapidAssessmentType } from '@/lib/questions/legacy-convert';

interface ExportRequest {
  format: 'pdf' | 'csv';
  categories?: string[];
  timeframe?: string;
  includeCharts?: boolean;
  includeGapAnalysis?: boolean;
  includeTrends?: boolean;
}

interface Coordinates {
  lat: number;
  lng: number;
}

interface AssessmentForExport {
  id: string;
  rapidAssessmentType: string;
  rapidAssessmentDate: Date;
  verificationStatus: string;
  assessor?: { name: string } | null;
  answers?: Record<string, unknown> | null;
  gapAnalysis?: Record<string, unknown> | null;
}

// Hydrates the legacy typed payload view from the canonical answers map
function answersData(assessment: AssessmentForExport): Record<string, unknown> | null {
  return fromAnswers(
    assessment.rapidAssessmentType as RapidAssessmentType,
    (assessment.answers ?? {}) as RapidAssessmentAnswers
  ) as Record<string, unknown>;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  location: string | null;
  coordinates: Coordinates | null;
  metadata: Record<string, unknown> | null;
  rapidAssessments: AssessmentForExport[];
}

interface ReportData {
  fileSize: number;
  content: string | Buffer;
  fileName: string;
  mimeType: string;
}

/**
 * Generate a comprehensive entity report for donors
 */
export async function generateEntityReport(
  entityId: string,
  entity: Entity,
  exportRequest: ExportRequest
): Promise<ReportData> {
  const { format, categories, timeframe, includeCharts, includeGapAnalysis, includeTrends } = exportRequest;

  // Filter assessments by categories if specified
  let filteredAssessments = entity.rapidAssessments;
  if (categories && categories.length > 0) {
    filteredAssessments = filteredAssessments.filter(assessment => 
      categories.includes(assessment.rapidAssessmentType)
    );
  }

  // Filter assessments by timeframe if specified
  if (timeframe && timeframe !== 'all') {
    const cutoffDate = new Date();
    switch (timeframe) {
      case '30d':
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        break;
      case '90d':
        cutoffDate.setDate(cutoffDate.getDate() - 90);
        break;
      case '1y':
        cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
        break;
    }
    filteredAssessments = filteredAssessments.filter(assessment => 
      assessment.rapidAssessmentDate >= cutoffDate
    );
  }

  if (format === 'csv') {
    return generateCSVReport(entityId, entity, filteredAssessments, exportRequest);
  } else {
    return generatePDFReport(entityId, entity, filteredAssessments, exportRequest);
  }
}

/**
 * Generate CSV format report
 */
function generateCSVReport(
  entityId: string,
  entity: Entity,
  assessments: AssessmentForExport[],
  exportRequest: ExportRequest
): ReportData {
  const csvRows = [];
  const metadata = entity.metadata || {};

  // CSV Header
  csvRows.push('Entity Assessment Report');
  csvRows.push(`Generated,${new Date().toISOString()}`);
  csvRows.push('');

  // Entity Information
  csvRows.push('Entity Information');
  csvRows.push('Entity Name,' + entity.name);
  csvRows.push('Entity Type,' + entity.type);
  csvRows.push('Location,' + (entity.location || 'N/A'));
  csvRows.push('Population,' + (metadata.population || metadata.totalPopulation || 'N/A'));
  csvRows.push('LGA,' + (metadata.lga || 'N/A'));
  csvRows.push('Ward,' + (metadata.ward || 'N/A'));
  csvRows.push('');

  // Assessment Summary
  csvRows.push('Assessment Summary');
  csvRows.push('Category,Total Assessments,Verified Assessments,Latest Assessment Date');
  
  const assessmentTypes = ['HEALTH', 'WASH', 'SHELTER', 'FOOD', 'SECURITY', 'POPULATION'];
  
  assessmentTypes.forEach(type => {
    const categoryAssessments = assessments.filter(a => a.rapidAssessmentType === type);
    const verifiedCount = categoryAssessments.filter(a => a.verificationStatus === 'VERIFIED').length;
    const latestDate = categoryAssessments.length > 0 
      ? new Date(Math.max(...categoryAssessments.map(a => new Date(a.rapidAssessmentDate).getTime()))).toISOString().split('T')[0]
      : 'N/A';
    
    csvRows.push(`${type},${categoryAssessments.length},${verifiedCount},${latestDate}`);
  });

  csvRows.push('');

  // Detailed Assessment Data
  csvRows.push('Detailed Assessment Data');
  csvRows.push('Assessment ID,Type,Date,Status,Assessor,Key Metrics,Gaps Identified');

  assessments.forEach(assessment => {
    const keyMetrics = extractKeyMetrics(assessment);
    const gaps = extractGaps(assessment);
    
    csvRows.push([
      assessment.id,
      assessment.rapidAssessmentType,
      assessment.rapidAssessmentDate.toISOString().split('T')[0],
      assessment.verificationStatus,
      assessment.assessor?.name || 'N/A',
      `"${keyMetrics.replace(/"/g, '""')}"`, // Escape quotes in CSV
      `"${gaps.replace(/"/g, '""')}"`
    ].join(','));
  });

  // Gap Analysis (if included)
  if (exportRequest.includeGapAnalysis) {
    csvRows.push('');
    csvRows.push('Gap Analysis Summary');
    csvRows.push('Category,Severity,Description,Recommended Actions');
    
    const gapAnalysis = analyzeGaps(assessments, (metadata.population as number) || (metadata.totalPopulation as number) || 1000);
    gapAnalysis.forEach(gap => {
      const actions = gap.recommendedActions.join('; ');
      csvRows.push(`${gap.category},${gap.severity},"${gap.description}","${actions}"`);
    });
  }

  const csvContent = csvRows.join('\n');
  const fileName = `${entity.name.replace(/[^a-z0-9]/gi, '_')}_assessment_report_${new Date().toISOString().split('T')[0]}.csv`;

  return {
    fileSize: Buffer.byteLength(csvContent, 'utf8'),
    content: csvContent,
    fileName,
    mimeType: 'text/csv'
  };
}

/**
 * Generate PDF format report (simplified implementation)
 */
function generatePDFReport(
  entityId: string,
  entity: Entity,
  assessments: AssessmentForExport[],
  exportRequest: ExportRequest
): ReportData {
  const metadata = entity.metadata || {};

  // Generate HTML content for PDF
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>${entity.name} - Assessment Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
        .entity-info { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .section { margin-bottom: 30px; }
        .section h2 { color: #333; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        .gap-critical { background-color: #ffebee; }
        .gap-high { background-color: #fff3e0; }
        .gap-medium { background-color: #e8f5e8; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .summary-card { background: #f8f9fa; padding: 15px; border-radius: 5px; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <h1>${entity.name} - Assessment Report</h1>
        <p>Generated on ${new Date().toLocaleDateString()}</p>
    </div>

    <div class="section">
        <h2>Entity Information</h2>
        <div class="entity-info">
            <p><strong>Entity Type:</strong> ${entity.type}</p>
            <p><strong>Location:</strong> ${entity.location || 'N/A'}</p>
            <p><strong>Population:</strong> ${metadata.population || metadata.totalPopulation || 'N/A'}</p>
            <p><strong>LGA:</strong> ${metadata.lga || 'N/A'}</p>
            <p><strong>Ward:</strong> ${metadata.ward || 'N/A'}</p>
        </div>
    </div>

    <div class="section">
        <h2>Assessment Summary</h2>
        <div class="summary-grid">
            <div class="summary-card">
                <h3>${assessments.length}</h3>
                <p>Total Assessments</p>
            </div>
            <div class="summary-card">
                <h3>${assessments.filter(a => a.verificationStatus === 'VERIFIED').length}</h3>
                <p>Verified Assessments</p>
            </div>
            <div class="summary-card">
                <h3>${new Set(assessments.map(a => a.rapidAssessmentType)).size}</h3>
                <p>Categories Covered</p>
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th>Category</th>
                    <th>Total Assessments</th>
                    <th>Verified Assessments</th>
                    <th>Latest Assessment Date</th>
                </tr>
            </thead>
            <tbody>
                ${generateAssessmentSummaryRows(assessments)}
            </tbody>
        </table>
    </div>

    ${exportRequest.includeGapAnalysis ? `
    <div class="section">
        <h2>Gap Analysis</h2>
        <table>
            <thead>
                <tr>
                    <th>Category</th>
                    <th>Severity</th>
                    <th>Description</th>
                    <th>Recommended Actions</th>
                </tr>
            </thead>
            <tbody>
                ${generateGapAnalysisRows(assessments, (metadata.population as number) || (metadata.totalPopulation as number) || 1000)}
            </tbody>
        </table>
    </div>
    ` : ''}

    <div class="section">
        <h2>Detailed Assessment Data</h2>
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Assessor</th>
                    <th>Key Metrics</th>
                    <th>Gaps Identified</th>
                </tr>
            </thead>
            <tbody>
                ${generateDetailedAssessmentRows(assessments)}
            </tbody>
        </table>
    </div>

    <div class="footer">
        <p><em>Report generated by Disaster Management System</em></p>
        <p><small>This report contains sensitive information and should be handled according to data protection policies.</small></p>
    </div>
</body>
</html>`;

  const fileName = `${entity.name.replace(/[^a-z0-9]/gi, '_')}_assessment_report_${new Date().toISOString().split('T')[0]}.pdf`;

  return {
    fileSize: Buffer.byteLength(htmlContent, 'utf8'),
    content: htmlContent,
    fileName,
    mimeType: 'application/pdf'
  };
}

/**
 * Helper function to generate assessment summary table rows
 */
function generateAssessmentSummaryRows(assessments: AssessmentForExport[]): string {
  const assessmentTypes = ['HEALTH', 'WASH', 'SHELTER', 'FOOD', 'SECURITY', 'POPULATION'];
  
  return assessmentTypes.map(type => {
    const categoryAssessments = assessments.filter(a => a.rapidAssessmentType === type);
    const verifiedCount = categoryAssessments.filter(a => a.verificationStatus === 'VERIFIED').length;
    const latestDate = categoryAssessments.length > 0 
      ? new Date(Math.max(...categoryAssessments.map(a => new Date(a.rapidAssessmentDate).getTime()))).toLocaleDateString()
      : 'N/A';
    
    return `
      <tr>
        <td>${type}</td>
        <td>${categoryAssessments.length}</td>
        <td>${verifiedCount}</td>
        <td>${latestDate}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Helper function to generate gap analysis table rows
 */
interface GapAnalysisResult {
  category: string;
  severity: string;
  description: string;
  recommendedActions: string[];
}

function generateGapAnalysisRows(assessments: AssessmentForExport[], population: number): string {
  const gaps = analyzeGaps(assessments, population);
  
  return gaps.map(gap => {
    const actions = gap.recommendedActions.join('<br> ');
    const severityClass = gap.severity === 'critical' ? 'gap-critical' : 
                          gap.severity === 'high' ? 'gap-high' : 'gap-medium';
    
    return `
      <tr class="${severityClass}">
        <td>${gap.category}</td>
        <td>${gap.severity.toUpperCase()}</td>
        <td>${gap.description}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Helper function to generate detailed assessment table rows
 */
function generateDetailedAssessmentRows(assessments: AssessmentForExport[]): string {
  return assessments.map(assessment => {
    const keyMetrics = extractKeyMetrics(assessment);
    const gaps = extractGaps(assessment);
    
    return `
      <tr>
        <td>${assessment.rapidAssessmentDate.toLocaleDateString()}</td>
        <td>${assessment.rapidAssessmentType}</td>
        <td>${assessment.verificationStatus}</td>
        <td>${assessment.assessor?.name || 'N/A'}</td>
        <td>${keyMetrics}</td>
        <td>${gaps}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Extract key metrics from assessment data
 */
function extractKeyMetrics(assessment: AssessmentForExport): string {
  const type = assessment.rapidAssessmentType;
  let data: Record<string, unknown> | null | undefined;
  const metrics = [];

  switch (type) {
    case 'HEALTH':
      data = answersData(assessment);
      if (data) {
        if (data.numberHealthFacilities) metrics.push(`Facilities: ${data.numberHealthFacilities}`);
        if (data.qualifiedHealthWorkers) metrics.push(`Staff: ${data.qualifiedHealthWorkers}`);
        metrics.push(data.hasFunctionalClinic ? 'Clinic: Yes' : 'Clinic: No');
        metrics.push(data.hasMedicineSupply ? 'Medicines: Yes' : 'Medicines: No');
      }
      break;

    case 'FOOD':
      data = answersData(assessment);
      if (data) {
        metrics.push(data.isFoodSufficient ? 'Food: Sufficient' : 'Food: Insufficient');
        metrics.push(data.hasRegularMealAccess ? 'Meals: Regular' : 'Meals: Irregular');
        if (data.availableFoodDurationDays) metrics.push(`Reserves: ${data.availableFoodDurationDays} days`);
      }
      break;

    case 'WASH':
      data = answersData(assessment);
      if (data) {
        metrics.push(data.isWaterSufficient ? 'Water: Sufficient' : 'Water: Insufficient');
        metrics.push(data.hasCleanWaterAccess ? 'Clean Water: Yes' : 'Clean Water: No');
        if (data.functionalLatrinesAvailable !== undefined) metrics.push(`Latrines: ${data.functionalLatrinesAvailable}`);
      }
      break;

    case 'SHELTER':
      data = answersData(assessment);
      if (data) {
        metrics.push(data.areSheltersSufficient ? 'Shelter: Sufficient' : 'Shelter: Insufficient');
        metrics.push(data.hasSafeStructures ? 'Safety: Yes' : 'Safety: No');
        if ((data.numberSheltersRequired as number) > 0) metrics.push(`Required: ${data.numberSheltersRequired}`);
      }
      break;

    case 'SECURITY':
      data = answersData(assessment);
      if (data) {
        metrics.push(data.isSafeFromViolence ? 'Safety: Yes' : 'Safety: No');
        metrics.push(data.hasSecurityPresence ? 'Security: Yes' : 'Security: No');
        metrics.push(data.hasProtectionReportingMechanism ? 'Reporting: Yes' : 'Reporting: No');
      }
      break;

    case 'POPULATION':
      data = answersData(assessment);
      if (data) {
        if (data.totalPopulation) metrics.push(`Population: ${data.totalPopulation}`);
        if (data.totalHouseholds) metrics.push(`Households: ${data.totalHouseholds}`);
        if ((data.numberLivesLost as number) > 0) metrics.push(`Lives Lost: ${data.numberLivesLost}`);
        if ((data.numberInjured as number) > 0) metrics.push(`Injured: ${data.numberInjured}`);
      }
      break;
  }

  return metrics.length > 0 ? metrics.join(', ') : 'N/A';
}

/**
 * Extract gaps from assessment data
 */
function extractGaps(assessment: AssessmentForExport): string {
  const type = assessment.rapidAssessmentType;
  let data: Record<string, unknown> | null | undefined;
  const gaps = [];

  switch (type) {
    case 'HEALTH':
      data = answersData(assessment);
      if (data) {
        if (!data.hasFunctionalClinic) gaps.push('No functional clinic');
        if (!data.hasMedicineSupply) gaps.push('No medicine supply');
        if (data.qualifiedHealthWorkers === 0) gaps.push('No qualified staff');
      }
      break;

    case 'FOOD':
      data = answersData(assessment);
      if (data) {
        if (!data.isFoodSufficient) gaps.push('Insufficient food');
        if (!data.hasRegularMealAccess) gaps.push('Irregular meal access');
        if ((data.availableFoodDurationDays as number) < 7) gaps.push('Low food reserves');
      }
      break;

    case 'WASH':
      data = answersData(assessment);
      if (data) {
        if (!data.isWaterSufficient) gaps.push('Insufficient water');
        if (!data.hasCleanWaterAccess) gaps.push('No clean water access');
        if (data.functionalLatrinesAvailable === 0) gaps.push('No latrines');
      }
      break;

    case 'SHELTER':
      data = answersData(assessment);
      if (data) {
        if (!data.areSheltersSufficient) gaps.push('Insufficient shelter');
        if (!data.hasSafeStructures) gaps.push('No safe structures');
        if (data.areOvercrowded) gaps.push('Overcrowded shelters');
      }
      break;

    case 'SECURITY':
      data = answersData(assessment);
      if (data) {
        if (!data.isSafeFromViolence) gaps.push('Safety concerns');
        if (!data.hasSecurityPresence) gaps.push('No security presence');
        if (!data.hasProtectionReportingMechanism) gaps.push('No reporting mechanism');
      }
      break;
  }

  return gaps.length > 0 ? gaps.join(', ') : 'No significant gaps identified';
}

/**
 * Analyze gaps across all assessments
 */
function analyzeGaps(assessments: AssessmentForExport[], population: number): GapAnalysisResult[] {
  const gaps: GapAnalysisResult[] = [];
  const latestAssessments = new Map<string, AssessmentForExport>();

  // Get latest assessment for each category
  assessments.forEach(assessment => {
    const type = assessment.rapidAssessmentType;
    if (!latestAssessments.has(type) || 
        assessment.rapidAssessmentDate > latestAssessments.get(type)!.rapidAssessmentDate) {
      latestAssessments.set(type, assessment);
    }
  });

  // Analyze gaps in latest assessments
  latestAssessments.forEach((assessment, type) => {
    const categoryGaps = extractGaps(assessment);
    if (categoryGaps !== 'No significant gaps identified') {
      gaps.push({
        category: type,
        severity: 'high', // Simplified severity classification
        description: categoryGaps,
        recommendedActions: getRecommendedActions(type as AssessmentType, categoryGaps)
      });
    }
  });

  return gaps;
}

/**
 * Get recommended actions based on gap analysis
 */
function getRecommendedActions(type: AssessmentType, gaps: string): string[] {
  const actions: string[] = [];
  
  if (gaps.includes('clinic') || gaps.includes('medical')) {
    actions.push('Deploy medical personnel and supplies');
    actions.push('Establish temporary health facility');
  }
  
  if (gaps.includes('food')) {
    actions.push('Emergency food distribution');
    actions.push('Establish food supply chain');
  }
  
  if (gaps.includes('water') || gaps.includes('latrines')) {
    actions.push('Install water and sanitation facilities');
    actions.push('Provide hygiene kits');
  }
  
  if (gaps.includes('shelter')) {
    actions.push('Deploy emergency shelters');
    actions.push('Distribute shelter kits');
  }
  
  if (gaps.includes('security') || gaps.includes('safety')) {
    actions.push('Establish security presence');
    actions.push('Create protection mechanisms');
  }

  return actions.length > 0 ? actions : ['Address identified gaps through targeted interventions'];
}