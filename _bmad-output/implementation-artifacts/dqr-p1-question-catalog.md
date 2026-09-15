# DQR P1 — Exact Question Catalog (55 questions)

Artifact: `_bmad-output/implementation-artifacts/dqr-p1-question-catalog.md`
Derived from: `docs/plans/dynamic-question-registry-plan.md` (§3 worked example, Appendix B registers), the six legacy form components (`src/components/forms/assessment/*AssessmentForm.tsx`), server validation (`src/lib/validation/rapid-assessment.ts`), `prisma/seed.ts` (severity defaults), `src/app/api/v1/entities/[id]/assessments/latest/route.ts` (criticalGaps labels), and `src/lib/services/gap-analysis.service.ts` (recommendations).

Totals: **55 questions / 27 sections / 24 GAP questions / 31 CONTEXT questions.**

- `questionKey` = legacy camelCase field name; `id` = `{AssessmentType}:{questionKey}`.
- Section `id` = `{AssessmentType}:{sectionKey}`.
- `order` is per-type contiguous 1..n following the real card order in each legacy form (HEALTH interleaves GAP/CONTEXT — preserved, not forced gap-first).
- `required` derives from server validation (`src/lib/validation/rapid-assessment.ts`): fields with `.optional()` or `.default()` are false; all others true. GAP questions are always required (`true`).
- `severity` = MEDIUM for all 24 GAP questions (P1 seed policy per spec; GapFieldSeverity table dropped).
- Gap labels: HEALTH per plan §3; FOOD/WASH/SHELTER/SECURITY labels covered by `entities/[id]/assessments/latest/route.ts` criticalGaps; remainder authored per plan Appendix B register (marked [A]).
- `numberMin` = 0 for all NUMBER questions.

## Sections

| AssessmentType | sectionKey | order | title | description | category |
|---|---|---|---|---|---|
| HEALTH | facilities | 1 | Healthcare Facilities | Evaluate the availability and functionality of healthcare facilities | GAP |
| HEALTH | details | 2 | Facility Details | Provide details about healthcare facilities in the area | CONTEXT |
| HEALTH | services | 3 | Services and Supplies | Assess available medical services and supplies | GAP |
| HEALTH | issues | 4 | Common Health Issues | Select the most common health issues observed | CONTEXT |
| HEALTH | additional | 5 | Additional Details | Any additional health-related information | CONTEXT |
| FOOD | availability | 1 | Food Availability & Access | Evaluate food availability and access patterns | GAP |
| FOOD | sources | 2 | Current Food Sources | Identify the main food sources for the affected population | CONTEXT |
| FOOD | supply-details | 3 | Food Supply Details | Estimate food supply duration and additional requirements | CONTEXT |
| FOOD | additional | 4 | Additional Details | Any additional food security information | CONTEXT |
| WASH | water-access | 1 | Water Access and Availability | Evaluate water access and sufficiency | GAP |
| WASH | sanitation | 2 | Sanitation Assessment | Assess sanitation and hygiene gaps | GAP |
| WASH | water-sources | 3 | Water Sources | Identify available water sources for the affected population | CONTEXT |
| WASH | sanitation-facilities | 4 | Sanitation Facilities | Record functional latrine infrastructure | CONTEXT |
| WASH | additional | 5 | Additional Details | Any additional WASH-related information | CONTEXT |
| SHELTER | availability | 1 | Shelter Availability & Safety | Evaluate current shelter conditions and safety | GAP |
| SHELTER | current-types | 2 | Current Shelter Types | Select the types of shelters currently available | CONTEXT |
| SHELTER | requirements | 3 | Additional Shelter Requirements | Select the types of shelters urgently needed | CONTEXT |
| SHELTER | additional | 4 | Additional Details | Any additional shelter-related information | CONTEXT |
| SECURITY | violence-safety | 1 | Violence & Safety Assessment | Evaluate violence risks and general safety conditions | GAP |
| SECURITY | security-services | 2 | Security & Protection Services | Assess available security and protection services | GAP |
| SECURITY | vulnerable-groups | 3 | Vulnerable Groups Protection | Assess protection access for vulnerable populations | GAP |
| SECURITY | environmental-safety | 4 | Environmental Safety | Assess environmental safety conditions | GAP |
| SECURITY | additional | 5 | Additional Details | Any additional security or protection-related information | CONTEXT |
| POPULATION | basic | 1 | Basic Population Data | Total population and households | CONTEXT |
| POPULATION | vulnerable | 2 | Vulnerable Groups | Identify and count vulnerable population groups requiring special attention | CONTEXT |
| POPULATION | casualties | 3 | Casualties and Injuries | Document the human impact of the disaster | CONTEXT |
| POPULATION | additional | 4 | Additional Details | Any additional population-related information | CONTEXT |

## HEALTH (11 questions — 6 GAP, 5 CONTEXT)

| # | questionKey | section | type | label | helperText | required | options | category | inverted | gapLabel | gapMeaning | recommendation | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | hasFunctionalClinic | facilities | BOOLEAN | Functional Clinic | At least one functional healthcare facility exists | true | — | GAP | false | No functional clinic | No functional healthcare facility exists in the assessed area | Deploy mobile clinics or establish temporary health facilities | MEDIUM |
| 2 | hasEmergencyServices | facilities | BOOLEAN | Emergency Services | Emergency medical services are available | true | — | GAP | false | No emergency services | Emergency medical services are not available | Establish emergency medical response team with proper equipment | MEDIUM |
| 3 | numberHealthFacilities | details | NUMBER | Number of Health Facilities | Total number of healthcare facilities in the area | true | — | CONTEXT | false | — | — | — | LOW |
| 4 | qualifiedHealthWorkers | details | NUMBER | Qualified Health Workers | Number of qualified healthcare workers available | true | — | CONTEXT | false | — | — | — | LOW |
| 5 | healthFacilityType | details | SINGLE_CHOICE | Primary Facility Type | Main type of healthcare facility available | true | Hospital; Primary Health Center; Clinic; Dispensary; Mobile Clinic; Community Health Post; Other | CONTEXT | false | — | — | — | LOW |
| 6 | hasTrainedStaff | services | BOOLEAN | Trained Staff | Sufficient trained medical staff available | true | — | GAP | false | Insufficient trained staff | Trained medical staff are insufficient or absent | Deploy trained medical personnel and provide emergency training | MEDIUM |
| 7 | hasMedicineSupply | services | BOOLEAN | Medicine Supply | Essential medicines are available | true | — | GAP | false | Medicine shortage | Essential medicines are not available or insufficient | Procure and distribute essential medicines and medical supplies | MEDIUM |
| 8 | hasMedicalSupplies | services | BOOLEAN | Medical Supplies | Medical equipment and supplies available | true | — | GAP | false | Medical supplies shortage | Medical equipment and supplies are not available | Secure medical equipment, diagnostic tools, and protective equipment | MEDIUM |
| 9 | hasMaternalChildServices | services | BOOLEAN | Maternal & Child Services | Maternal and child health services available | true | — | GAP | false | No maternal/child services | Maternal and child health services are unavailable | Establish maternal and child health services with emergency obstetric care | MEDIUM |
| 10 | commonHealthIssues | issues | MULTI_SELECT | Common Health Issues | Select the most common health issues observed | false | Diarrhea; Malaria; Respiratory=Respiratory Infections; Malnutrition; Other | CONTEXT | false | — | — | — | LOW |
| 11 | additionalHealthDetails | additional | TEXT_LONG | Additional Details | Any additional health-related information | false | — | CONTEXT | false | — | — | — | LOW |

Options for `healthFacilityType` (value=label): Hospital; Primary Health Center; Clinic; Dispensary; Mobile Clinic; Community Health Post; Other.
Options for `commonHealthIssues` (value; label; description): Diarrhea; Malaria; Respiratory (label "Respiratory Infections", "Acute respiratory infections"); Malnutrition ("Severe acute malnutrition cases"); Other ("Other health concerns").

## FOOD (8 questions — 3 GAP, 5 CONTEXT)

| # | questionKey | section | type | label | helperText | required | options | category | inverted | gapLabel | gapMeaning | recommendation | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | isFoodSufficient | availability | BOOLEAN | Food Sufficient | Food supplies are sufficient to meet the population's needs | true | — | GAP | false | Insufficient food | Food supplies are not sufficient to meet the population's needs | Request emergency food assistance and establish food distribution points | MEDIUM |
| 2 | hasRegularMealAccess | availability | BOOLEAN | Regular Meal Access | Population has regular access to meals (at least 2 per day) | true | — | GAP | false | No regular meal access | Population does not have regular access to at least 2 meals per day | Implement regular meal distribution programs and community kitchens | MEDIUM |
| 3 | hasInfantNutrition | availability | BOOLEAN | Infant Nutrition Available | Adequate nutrition available for infants and young children | true | — | GAP | false | No infant nutrition [A] | Adequate nutrition for infants and young children is unavailable [A] | Distribute therapeutic feeding and infant nutrition supplements | MEDIUM |
| 4 | foodSource | sources | MULTI_SELECT | Current Food Sources | Identify the main food sources for the affected population | false | Government kitchen; Humanitarian Partners; Community; Individuals; Other | CONTEXT | false | — | — | — | LOW |
| 5 | availableFoodDurationDays | supply-details | NUMBER | Days of Food Available | How many days will current food supplies last | true | — | CONTEXT | false | — | — | — | LOW |
| 6 | additionalFoodRequiredPersons | supply-details | NUMBER | Persons Needing Food | Number of additional people requiring food assistance | true | — | CONTEXT | false | — | — | — | LOW |
| 7 | additionalFoodRequiredHouseholds | supply-details | NUMBER | Households Needing Food | Number of households requiring food assistance | true | — | CONTEXT | false | — | — | — | LOW |
| 8 | additionalFoodDetails | additional | TEXT_LONG | Additional Details | Any additional food security information | false | — | CONTEXT | false | — | — | — | LOW |

Options for `foodSource` (value; label; description): Government kitchen ("Government Kitchen", "Government-supported food distribution"); Humanitarian Partners ("Humanitarian Partners", "NGO and international aid organizations"); Community ("Community Support", "Community-based food sharing initiatives"); Individuals ("Individual Resources", "Personal food stocks and resources"); Other ("Other Sources", "Other food sources not listed above").

## WASH (8 questions — 5 GAP, 3 CONTEXT)

| # | questionKey | section | type | label | helperText | required | options | category | inverted | gapLabel | gapMeaning | recommendation | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | isWaterSufficient | water-access | BOOLEAN | Water Sufficient | Water quantity is sufficient for basic needs | true | — | GAP | false | Insufficient water | Water quantity is not sufficient for basic needs | Deploy water trucking services and install water purification systems | MEDIUM |
| 2 | hasCleanWaterAccess | water-access | BOOLEAN | Clean Water Access | Population has access to safe drinking water | true | — | GAP | false | No clean water access | Population does not have access to safe drinking water | Establish water treatment points and ensure water quality testing | MEDIUM |
| 3 | areLatrinesSufficient | sanitation | BOOLEAN | Latrines Sufficient | Number of latrines is sufficient for population | true | — | GAP | false | Insufficient latrines [A] | Latrine coverage is insufficient for the population [A] | Construct emergency sanitation facilities and improve existing latrines | MEDIUM |
| 4 | hasHandwashingFacilities | sanitation | BOOLEAN | Handwashing Facilities Available | Handwashing facilities with soap/water are available | true | — | GAP | false | No handwashing facilities | Handwashing facilities with soap and water are not available | Distribute soap and hand sanitizer, establish handwashing stations | MEDIUM |
| 5 | hasOpenDefecationConcerns | sanitation | BOOLEAN | Open Defecation Concerns | Open defecation practices observed (disease transmission risk) | true | — | GAP | true | Open defecation concerns [A] | Open defecation practices are observed, indicating disease transmission risk [A] | Implement safe defecation campaigns and monitor sanitation practices | MEDIUM |
| 6 | waterSource | water-sources | MULTI_SELECT | Water Sources | Identify available water sources for the affected population | false | Borehole; River/Stream; Water trucks; Tap water; Sachet water; Other | CONTEXT | false | — | — | — | LOW |
| 7 | functionalLatrinesAvailable | sanitation-facilities | NUMBER | Functional Latrines | Record functional latrine infrastructure | true | — | CONTEXT | false | — | — | — | LOW |
| 8 | additionalWashDetails | additional | TEXT_LONG | Additional Details | Any additional WASH-related information | false | — | CONTEXT | false | — | — | — | LOW |

Options for `waterSource` (value; label; description): Borehole ("Groundwater extraction through borehole"); River/Stream ("Surface water from rivers or streams"); Water trucks (label "Water Trucks", "Trucked water supply"); Tap water (label "Tap Water", "Piped water supply system"); Sachet water (label "Sachet Water", "Commercially packaged water"); Other ("Other water sources").

## SHELTER (8 questions — 4 GAP, 4 CONTEXT)

| # | questionKey | section | type | label | helperText | required | options | category | inverted | gapLabel | gapMeaning | recommendation | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | areSheltersSufficient | availability | BOOLEAN | Shelters Sufficient | Available shelters are sufficient for the affected population | true | — | GAP | false | Insufficient shelters | Available shelters are not sufficient for the affected population | Deploy emergency shelter kits and establish temporary housing | MEDIUM |
| 2 | hasSafeStructures | availability | BOOLEAN | Safe Structures | Existing shelters are structurally safe and secure | true | — | GAP | false | No safe structures | Existing shelters are not structurally safe and secure | Identify and retrofit safe buildings for emergency shelter use | MEDIUM |
| 3 | provideWeatherProtection | availability | BOOLEAN | Weather Protection | Shelters provide adequate protection from weather elements | true | — | GAP | false | No weather protection [A] | Shelters do not provide adequate protection from weather elements [A] | Provide weatherproofing materials and improve shelter insulation | MEDIUM |
| 4 | areOvercrowded | availability | BOOLEAN | Overcrowding Issues | Shelters are overcrowded beyond safe capacity | true | — | GAP | true | Overcrowded shelters | Shelters are overcrowded beyond safe capacity | Decongest existing shelters and establish additional shelter sites | MEDIUM |
| 5 | shelterTypes | current-types | MULTI_SELECT | Current Shelter Types | Select the types of shelters currently available | false | Trampoline; Open space; Local materials; Communal structure; Other | CONTEXT | false | — | — | — | LOW |
| 6 | requiredShelterType | requirements | MULTI_SELECT | Additional Shelter Requirements | Select the types of shelters urgently needed | false | Trampoline; Open space; Local materials; Communal structure; Other | CONTEXT | false | — | — | — | LOW |
| 7 | numberSheltersRequired | requirements | NUMBER | Number of Shelters Required | Estimated number of additional shelters needed | true | — | CONTEXT | false | — | — | — | LOW |
| 8 | additionalShelterDetails | additional | TEXT_LONG | Additional Details | Any additional shelter-related information | false | — | CONTEXT | false | — | — | — | LOW |

Options for `shelterTypes` / `requiredShelterType` (value; label; description): Trampoline (label "Trampoline/Tent", "Emergency tents or temporary structures"); Open space (label "Open Space", "Designated open areas for temporary shelter"); Local materials (label "Local Materials", "Shelters built with locally available materials"); Communal structure (label "Communal Structures", "Public buildings used as shelters"); Other ("Other types of shelter arrangements").

## SECURITY (7 questions — 6 GAP, 1 CONTEXT)

| # | questionKey | section | type | label | helperText | required | options | category | inverted | gapLabel | gapMeaning | recommendation | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | isSafeFromViolence | violence-safety | BOOLEAN | Safe from Violence | Population is safe from violence and armed conflict | true | — | GAP | false | Safety concerns | Population is not safe from violence and armed conflict | Establish security patrols and safe zones for vulnerable populations | MEDIUM |
| 2 | gbvCasesReported | violence-safety | BOOLEAN | GBV Cases Reported | Cases of gender-based violence have been reported | true | — | GAP | true | GBV cases reported [A] | Cases of gender-based violence have been reported [A] | Deploy specialized GBV response teams and establish safe reporting mechanisms | MEDIUM |
| 3 | hasSecurityPresence | security-services | BOOLEAN | Security Presence | Security personnel or forces are present in the area | true | — | GAP | false | No security presence | Security personnel or forces are not present in the area | Request security personnel deployment and establish local security committees | MEDIUM |
| 4 | hasProtectionReportingMechanism | security-services | BOOLEAN | Protection Reporting Mechanism | Mechanisms exist for reporting protection concerns | true | — | GAP | false | No protection reporting mechanism | Mechanisms for reporting protection concerns do not exist | Establish confidential protection reporting channels and community alert systems | MEDIUM |
| 5 | vulnerableGroupsHaveAccess | vulnerable-groups | BOOLEAN | Vulnerable Groups Have Access | Vulnerable groups have access to protection services | true | — | GAP | false | Vulnerable groups lack access [A] | Vulnerable groups do not have access to protection services [A] | Ensure priority access to services for women, children, elderly, and persons with disabilities | MEDIUM |
| 6 | hasLighting | environmental-safety | BOOLEAN | Adequate Lighting | Sufficient lighting available for safety and security | true | — | GAP | false | No adequate lighting [A] | Insufficient lighting is available for safety and security [A] | Install lighting systems in high-risk areas and communal spaces | MEDIUM |
| 7 | additionalSecurityDetails | additional | TEXT_LONG | Additional Details | Any additional security or protection-related information | false | — | CONTEXT | false | — | — | — | LOW |

## POPULATION (13 questions — 0 GAP, 13 CONTEXT)

| # | questionKey | section | type | label | helperText | required | category |
|---|---|---|---|---|---|---|---|
| 1 | totalHouseholds | basic | NUMBER | Total Households | Number of households in the affected area | true | CONTEXT |
| 2 | totalPopulation | basic | NUMBER | Total Population | Total number of people affected | true | CONTEXT |
| 3 | populationMale | basic | NUMBER | Male Population | Number of males in the affected population | true | CONTEXT |
| 4 | populationFemale | basic | NUMBER | Female Population | Number of females in the affected population | true | CONTEXT |
| 5 | populationUnder5 | vulnerable | NUMBER | Children Under 5 | Children under 5 years old | true | CONTEXT |
| 6 | pregnantWomen | vulnerable | NUMBER | Pregnant Women | Pregnant women requiring care | true | CONTEXT |
| 7 | lactatingMothers | vulnerable | NUMBER | Lactating Mothers | Lactating mothers with infants | true | CONTEXT |
| 8 | personWithDisability | vulnerable | NUMBER | Persons with Disabilities | People with disabilities | true | CONTEXT |
| 9 | elderlyPersons | vulnerable | NUMBER | Elderly Persons (60+) | Elderly persons over 60 years | true | CONTEXT |
| 10 | separatedChildren | vulnerable | NUMBER | Separated Children | Unaccompanied or separated children | true | CONTEXT |
| 11 | numberLivesLost | casualties | NUMBER | Lives Lost | Number of confirmed deaths | true | CONTEXT |
| 12 | numberInjured | casualties | NUMBER | Injured Persons | Number of injured persons requiring medical attention | true | CONTEXT |
| 13 | additionalPopulationDetails | additional | TEXT_LONG | Additional Details | Any additional population-related information | false | CONTEXT |

## Validation invariants (enforced by `validateRegistry`)

1. All question `options[].value` unique per question; labels non-empty.
2. `questionKey` unique per `assessmentType`; `id` = `{type}:{questionKey}`; section `id` = `{type}:{sectionKey}`.
3. `order` per (type, section) strictly contiguous starting at 1; section `order` per type strictly contiguous starting at 1.
4. Only `category = GAP` may set `gapLabel` / `gapMeaning` / `recommendation` / `severity != LOW` / `inverted`.
5. `QuestionType` of `BOOLEAN` required for GAP questions; `SINGLE_CHOICE`/`MULTI_SELECT` must declare at least one option; `NUMBER` carries `numberMin`.
6. Catalog counts: 6 assessment types, 27 sections, 55 questions, 24 GAP, 31 CONTEXT.
