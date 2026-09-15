/**
 * Dynamic Question Registry — catalog definition + seed-time validation.
 *
 * The catalog below is the single source of truth for the 55 seeded questions
 * (27 sections, 24 GAP / 31 CONTEXT) across the six rapid assessment types.
 * It is consumed by `prisma/seed-questions.ts` (idempotent seeding) and
 * validated by `validateRegistry()` at seed time and in unit tests.
 *
 * Extraction sources (see `_bmad-output/implementation-artifacts/dqr-p1-question-catalog.md`):
 * - Question order / labels / helper text / options: the six legacy form components
 *   (`src/components/forms/assessment/*AssessmentForm.tsx`).
 * - Required-ness: `src/lib/validation/rapid-assessment.ts` (optional/default fields => false).
 * - Severity defaults: the 24 `GapFieldSeverity` rows from `prisma/seed.ts`.
 * - Gap labels: plan §3 worked example (HEALTH) + `entities/[id]/assessments/latest`
 *   criticalGaps labels + authored rows per plan Appendix B.
 * - Recommendations: `src/lib/services/gap-analysis.service.ts` (legacy analyzers).
 */

export const ASSESSMENT_TYPES = ['HEALTH', 'FOOD', 'WASH', 'SHELTER', 'SECURITY', 'POPULATION'] as const
export type CatalogAssessmentType = (typeof ASSESSMENT_TYPES)[number]

export const QUESTION_TYPES = ['BOOLEAN', 'NUMBER', 'SINGLE_CHOICE', 'MULTI_SELECT', 'TEXT_LONG'] as const
export type CatalogQuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_CATEGORIES = ['GAP', 'CONTEXT'] as const
export type CatalogQuestionCategory = (typeof QUESTION_CATEGORIES)[number]

export type CatalogSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface QuestionOptionDef {
  value: string
  label: string
  description?: string
}

export interface QuestionDef {
  questionKey: string
  sectionKey: string
  questionType: CatalogQuestionType
  label: string
  helperText?: string
  required: boolean
  options?: QuestionOptionDef[]
  category: CatalogQuestionCategory
  inverted?: boolean
  gapLabel?: string
  gapMeaning?: string
  recommendation?: string
  severity?: CatalogSeverity
  numberMin?: number
  numberMax?: number
}

export interface QuestionSectionDef {
  sectionKey: string
  title: string
  description?: string
  category: CatalogQuestionCategory
  order: number
  questions: QuestionDef[]
}

export interface AssessmentTypeCatalog {
  assessmentType: CatalogAssessmentType
  sections: QuestionSectionDef[]
}

/** Deterministic registry ids: `{AssessmentType}:{key}`. */
export function deriveQuestionId(assessmentType: string, questionKey: string): string {
  return `${assessmentType}:${questionKey}`
}

export function deriveSectionId(assessmentType: string, sectionKey: string): string {
  return `${assessmentType}:${sectionKey}`
}

const HEALTH_FACILITY_TYPES: QuestionOptionDef[] = [
  { value: 'Hospital', label: 'Hospital' },
  { value: 'Primary Health Center', label: 'Primary Health Center' },
  { value: 'Clinic', label: 'Clinic' },
  { value: 'Dispensary', label: 'Dispensary' },
  { value: 'Mobile Clinic', label: 'Mobile Clinic' },
  { value: 'Community Health Post', label: 'Community Health Post' },
  { value: 'Other', label: 'Other' },
]

const HEALTH_ISSUES: QuestionOptionDef[] = [
  { value: 'Diarrhea', label: 'Diarrhea', description: 'Cases of acute watery diarrhea' },
  { value: 'Malaria', label: 'Malaria', description: 'Malaria cases and fever outbreaks' },
  { value: 'Respiratory', label: 'Respiratory Infections', description: 'Acute respiratory infections' },
  { value: 'Malnutrition', label: 'Malnutrition', description: 'Severe acute malnutrition cases' },
  { value: 'Other', label: 'Other', description: 'Other health concerns' },
]

const FOOD_SOURCES: QuestionOptionDef[] = [
  { value: 'Government kitchen', label: 'Government Kitchen', description: 'Government-supported food distribution' },
  { value: 'Humanitarian Partners', label: 'Humanitarian Partners', description: 'NGO and international aid organizations' },
  { value: 'Community', label: 'Community Support', description: 'Community-based food sharing initiatives' },
  { value: 'Individuals', label: 'Individual Resources', description: 'Personal food stocks and resources' },
  { value: 'Other', label: 'Other Sources', description: 'Other food sources not listed above' },
]

const WATER_SOURCES: QuestionOptionDef[] = [
  { value: 'Borehole', label: 'Borehole', description: 'Groundwater extraction through borehole' },
  { value: 'River/Stream', label: 'River/Stream', description: 'Surface water from rivers or streams' },
  { value: 'Water trucks', label: 'Water Trucks', description: 'Trucked water supply' },
  { value: 'Tap water', label: 'Tap Water', description: 'Piped water supply system' },
  { value: 'Sachet water', label: 'Sachet Water', description: 'Commercially packaged water' },
  { value: 'Other', label: 'Other', description: 'Other water sources' },
]

const SHELTER_TYPES: QuestionOptionDef[] = [
  { value: 'Trampoline', label: 'Trampoline/Tent', description: 'Emergency tents or temporary structures' },
  { value: 'Open space', label: 'Open Space', description: 'Designated open areas for temporary shelter' },
  { value: 'Local materials', label: 'Local Materials', description: 'Shelters built with locally available materials' },
  { value: 'Communal structure', label: 'Communal Structures', description: 'Public buildings used as shelters' },
  { value: 'Other', label: 'Other', description: 'Other types of shelter arrangements' },
]

export const QUESTION_CATALOG: AssessmentTypeCatalog[] = [
  {
    assessmentType: 'HEALTH',
    sections: [
      {
        sectionKey: 'facilities',
        title: 'Healthcare Facilities',
        description: 'Evaluate the availability and functionality of healthcare facilities',
        category: 'GAP',
        order: 1,
        questions: [
          {
            questionKey: 'hasFunctionalClinic',
            sectionKey: 'facilities',
            questionType: 'BOOLEAN',
            label: 'Functional Clinic',
            helperText: 'At least one functional healthcare facility exists',
            required: true,
            category: 'GAP',
            gapLabel: 'No functional clinic',
            gapMeaning: 'No functional healthcare facility exists in the assessed area',
            recommendation: 'Deploy mobile clinics or establish temporary health facilities',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'hasEmergencyServices',
            sectionKey: 'facilities',
            questionType: 'BOOLEAN',
            label: 'Emergency Services',
            helperText: 'Emergency medical services are available',
            required: true,
            category: 'GAP',
            gapLabel: 'No emergency services',
            gapMeaning: 'Emergency medical services are not available',
            recommendation: 'Establish emergency medical response team with proper equipment',
            severity: 'MEDIUM',
          },
        ],
      },
      {
        sectionKey: 'details',
        title: 'Facility Details',
        description: 'Provide details about healthcare facilities in the area',
        category: 'CONTEXT',
        order: 2,
        questions: [
          {
            questionKey: 'numberHealthFacilities',
            sectionKey: 'details',
            questionType: 'NUMBER',
            label: 'Number of Health Facilities',
            helperText: 'Total number of healthcare facilities in the area',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'qualifiedHealthWorkers',
            sectionKey: 'details',
            questionType: 'NUMBER',
            label: 'Qualified Health Workers',
            helperText: 'Number of qualified healthcare workers available',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'healthFacilityType',
            sectionKey: 'details',
            questionType: 'SINGLE_CHOICE',
            label: 'Primary Facility Type',
            helperText: 'Main type of healthcare facility available',
            required: true,
            options: HEALTH_FACILITY_TYPES,
            category: 'CONTEXT',
          },
        ],
      },
      {
        sectionKey: 'services',
        title: 'Services and Supplies',
        description: 'Assess available medical services and supplies',
        category: 'GAP',
        order: 3,
        questions: [
          {
            questionKey: 'hasTrainedStaff',
            sectionKey: 'services',
            questionType: 'BOOLEAN',
            label: 'Trained Staff',
            helperText: 'Sufficient trained medical staff available',
            required: true,
            category: 'GAP',
            gapLabel: 'Insufficient trained staff',
            gapMeaning: 'Trained medical staff are insufficient or absent',
            recommendation: 'Deploy trained medical personnel and provide emergency training',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'hasMedicineSupply',
            sectionKey: 'services',
            questionType: 'BOOLEAN',
            label: 'Medicine Supply',
            helperText: 'Essential medicines are available',
            required: true,
            category: 'GAP',
            gapLabel: 'Medicine shortage',
            gapMeaning: 'Essential medicines are not available or insufficient',
            recommendation: 'Procure and distribute essential medicines and medical supplies',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'hasMedicalSupplies',
            sectionKey: 'services',
            questionType: 'BOOLEAN',
            label: 'Medical Supplies',
            helperText: 'Medical equipment and supplies available',
            required: true,
            category: 'GAP',
            gapLabel: 'Medical supplies shortage',
            gapMeaning: 'Medical equipment and supplies are not available',
            recommendation: 'Secure medical equipment, diagnostic tools, and protective equipment',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'hasMaternalChildServices',
            sectionKey: 'services',
            questionType: 'BOOLEAN',
            label: 'Maternal & Child Services',
            helperText: 'Maternal and child health services available',
            required: true,
            category: 'GAP',
            gapLabel: 'No maternal/child services',
            gapMeaning: 'Maternal and child health services are unavailable',
            recommendation: 'Establish maternal and child health services with emergency obstetric care',
            severity: 'MEDIUM',
          },
        ],
      },
      {
        sectionKey: 'issues',
        title: 'Common Health Issues',
        description: 'Select the most common health issues observed',
        category: 'CONTEXT',
        order: 4,
        questions: [
          {
            questionKey: 'commonHealthIssues',
            sectionKey: 'issues',
            questionType: 'MULTI_SELECT',
            label: 'Common Health Issues',
            helperText: 'Select the most common health issues observed',
            required: false,
            options: HEALTH_ISSUES,
            category: 'CONTEXT',
          },
        ],
      },
      {
        sectionKey: 'additional',
        title: 'Additional Details',
        description: 'Any additional health-related information',
        category: 'CONTEXT',
        order: 5,
        questions: [
          {
            questionKey: 'additionalHealthDetails',
            sectionKey: 'additional',
            questionType: 'TEXT_LONG',
            label: 'Additional Details',
            helperText: 'Any additional health-related information',
            required: false,
            category: 'CONTEXT',
          },
        ],
      },
    ],
  },
  {
    assessmentType: 'FOOD',
    sections: [
      {
        sectionKey: 'availability',
        title: 'Food Availability & Access',
        description: 'Evaluate food availability and access patterns',
        category: 'GAP',
        order: 1,
        questions: [
          {
            questionKey: 'isFoodSufficient',
            sectionKey: 'availability',
            questionType: 'BOOLEAN',
            label: 'Food Sufficient',
            helperText: "Food supplies are sufficient to meet the population's needs",
            required: true,
            category: 'GAP',
            gapLabel: 'Insufficient food',
            gapMeaning: 'Food supplies are not sufficient to meet the population\u2019s needs',
            recommendation: 'Request emergency food assistance and establish food distribution points',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'hasRegularMealAccess',
            sectionKey: 'availability',
            questionType: 'BOOLEAN',
            label: 'Regular Meal Access',
            helperText: 'Population has regular access to meals (at least 2 per day)',
            required: true,
            category: 'GAP',
            gapLabel: 'No regular meal access',
            gapMeaning: 'Population does not have regular access to at least 2 meals per day',
            recommendation: 'Implement regular meal distribution programs and community kitchens',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'hasInfantNutrition',
            sectionKey: 'availability',
            questionType: 'BOOLEAN',
            label: 'Infant Nutrition Available',
            helperText: 'Adequate nutrition available for infants and young children',
            required: true,
            category: 'GAP',
            gapLabel: 'No infant nutrition',
            gapMeaning: 'Adequate nutrition for infants and young children is unavailable',
            recommendation: 'Distribute therapeutic feeding and infant nutrition supplements',
            severity: 'MEDIUM',
          },
        ],
      },
      {
        sectionKey: 'sources',
        title: 'Current Food Sources',
        description: 'Identify the main food sources for the affected population',
        category: 'CONTEXT',
        order: 2,
        questions: [
          {
            questionKey: 'foodSource',
            sectionKey: 'sources',
            questionType: 'MULTI_SELECT',
            label: 'Current Food Sources',
            helperText: 'Identify the main food sources for the affected population',
            required: false,
            options: FOOD_SOURCES,
            category: 'CONTEXT',
          },
        ],
      },
      {
        sectionKey: 'supply-details',
        title: 'Food Supply Details',
        description: 'Estimate food supply duration and additional requirements',
        category: 'CONTEXT',
        order: 3,
        questions: [
          {
            questionKey: 'availableFoodDurationDays',
            sectionKey: 'supply-details',
            questionType: 'NUMBER',
            label: 'Days of Food Available',
            helperText: 'How many days will current food supplies last',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'additionalFoodRequiredPersons',
            sectionKey: 'supply-details',
            questionType: 'NUMBER',
            label: 'Persons Needing Food',
            helperText: 'Number of additional people requiring food assistance',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'additionalFoodRequiredHouseholds',
            sectionKey: 'supply-details',
            questionType: 'NUMBER',
            label: 'Households Needing Food',
            helperText: 'Number of households requiring food assistance',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
        ],
      },
      {
        sectionKey: 'additional',
        title: 'Additional Details',
        description: 'Any additional food security information',
        category: 'CONTEXT',
        order: 4,
        questions: [
          {
            questionKey: 'additionalFoodDetails',
            sectionKey: 'additional',
            questionType: 'TEXT_LONG',
            label: 'Additional Details',
            helperText: 'Any additional food security information',
            required: false,
            category: 'CONTEXT',
          },
        ],
      },
    ],
  },
  {
    assessmentType: 'WASH',
    sections: [
      {
        sectionKey: 'water-access',
        title: 'Water Access and Availability',
        description: 'Evaluate water access and sufficiency',
        category: 'GAP',
        order: 1,
        questions: [
          {
            questionKey: 'isWaterSufficient',
            sectionKey: 'water-access',
            questionType: 'BOOLEAN',
            label: 'Water Sufficient',
            helperText: 'Water quantity is sufficient for basic needs',
            required: true,
            category: 'GAP',
            gapLabel: 'Insufficient water',
            gapMeaning: 'Water quantity is not sufficient for basic needs',
            recommendation: 'Deploy water trucking services and install water purification systems',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'hasCleanWaterAccess',
            sectionKey: 'water-access',
            questionType: 'BOOLEAN',
            label: 'Clean Water Access',
            helperText: 'Population has access to safe drinking water',
            required: true,
            category: 'GAP',
            gapLabel: 'No clean water access',
            gapMeaning: 'Population does not have access to safe drinking water',
            recommendation: 'Establish water treatment points and ensure water quality testing',
            severity: 'MEDIUM',
          },
        ],
      },
      {
        sectionKey: 'sanitation',
        title: 'Sanitation Assessment',
        description: 'Assess sanitation and hygiene gaps',
        category: 'GAP',
        order: 2,
        questions: [
          {
            questionKey: 'areLatrinesSufficient',
            sectionKey: 'sanitation',
            questionType: 'BOOLEAN',
            label: 'Latrines Sufficient',
            helperText: 'Number of latrines is sufficient for population',
            required: true,
            category: 'GAP',
            gapLabel: 'Insufficient latrines',
            gapMeaning: 'Latrine coverage is insufficient for the population',
            recommendation: 'Construct emergency sanitation facilities and improve existing latrines',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'hasHandwashingFacilities',
            sectionKey: 'sanitation',
            questionType: 'BOOLEAN',
            label: 'Handwashing Facilities Available',
            helperText: 'Handwashing facilities with soap/water are available',
            required: true,
            category: 'GAP',
            gapLabel: 'No handwashing facilities',
            gapMeaning: 'Handwashing facilities with soap and water are not available',
            recommendation: 'Distribute soap and hand sanitizer, establish handwashing stations',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'hasOpenDefecationConcerns',
            sectionKey: 'sanitation',
            questionType: 'BOOLEAN',
            label: 'Open Defecation Concerns',
            helperText: 'Open defecation practices observed (disease transmission risk)',
            required: true,
            category: 'GAP',
            inverted: true,
            gapLabel: 'Open defecation concerns',
            gapMeaning: 'Open defecation practices are observed, indicating disease transmission risk',
            recommendation: 'Implement safe defecation campaigns and monitor sanitation practices',
            severity: 'MEDIUM',
          },
        ],
      },
      {
        sectionKey: 'water-sources',
        title: 'Water Sources',
        description: 'Identify available water sources for the affected population',
        category: 'CONTEXT',
        order: 3,
        questions: [
          {
            questionKey: 'waterSource',
            sectionKey: 'water-sources',
            questionType: 'MULTI_SELECT',
            label: 'Water Sources',
            helperText: 'Identify available water sources for the affected population',
            required: false,
            options: WATER_SOURCES,
            category: 'CONTEXT',
          },
        ],
      },
      {
        sectionKey: 'sanitation-facilities',
        title: 'Sanitation Facilities',
        description: 'Record functional latrine infrastructure',
        category: 'CONTEXT',
        order: 4,
        questions: [
          {
            questionKey: 'functionalLatrinesAvailable',
            sectionKey: 'sanitation-facilities',
            questionType: 'NUMBER',
            label: 'Functional Latrines',
            helperText: 'Record functional latrine infrastructure',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
        ],
      },
      {
        sectionKey: 'additional',
        title: 'Additional Details',
        description: 'Any additional WASH-related information',
        category: 'CONTEXT',
        order: 5,
        questions: [
          {
            questionKey: 'additionalWashDetails',
            sectionKey: 'additional',
            questionType: 'TEXT_LONG',
            label: 'Additional Details',
            helperText: 'Any additional WASH-related information',
            required: false,
            category: 'CONTEXT',
          },
        ],
      },
    ],
  },
  {
    assessmentType: 'SHELTER',
    sections: [
      {
        sectionKey: 'availability',
        title: 'Shelter Availability & Safety',
        description: 'Evaluate current shelter conditions and safety',
        category: 'GAP',
        order: 1,
        questions: [
          {
            questionKey: 'areSheltersSufficient',
            sectionKey: 'availability',
            questionType: 'BOOLEAN',
            label: 'Shelters Sufficient',
            helperText: 'Available shelters are sufficient for the affected population',
            required: true,
            category: 'GAP',
            gapLabel: 'Insufficient shelters',
            gapMeaning: 'Available shelters are not sufficient for the affected population',
            recommendation: 'Deploy emergency shelter kits and establish temporary housing',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'hasSafeStructures',
            sectionKey: 'availability',
            questionType: 'BOOLEAN',
            label: 'Safe Structures',
            helperText: 'Existing shelters are structurally safe and secure',
            required: true,
            category: 'GAP',
            gapLabel: 'No safe structures',
            gapMeaning: 'Existing shelters are not structurally safe and secure',
            recommendation: 'Identify and retrofit safe buildings for emergency shelter use',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'provideWeatherProtection',
            sectionKey: 'availability',
            questionType: 'BOOLEAN',
            label: 'Weather Protection',
            helperText: 'Shelters provide adequate protection from weather elements',
            required: true,
            category: 'GAP',
            gapLabel: 'No weather protection',
            gapMeaning: 'Shelters do not provide adequate protection from weather elements',
            recommendation: 'Provide weatherproofing materials and improve shelter insulation',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'areOvercrowded',
            sectionKey: 'availability',
            questionType: 'BOOLEAN',
            label: 'Overcrowding Issues',
            helperText: 'Shelters are overcrowded beyond safe capacity',
            required: true,
            category: 'GAP',
            inverted: true,
            gapLabel: 'Overcrowded shelters',
            gapMeaning: 'Shelters are overcrowded beyond safe capacity',
            recommendation: 'Decongest existing shelters and establish additional shelter sites',
            severity: 'MEDIUM',
          },
        ],
      },
      {
        sectionKey: 'current-types',
        title: 'Current Shelter Types',
        description: 'Select the types of shelters currently available',
        category: 'CONTEXT',
        order: 2,
        questions: [
          {
            questionKey: 'shelterTypes',
            sectionKey: 'current-types',
            questionType: 'MULTI_SELECT',
            label: 'Current Shelter Types',
            helperText: 'Select the types of shelters currently available',
            required: false,
            options: SHELTER_TYPES,
            category: 'CONTEXT',
          },
        ],
      },
      {
        sectionKey: 'requirements',
        title: 'Additional Shelter Requirements',
        description: 'Select the types of shelters urgently needed',
        category: 'CONTEXT',
        order: 3,
        questions: [
          {
            questionKey: 'requiredShelterType',
            sectionKey: 'requirements',
            questionType: 'MULTI_SELECT',
            label: 'Additional Shelter Requirements',
            helperText: 'Select the types of shelters urgently needed',
            required: false,
            options: SHELTER_TYPES,
            category: 'CONTEXT',
          },
          {
            questionKey: 'numberSheltersRequired',
            sectionKey: 'requirements',
            questionType: 'NUMBER',
            label: 'Number of Shelters Required',
            helperText: 'Estimated number of additional shelters needed',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
        ],
      },
      {
        sectionKey: 'additional',
        title: 'Additional Details',
        description: 'Any additional shelter-related information',
        category: 'CONTEXT',
        order: 4,
        questions: [
          {
            questionKey: 'additionalShelterDetails',
            sectionKey: 'additional',
            questionType: 'TEXT_LONG',
            label: 'Additional Details',
            helperText: 'Any additional shelter-related information',
            required: false,
            category: 'CONTEXT',
          },
        ],
      },
    ],
  },
  {
    assessmentType: 'SECURITY',
    sections: [
      {
        sectionKey: 'violence-safety',
        title: 'Violence & Safety Assessment',
        description: 'Evaluate violence risks and general safety conditions',
        category: 'GAP',
        order: 1,
        questions: [
          {
            questionKey: 'isSafeFromViolence',
            sectionKey: 'violence-safety',
            questionType: 'BOOLEAN',
            label: 'Safe from Violence',
            helperText: 'Population is safe from violence and armed conflict',
            required: true,
            category: 'GAP',
            gapLabel: 'Safety concerns',
            gapMeaning: 'Population is not safe from violence and armed conflict',
            recommendation: 'Establish security patrols and safe zones for vulnerable populations',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'gbvCasesReported',
            sectionKey: 'violence-safety',
            questionType: 'BOOLEAN',
            label: 'GBV Cases Reported',
            helperText: 'Cases of gender-based violence have been reported',
            required: true,
            category: 'GAP',
            inverted: true,
            gapLabel: 'GBV cases reported',
            gapMeaning: 'Cases of gender-based violence have been reported',
            recommendation: 'Deploy specialized GBV response teams and establish safe reporting mechanisms',
            severity: 'MEDIUM',
          },
        ],
      },
      {
        sectionKey: 'security-services',
        title: 'Security & Protection Services',
        description: 'Assess available security and protection services',
        category: 'GAP',
        order: 2,
        questions: [
          {
            questionKey: 'hasSecurityPresence',
            sectionKey: 'security-services',
            questionType: 'BOOLEAN',
            label: 'Security Presence',
            helperText: 'Security personnel or forces are present in the area',
            required: true,
            category: 'GAP',
            gapLabel: 'No security presence',
            gapMeaning: 'Security personnel or forces are not present in the area',
            recommendation: 'Request security personnel deployment and establish local security committees',
            severity: 'MEDIUM',
          },
          {
            questionKey: 'hasProtectionReportingMechanism',
            sectionKey: 'security-services',
            questionType: 'BOOLEAN',
            label: 'Protection Reporting Mechanism',
            helperText: 'Mechanisms exist for reporting protection concerns',
            required: true,
            category: 'GAP',
            gapLabel: 'No protection reporting mechanism',
            gapMeaning: 'Mechanisms for reporting protection concerns do not exist',
            recommendation: 'Establish confidential protection reporting channels and community alert systems',
            severity: 'MEDIUM',
          },
        ],
      },
      {
        sectionKey: 'vulnerable-groups',
        title: 'Vulnerable Groups Protection',
        description: 'Assess protection access for vulnerable populations',
        category: 'GAP',
        order: 3,
        questions: [
          {
            questionKey: 'vulnerableGroupsHaveAccess',
            sectionKey: 'vulnerable-groups',
            questionType: 'BOOLEAN',
            label: 'Vulnerable Groups Have Access',
            helperText: 'Vulnerable groups have access to protection services',
            required: true,
            category: 'GAP',
            gapLabel: 'Vulnerable groups lack access',
            gapMeaning: 'Vulnerable groups do not have access to protection services',
            recommendation: 'Ensure priority access to services for women, children, elderly, and persons with disabilities',
            severity: 'MEDIUM',
          },
        ],
      },
      {
        sectionKey: 'environmental-safety',
        title: 'Environmental Safety',
        description: 'Assess environmental safety conditions',
        category: 'GAP',
        order: 4,
        questions: [
          {
            questionKey: 'hasLighting',
            sectionKey: 'environmental-safety',
            questionType: 'BOOLEAN',
            label: 'Adequate Lighting',
            helperText: 'Sufficient lighting available for safety and security',
            required: true,
            category: 'GAP',
            gapLabel: 'No adequate lighting',
            gapMeaning: 'Insufficient lighting is available for safety and security',
            recommendation: 'Install lighting systems in high-risk areas and communal spaces',
            severity: 'MEDIUM',
          },
        ],
      },
      {
        sectionKey: 'additional',
        title: 'Additional Details',
        description: 'Any additional security or protection-related information',
        category: 'CONTEXT',
        order: 5,
        questions: [
          {
            questionKey: 'additionalSecurityDetails',
            sectionKey: 'additional',
            questionType: 'TEXT_LONG',
            label: 'Additional Details',
            helperText: 'Any additional security or protection-related information',
            required: false,
            category: 'CONTEXT',
          },
        ],
      },
    ],
  },
  {
    assessmentType: 'POPULATION',
    sections: [
      {
        sectionKey: 'basic',
        title: 'Basic Population Data',
        description: 'Total population and households',
        category: 'CONTEXT',
        order: 1,
        questions: [
          {
            questionKey: 'totalHouseholds',
            sectionKey: 'basic',
            questionType: 'NUMBER',
            label: 'Total Households',
            helperText: 'Number of households in the affected area',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'totalPopulation',
            sectionKey: 'basic',
            questionType: 'NUMBER',
            label: 'Total Population',
            helperText: 'Total number of people affected',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'populationMale',
            sectionKey: 'basic',
            questionType: 'NUMBER',
            label: 'Male Population',
            helperText: 'Number of males in the affected population',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'populationFemale',
            sectionKey: 'basic',
            questionType: 'NUMBER',
            label: 'Female Population',
            helperText: 'Number of females in the affected population',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
        ],
      },
      {
        sectionKey: 'vulnerable',
        title: 'Vulnerable Groups',
        description: 'Identify and count vulnerable population groups requiring special attention',
        category: 'CONTEXT',
        order: 2,
        questions: [
          {
            questionKey: 'populationUnder5',
            sectionKey: 'vulnerable',
            questionType: 'NUMBER',
            label: 'Children Under 5',
            helperText: 'Children under 5 years old',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'pregnantWomen',
            sectionKey: 'vulnerable',
            questionType: 'NUMBER',
            label: 'Pregnant Women',
            helperText: 'Pregnant women requiring care',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'lactatingMothers',
            sectionKey: 'vulnerable',
            questionType: 'NUMBER',
            label: 'Lactating Mothers',
            helperText: 'Lactating mothers with infants',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'personWithDisability',
            sectionKey: 'vulnerable',
            questionType: 'NUMBER',
            label: 'Persons with Disabilities',
            helperText: 'People with disabilities',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'elderlyPersons',
            sectionKey: 'vulnerable',
            questionType: 'NUMBER',
            label: 'Elderly Persons (60+)',
            helperText: 'Elderly persons over 60 years',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'separatedChildren',
            sectionKey: 'vulnerable',
            questionType: 'NUMBER',
            label: 'Separated Children',
            helperText: 'Unaccompanied or separated children',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
        ],
      },
      {
        sectionKey: 'casualties',
        title: 'Casualties and Injuries',
        description: 'Document the human impact of the disaster',
        category: 'CONTEXT',
        order: 3,
        questions: [
          {
            questionKey: 'numberLivesLost',
            sectionKey: 'casualties',
            questionType: 'NUMBER',
            label: 'Lives Lost',
            helperText: 'Number of confirmed deaths',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
          {
            questionKey: 'numberInjured',
            sectionKey: 'casualties',
            questionType: 'NUMBER',
            label: 'Injured Persons',
            helperText: 'Number of injured persons requiring medical attention',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
          },
        ],
      },
      {
        sectionKey: 'additional',
        title: 'Additional Details',
        description: 'Any additional population-related information',
        category: 'CONTEXT',
        order: 4,
        questions: [
          {
            questionKey: 'additionalPopulationDetails',
            sectionKey: 'additional',
            questionType: 'TEXT_LONG',
            label: 'Additional Details',
            helperText: 'Any additional population-related information',
            required: false,
            category: 'CONTEXT',
          },
        ],
      },
    ],
  },
]

export interface RegistryValidationResult {
  valid: boolean
  errors: string[]
  counts: {
    assessmentTypes: number
    sections: number
    questions: number
    gapQuestions: number
    contextQuestions: number
  }
}

/**
 * Validates the question catalog invariants:
 * - non-empty catalog; unique section/question keys per assessment type
 * - contiguous 1..n ordering of sections per type (question order is its array position)
 * - every question's category matches its enclosing section's category
 * - option lists: unique non-empty values, non-empty labels; only on choice questions
 * - GAP questions: BOOLEAN, required, severity + gapLabel + gapMeaning + recommendation set,
 *   `inverted` only on GAP questions
 * - CONTEXT questions: no gap metadata, severity LOW (unset)
 */
export function validateRegistry(catalog: AssessmentTypeCatalog[] = QUESTION_CATALOG): RegistryValidationResult {
  const errors: string[] = []
  let sections = 0
  let questions = 0
  let gapQuestions = 0
  let contextQuestions = 0

  if (catalog.length === 0) {
    errors.push('Catalog is empty')
  }

  const seenTypes = new Set<string>()
  for (const typeCatalog of catalog) {
    const { assessmentType } = typeCatalog
    if (seenTypes.has(assessmentType)) {
      errors.push(`Duplicate assessment type in catalog: ${assessmentType}`)
    }
    seenTypes.add(assessmentType)

    if (!ASSESSMENT_TYPES.includes(assessmentType as CatalogAssessmentType)) {
      errors.push(`Unknown assessment type: ${assessmentType}`)
    }
    if (typeCatalog.sections.length === 0) {
      errors.push(`${assessmentType}: no sections defined`)
      continue
    }

    const seenSections = new Set<string>()
    let typeGapQuestions = 0
    typeCatalog.sections.forEach((section, sectionIndex) => {
      if (section.order !== sectionIndex + 1) {
        errors.push(
          `${assessmentType}/${section.sectionKey}: section order ${section.order} is not contiguous (expected ${sectionIndex + 1})`
        )
      }
      if (seenSections.has(section.sectionKey)) {
        errors.push(`${assessmentType}: duplicate section key ${section.sectionKey}`)
      }
      seenSections.add(section.sectionKey)
      if (!section.title.trim()) {
        errors.push(`${assessmentType}/${section.sectionKey}: empty section title`)
      }
      sections += 1

      if (section.questions.length === 0) {
        errors.push(`${assessmentType}/${section.sectionKey}: no questions defined`)
        return
      }

      const seenQuestions = new Set<string>()
      section.questions.forEach((question) => {
        const qRef = `${assessmentType}/${question.questionKey}`
        if (seenQuestions.has(question.questionKey)) {
          errors.push(`${assessmentType}: duplicate question key ${question.questionKey}`)
        }
        seenQuestions.add(question.questionKey)

        if (question.sectionKey !== section.sectionKey) {
          errors.push(`${qRef}: sectionKey ${question.sectionKey} does not match enclosing section ${section.sectionKey}`)
        }

        if (question.category !== section.category) {
          errors.push(
            `${qRef}: category ${question.category} does not match section ${section.sectionKey} category ${section.category}`
          )
        }

        if (!question.label.trim()) {
          errors.push(`${qRef}: empty label`)
        }

        const isChoice = question.questionType === 'SINGLE_CHOICE' || question.questionType === 'MULTI_SELECT'
        if (isChoice) {
          if (!question.options || question.options.length === 0) {
            errors.push(`${qRef}: ${question.questionType} requires at least one option`)
          } else {
            const values = new Set<string>()
            for (const option of question.options) {
              if (!option.value || !option.value.trim()) {
                errors.push(`${qRef}: option with empty value`)
              }
              if (values.has(option.value)) {
                errors.push(`${qRef}: duplicate option value "${option.value}"`)
              }
              values.add(option.value)
              if (!option.label || !option.label.trim()) {
                errors.push(`${qRef}: option "${option.value}" has empty label`)
              }
            }
          }
        } else if (question.options && question.options.length > 0) {
          errors.push(`${qRef}: options are only allowed on SINGLE_CHOICE/MULTI_SELECT questions`)
        }

        if (question.category === 'GAP') {
          gapQuestions += 1
          typeGapQuestions += 1
          if (question.questionType !== 'BOOLEAN') {
            errors.push(`${qRef}: GAP questions must be BOOLEAN`)
          }
          if (!question.required) {
            errors.push(`${qRef}: GAP questions must be required`)
          }
          if (!question.severity || !['CRITICAL', 'HIGH', 'MEDIUM'].includes(question.severity)) {
            errors.push(`${qRef}: GAP questions must set severity to CRITICAL, HIGH, or MEDIUM`)
          }
          if (!question.gapLabel?.trim()) {
            errors.push(`${qRef}: GAP questions require gapLabel`)
          }
          if (!question.gapMeaning?.trim()) {
            errors.push(`${qRef}: GAP questions require gapMeaning`)
          }
          if (!question.recommendation?.trim()) {
            errors.push(`${qRef}: GAP questions require recommendation`)
          }
        } else {
          contextQuestions += 1
          if (question.gapLabel || question.gapMeaning || question.recommendation) {
            errors.push(`${qRef}: CONTEXT questions must not define gap metadata`)
          }
          if (question.severity && question.severity !== 'LOW') {
            errors.push(`${qRef}: CONTEXT questions must use severity LOW`)
          }
          if (question.inverted) {
            errors.push(`${qRef}: inverted is only allowed on GAP questions`)
          }
        }

        if (question.questionType === 'NUMBER' && question.numberMin === undefined) {
          errors.push(`${qRef}: NUMBER questions require numberMin`)
        }
        if (question.questionType !== 'NUMBER' && (question.numberMin !== undefined || question.numberMax !== undefined)) {
          errors.push(`${qRef}: numberMin/numberMax are only allowed on NUMBER questions`)
        }

        questions += 1
      })
    })

    if (assessmentType !== 'POPULATION' && typeGapQuestions === 0) {
      errors.push(
        `${assessmentType}: must have at least one active GAP question (only POPULATION is context-only)`
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    counts: {
      assessmentTypes: catalog.length,
      sections,
      questions,
      gapQuestions,
      contextQuestions,
    },
  }
}

/** Expected catalog totals (guarded in tests and at seed time). */
export const EXPECTED_CATALOG_COUNTS = {
  assessmentTypes: 6,
  sections: 27,
  questions: 55,
  gapQuestions: 24,
  contextQuestions: 31,
} as const
