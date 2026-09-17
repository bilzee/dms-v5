# Donor-Commitment-Response Workflow Test Script

## Overview
This comprehensive test validates the complete donor-commitment-response workflow including entity assignments, commitment creation, response planning, delivery confirmation, and impact tracking across multiple roles.

## Test Users Required
- **Admin**: admin@dms.gov.ng / admin123!
- **Coordinator**: coordinator@test.com / testpassword123  
- **Responder**: responder@dms.gov.ng / responder123!
- **Donor Users**: Will be created during test

## Pre-Test Requirements
1. **FOUNDATION WORKFLOWS COMPLETED** - Requires existing incidents and entities from coordinator workflow
2. Database seeded with test users (`npx prisma db seed -- --with-sample-data`)
3. Open Chrome DevTools
4. Navigate to the application URL
5. Copy `data-tracker-template.json` to `donor-commitment-response-tracker.json`

## Test Workflow Sequence

### Phase 1: Admin Setup - Create Donor Organizations & Users

#### 1.1 Admin Login & Navigation
**Action**: Login as admin and navigate to user management
**Chrome DevTools Steps**:
1. Navigate to login page
2. Fill email: `admin@dms.gov.ng`
3. Fill password: `admin123!`
4. Click login button
5. Navigate to `/admin/users` or admin dashboard
6. Locate user management section

**Expected Result**: Admin dashboard loads with user management access
**Data to Track**: Admin session token, dashboard load time

---

#### 1.2 Create First Donor Organization & User
**Action**: Create first donor organization with associated user
**Chrome DevTools Steps**:
1. Click "Create User" or "Add New User"
2. Fill user creation form:
   - **Name**: `CARE International Donor User`
   - **Email**: `donor1@care.org` 
   - **Password**: `donor123!`
   - **Role**: Select DONOR role
   - **Organization**: `CARE International` (create if needed)
3. Submit user creation
4. Verify user appears in user list
5. Note the created user ID

**Expected Result**: First donor user created successfully
**Data to Track**:
```json
{
  "donorUser1": {
    "id": "user-id-1",
    "email": "donor1@care.org",
    "name": "CARE International Donor User",
    "organization": "CARE International",
    "role": "DONOR",
    "createdAt": "timestamp"
  }
}
```

---

#### 1.3 Create Second Donor Organization & User
**Action**: Create second donor organization with associated user
**Chrome DevTools Steps**:
1. Click "Create User" or "Add New User"
2. Fill user creation form:
   - **Name**: `UN OCHA Donor User`
   - **Email**: `donor2@unocha.org`
   - **Password**: `donor123!` 
   - **Role**: Select DONOR role
   - **Organization**: `UN OCHA` (create if needed)
3. Submit user creation
4. Verify user appears in user list
5. Note the created user ID

**Expected Result**: Second donor user created successfully
**Data to Track**:
```json
{
  "donorUser2": {
    "id": "user-id-2", 
    "email": "donor2@unocha.org",
    "name": "UN OCHA Donor User",
    "organization": "UN OCHA",
    "role": "DONOR",
    "createdAt": "timestamp"
  }
}
```

---

### Phase 2: Coordinator Entity Assignments

#### 2.1 Coordinator Login & Entity Management
**Action**: Login as coordinator and navigate to entity management
**Chrome DevTools Steps**:
1. Logout from admin (if needed)
2. Login with coordinator credentials:
   - Email: `coordinator@test.com`
   - Password: `testpassword123`
3. Navigate to entity management or entity assignments page
4. Locate entity assignment functionality

**Expected Result**: Coordinator access to entity management interface
**Data to Track**: Coordinator session, available entities list

---

#### 2.2 Assign Three Entities to First Donor
**Action**: Assign entities to CARE International donor
**Chrome DevTools Steps**:
1. Select first donor user (`donor1@care.org`)
2. Assign three entities (use existing entities from foundation data):
   - **Entity 1**: Primary Health Center Maiduguri
   - **Entity 2**: IDP Camp Dalori  
   - **Entity 3**: Gwoza Local Government
3. Submit assignments
4. Verify assignments are saved
5. Note assignment IDs

**Expected Result**: Three entities assigned to first donor
**Data to Track**:
```json
{
  "donorAssignments1": [
    {
      "assignmentId": "assignment-id-1",
      "donorUserId": "user-id-1",
      "entityId": "health-center-maiduguri-id",
      "entityName": "Primary Health Center Maiduguri",
      "assignedAt": "timestamp"
    },
    {
      "assignmentId": "assignment-id-2", 
      "donorUserId": "user-id-1",
      "entityId": "idp-camp-dalori-id",
      "entityName": "IDP Camp Dalori",
      "assignedAt": "timestamp"
    },
    {
      "assignmentId": "assignment-id-3",
      "donorUserId": "user-id-1", 
      "entityId": "gwoza-lga-id",
      "entityName": "Gwoza Local Government",
      "assignedAt": "timestamp"
    }
  ]
}
```

---

#### 2.3 Assign Three Entities to Second Donor
**Action**: Assign different entities to UN OCHA donor
**Chrome DevTools Steps**:
1. Select second donor user (`donor2@unocha.org`)
2. Assign three different entities:
   - **Entity 1**: Maiduguri Metropolitan Council
   - **Entity 2**: Test Community Center (if available)
   - **Entity 3**: Test School Facility (if available)
3. Submit assignments
4. Verify assignments are saved
5. Note assignment IDs

**Expected Result**: Three entities assigned to second donor
**Data to Track**:
```json
{
  "donorAssignments2": [
    {
      "assignmentId": "assignment-id-4",
      "donorUserId": "user-id-2",
      "entityId": "maiduguri-metro-id", 
      "entityName": "Maiduguri Metropolitan Council",
      "assignedAt": "timestamp"
    },
    {
      "assignmentId": "assignment-id-5",
      "donorUserId": "user-id-2",
      "entityId": "community-center-id",
      "entityName": "Test Community Center",
      "assignedAt": "timestamp"
    },
    {
      "assignmentId": "assignment-id-6",
      "donorUserId": "user-id-2",
      "entityId": "school-facility-id",
      "entityName": "Test School Facility", 
      "assignedAt": "timestamp"
    }
  ]
}
```

---

### Phase 3: Donor Commitment Creation

#### 3.1 First Donor Login & Dashboard Access
**Action**: Login as first donor and explore dashboard
**Chrome DevTools Steps**:
1. Logout from coordinator
2. Login with first donor credentials:
   - Email: `donor1@care.org`
   - Password: `donor123!`
3. Navigate to donor dashboard
4. Verify entity assignments are visible
5. Navigate to commitment creation

**Expected Result**: Donor dashboard shows assigned entities
**Data to Track**: Donor session, visible assigned entities

---

#### 3.2 Create Commitments for First Donor's Entities
**Action**: Create one commitment per assigned entity
**Chrome DevTools Steps**:

**Commitment 1 - Health Center**:
1. Navigate to commitment creation
2. Create commitment for Primary Health Center Maiduguri:
   - **Type**: HEALTH
   - **Description**: "Medical supplies for health center"
   - **Resource Items**:
     - 50 Medical Kits (units)
     - 200 Medicine Bottles (units)
     - 10 Emergency Equipment (units)
   - **Estimated Value**: $25,000
   - **Delivery Timeline**: 30 days
3. Submit commitment
4. Note commitment ID

**Commitment 2 - IDP Camp**:
1. Create commitment for IDP Camp Dalori:
   - **Type**: WASH
   - **Description**: "Water and sanitation supplies for IDP camp"
   - **Resource Items**:
     - 100 Water Containers (units)
     - 50 Sanitation Kits (units)
     - 20 Water Purification Tablets (boxes)
   - **Estimated Value**: $15,000
   - **Delivery Timeline**: 21 days
2. Submit commitment
3. Note commitment ID

**Commitment 3 - LGA**:
1. Create commitment for Gwoza Local Government:
   - **Type**: SHELTER
   - **Description**: "Emergency shelter materials for displaced families"
   - **Resource Items**:
     - 75 Emergency Tents (units)
     - 150 Blankets (units)
     - 100 Sleeping Mats (units)
   - **Estimated Value**: $30,000
   - **Delivery Timeline**: 45 days
2. Submit commitment
3. Note commitment ID

**Expected Result**: Three commitments created for first donor
**Data to Track**:
```json
{
  "donor1Commitments": [
    {
      "commitmentId": "commitment-id-1",
      "donorUserId": "user-id-1",
      "entityId": "health-center-maiduguri-id",
      "type": "HEALTH",
      "description": "Medical supplies for health center",
      "estimatedValue": 25000,
      "deliveryTimeline": "30 days",
      "status": "ACTIVE"
    },
    {
      "commitmentId": "commitment-id-2", 
      "donorUserId": "user-id-1",
      "entityId": "idp-camp-dalori-id",
      "type": "WASH",
      "description": "Water and sanitation supplies for IDP camp",
      "estimatedValue": 15000,
      "deliveryTimeline": "21 days",
      "status": "ACTIVE"
    },
    {
      "commitmentId": "commitment-id-3",
      "donorUserId": "user-id-1",
      "entityId": "gwoza-lga-id",
      "type": "SHELTER", 
      "description": "Emergency shelter materials for displaced families",
      "estimatedValue": 30000,
      "deliveryTimeline": "45 days",
      "status": "ACTIVE"
    }
  ]
}
```

---

#### 3.3 Second Donor Login & Commitment Creation
**Action**: Login as second donor and create commitments
**Chrome DevTools Steps**:
1. Logout from first donor
2. Login with second donor credentials:
   - Email: `donor2@unocha.org`
   - Password: `donor123!`
3. Navigate to commitment creation
4. Create three commitments for assigned entities:

**Commitment 1 - Metro Council**:
- **Type**: LOGISTICS
- **Description**: "Transportation and coordination support"
- **Resource Items**:
  - 5 Vehicles (units)
  - 100 Fuel Vouchers (units)
  - 20 Communication Equipment (units)
- **Estimated Value**: $40,000
- **Delivery Timeline**: 14 days

**Commitment 2 - Community Center**:
- **Type**: FOOD
- **Description**: "Food supplies for community distribution"
- **Resource Items**:
  - 500 Food Packages (units)
  - 200 Nutrition Supplements (units)
  - 100 Cooking Supplies (kits)
- **Estimated Value**: $20,000
- **Delivery Timeline**: 7 days

**Commitment 3 - School Facility**:
- **Type**: SECURITY
- **Description**: "Security enhancement and equipment"
- **Resource Items**:
  - 10 Security Systems (units)
  - 20 Safety Equipment (kits)
  - 5 Emergency Communication (units)
- **Estimated Value**: $18,000
- **Delivery Timeline**: 28 days

**Expected Result**: Three commitments created for second donor
**Data to Track**:
```json
{
  "donor2Commitments": [
    {
      "commitmentId": "commitment-id-4",
      "donorUserId": "user-id-2",
      "entityId": "maiduguri-metro-id",
      "type": "LOGISTICS",
      "description": "Transportation and coordination support",
      "estimatedValue": 40000,
      "deliveryTimeline": "14 days",
      "status": "ACTIVE"
    },
    {
      "commitmentId": "commitment-id-5",
      "donorUserId": "user-id-2", 
      "entityId": "community-center-id",
      "type": "FOOD",
      "description": "Food supplies for community distribution",
      "estimatedValue": 20000,
      "deliveryTimeline": "7 days",
      "status": "ACTIVE"
    },
    {
      "commitmentId": "commitment-id-6",
      "donorUserId": "user-id-2",
      "entityId": "school-facility-id",
      "type": "SECURITY",
      "description": "Security enhancement and equipment",
      "estimatedValue": 18000,
      "deliveryTimeline": "28 days", 
      "status": "ACTIVE"
    }
  ]
}
```

---

### Phase 4: Responder Response Planning with Commitment Import

#### 4.1 Responder Login & Navigation
**Action**: Login as responder and access planning tools
**Chrome DevTools Steps**:
1. Logout from donor user
2. Login with responder credentials:
   - Email: `responder@dms.gov.ng`
   - Password: `responder123!`
3. Navigate to response planning dashboard
4. Locate "Create New Response Plan" functionality

**Expected Result**: Responder access to response planning interface
**Data to Track**: Responder session, available planning tools

---

#### 4.2 Create Response Plans Importing Commitments
**Action**: Create 6 response plans, one for each commitment
**Chrome DevTools Steps**:

**Response Plan 1 - Import Health Commitment**:
1. Click "Create New Response Plan"
2. Switch to "Commitment" tab in the creation form
3. Search for and select commitment-id-1 (CARE Health commitment)
4. Import commitment details into response plan:
   - **Title**: "Health Response - Medical Supplies Deployment"
   - **Type**: HEALTH
   - **Priority**: CRITICAL
   - **Entity**: Primary Health Center Maiduguri (auto-populated)
   - **Resources**: Import from commitment (Medical Kits, Medicine, Equipment)
5. Add response-specific details:
   - **Response Team Size**: 5 personnel
   - **Deployment Date**: Within 7 days
   - **Coordination Notes**: "Coordinate with CARE International for delivery"
6. Submit response plan
7. Note response plan ID

**Response Plan 2 - Import WASH Commitment**:
1. Create new response plan
2. Import commitment-id-2 (CARE WASH commitment)
3. Fill response details:
   - **Title**: "WASH Response - Water and Sanitation"
   - **Type**: WASH
   - **Priority**: HIGH
   - **Resources**: Import from commitment
4. Submit and note ID

**Response Plan 3 - Import Shelter Commitment**:
1. Create new response plan
2. Import commitment-id-3 (CARE Shelter commitment)
3. Fill response details:
   - **Title**: "Shelter Response - Emergency Housing"
   - **Type**: SHELTER
   - **Priority**: HIGH
   - **Resources**: Import from commitment
4. Submit and note ID

**Response Plan 4 - Import Logistics Commitment**:
1. Create new response plan
2. Import commitment-id-4 (UN OCHA Logistics commitment)
3. Fill response details:
   - **Title**: "Logistics Response - Transportation Support"
   - **Type**: LOGISTICS
   - **Priority**: MEDIUM
   - **Resources**: Import from commitment
4. Submit and note ID

**Response Plan 5 - Import Food Commitment**:
1. Create new response plan
2. Import commitment-id-5 (UN OCHA Food commitment)
3. Fill response details:
   - **Title**: "Food Response - Community Distribution"
   - **Type**: FOOD
   - **Priority**: CRITICAL
   - **Resources**: Import from commitment
4. Submit and note ID

**Response Plan 6 - Import Security Commitment**:
1. Create new response plan
2. Import commitment-id-6 (UN OCHA Security commitment)
3. Fill response details:
   - **Title**: "Security Response - Safety Enhancement"
   - **Type**: SECURITY
   - **Priority**: MEDIUM
   - **Resources**: Import from commitment
4. Submit and note ID

**Expected Result**: Six response plans created, one per commitment
**Data to Track**:
```json
{
  "responsePlans": [
    {
      "responsePlanId": "response-plan-id-1",
      "title": "Health Response - Medical Supplies Deployment",
      "type": "HEALTH",
      "priority": "CRITICAL",
      "importedCommitmentId": "commitment-id-1",
      "entityId": "health-center-maiduguri-id",
      "status": "PLANNED",
      "createdBy": "responder@dms.gov.ng"
    },
    {
      "responsePlanId": "response-plan-id-2",
      "title": "WASH Response - Water and Sanitation", 
      "type": "WASH",
      "priority": "HIGH",
      "importedCommitmentId": "commitment-id-2",
      "entityId": "idp-camp-dalori-id",
      "status": "PLANNED",
      "createdBy": "responder@dms.gov.ng"
    },
    {
      "responsePlanId": "response-plan-id-3",
      "title": "Shelter Response - Emergency Housing",
      "type": "SHELTER", 
      "priority": "HIGH",
      "importedCommitmentId": "commitment-id-3",
      "entityId": "gwoza-lga-id",
      "status": "PLANNED",
      "createdBy": "responder@dms.gov.ng"
    },
    {
      "responsePlanId": "response-plan-id-4",
      "title": "Logistics Response - Transportation Support",
      "type": "LOGISTICS",
      "priority": "MEDIUM",
      "importedCommitmentId": "commitment-id-4", 
      "entityId": "maiduguri-metro-id",
      "status": "PLANNED",
      "createdBy": "responder@dms.gov.ng"
    },
    {
      "responsePlanId": "response-plan-id-5",
      "title": "Food Response - Community Distribution",
      "type": "FOOD",
      "priority": "CRITICAL",
      "importedCommitmentId": "commitment-id-5",
      "entityId": "community-center-id", 
      "status": "PLANNED",
      "createdBy": "responder@dms.gov.ng"
    },
    {
      "responsePlanId": "response-plan-id-6",
      "title": "Security Response - Safety Enhancement",
      "type": "SECURITY",
      "priority": "MEDIUM",
      "importedCommitmentId": "commitment-id-6",
      "entityId": "school-facility-id",
      "status": "PLANNED",
      "createdBy": "responder@dms.gov.ng"
    }
  ]
}
```

---

### Phase 5: Responder Delivery Confirmation

#### 5.1 Mark Response Plans as Delivered
**Action**: Confirm delivery of all 6 response plans
**Chrome DevTools Steps**:
1. Navigate to response plan management/tracking
2. For each response plan created:
   - Locate the response plan in the list
   - Click "Mark as Delivered" or update status
   - Fill delivery confirmation details:
     - **Delivery Date**: Current date
     - **Delivery Notes**: "Resources successfully delivered and deployed"
     - **Confirmation Photo/Evidence**: Upload if available
   - Change status from "PLANNED" to "DELIVERED"
3. Verify all 6 response plans show "DELIVERED" status
4. Note delivery timestamps

**Expected Result**: All response plans marked as delivered
**Data to Track**:
```json
{
  "deliveryConfirmations": [
    {
      "responsePlanId": "response-plan-id-1",
      "deliveryStatus": "DELIVERED",
      "deliveryDate": "timestamp",
      "deliveryNotes": "Health supplies delivered to Primary Health Center",
      "confirmedBy": "responder@dms.gov.ng"
    },
    {
      "responsePlanId": "response-plan-id-2", 
      "deliveryStatus": "DELIVERED",
      "deliveryDate": "timestamp",
      "deliveryNotes": "WASH supplies delivered to IDP Camp",
      "confirmedBy": "responder@dms.gov.ng"
    },
    {
      "responsePlanId": "response-plan-id-3",
      "deliveryStatus": "DELIVERED",
      "deliveryDate": "timestamp",
      "deliveryNotes": "Shelter materials delivered to Gwoza LGA",
      "confirmedBy": "responder@dms.gov.ng"
    },
    {
      "responsePlanId": "response-plan-id-4",
      "deliveryStatus": "DELIVERED", 
      "deliveryDate": "timestamp",
      "deliveryNotes": "Logistics support deployed to Metro Council",
      "confirmedBy": "responder@dms.gov.ng"
    },
    {
      "responsePlanId": "response-plan-id-5",
      "deliveryStatus": "DELIVERED",
      "deliveryDate": "timestamp", 
      "deliveryNotes": "Food supplies distributed at Community Center",
      "confirmedBy": "responder@dms.gov.ng"
    },
    {
      "responsePlanId": "response-plan-id-6",
      "deliveryStatus": "DELIVERED",
      "deliveryDate": "timestamp",
      "deliveryNotes": "Security equipment installed at School Facility",
      "confirmedBy": "responder@dms.gov.ng"
    }
  ]
}
```

---

### Phase 6: Coordinator Verification

#### 6.1 Coordinator Login & Delivery Verification
**Action**: Coordinator verifies all responder delivery confirmations
**Chrome DevTools Steps**:
1. Logout from responder
2. Login as coordinator:
   - Email: `coordinator@test.com`
   - Password: `testpassword123`
3. Navigate to delivery verification queue or response tracking
4. Locate all 6 delivered response plans
5. For each delivery:
   - Review delivery details and evidence
   - Add verification notes
   - Confirm delivery as "VERIFIED"
   - Update commitment status to "COMPLETED"
6. Verify all deliveries show "VERIFIED" status

**Expected Result**: All 6 deliveries verified by coordinator
**Data to Track**:
```json
{
  "coordinatorVerifications": [
    {
      "responsePlanId": "response-plan-id-1",
      "verificationStatus": "VERIFIED",
      "verificationDate": "timestamp",
      "verificationNotes": "Health delivery confirmed - medical supplies properly distributed",
      "verifiedBy": "coordinator@test.com",
      "commitmentStatus": "COMPLETED"
    },
    {
      "responsePlanId": "response-plan-id-2",
      "verificationStatus": "VERIFIED",
      "verificationDate": "timestamp", 
      "verificationNotes": "WASH delivery confirmed - water systems operational",
      "verifiedBy": "coordinator@test.com",
      "commitmentStatus": "COMPLETED"
    },
    {
      "responsePlanId": "response-plan-id-3",
      "verificationStatus": "VERIFIED",
      "verificationDate": "timestamp",
      "verificationNotes": "Shelter delivery confirmed - emergency housing established",
      "verifiedBy": "coordinator@test.com",
      "commitmentStatus": "COMPLETED"
    },
    {
      "responsePlanId": "response-plan-id-4",
      "verificationStatus": "VERIFIED",
      "verificationDate": "timestamp",
      "verificationNotes": "Logistics delivery confirmed - transportation support active",
      "verifiedBy": "coordinator@test.com", 
      "commitmentStatus": "COMPLETED"
    },
    {
      "responsePlanId": "response-plan-id-5",
      "verificationStatus": "VERIFIED",
      "verificationDate": "timestamp",
      "verificationNotes": "Food delivery confirmed - distribution successful",
      "verifiedBy": "coordinator@test.com",
      "commitmentStatus": "COMPLETED"
    },
    {
      "responsePlanId": "response-plan-id-6",
      "verificationStatus": "VERIFIED",
      "verificationDate": "timestamp",
      "verificationNotes": "Security delivery confirmed - safety measures implemented",
      "verifiedBy": "coordinator@test.com",
      "commitmentStatus": "COMPLETED"
    }
  ]
}
```

---

### Phase 7: Donor Impact Validation

#### 7.1 First Donor Dashboard Impact Verification
**Action**: Login as first donor and verify impact tracking
**Chrome DevTools Steps**:
1. Logout from coordinator
2. Login as first donor:
   - Email: `donor1@care.org`
   - Password: `donor123!`
3. Navigate to donor dashboard
4. Verify completed commitments appear in dashboard
5. Check commitment status shows "COMPLETED"
6. Note impact metrics displayed

**Expected Result**: Dashboard reflects completed commitments
**Data to Track**: Dashboard metrics, commitment status updates

---

#### 7.2 First Donor Impact Page Verification
**Action**: Check detailed impact page for first donor
**Chrome DevTools Steps**:
1. Navigate to impact page or impact analytics
2. Verify the following data appears:
   - **Total Commitments**: 3 completed
   - **Total Value Delivered**: $70,000 ($25k + $15k + $30k)
   - **Beneficiaries Impacted**: Based on entity populations
   - **Response Types Supported**: HEALTH, WASH, SHELTER
3. Check each commitment shows detailed delivery information
4. Verify delivery dates and verification status
5. Take screenshot of impact page

**Expected Result**: Impact page shows accurate delivery data
**Data to Track**:
```json
{
  "donor1ImpactMetrics": {
    "totalCommitments": 3,
    "completedCommitments": 3,
    "totalValueDelivered": 70000,
    "responseTypesSupported": ["HEALTH", "WASH", "SHELTER"],
    "beneficiariesImpacted": "calculated-from-entities",
    "deliverySuccessRate": "100%"
  }
}
```

---

#### 7.3 First Donor Leaderboard Position Verification
**Action**: Check leaderboard rankings for first donor
**Chrome DevTools Steps**:
1. Navigate to leaderboard page
2. Locate CARE International in donor rankings
3. Verify ranking metrics:
   - **Position**: Check ranking position
   - **Delivery Rate**: Should show 100% (3/3 delivered)
   - **Total Impact Value**: Should show $70,000
   - **Response Speed**: Based on delivery timelines
   - **Badge/Status**: Check for any achievement badges
4. Compare with other donors on leaderboard
5. Take screenshot of leaderboard

**Expected Result**: CARE International properly ranked with correct metrics
**Data to Track**: Leaderboard position, ranking metrics

---

#### 7.4 Second Donor Impact Verification
**Action**: Login as second donor and verify all impact tracking
**Chrome DevTools Steps**:
1. Logout from first donor
2. Login as second donor:
   - Email: `donor2@unocha.org`
   - Password: `donor123!`
3. Repeat dashboard, impact page, and leaderboard verification:
   - **Dashboard**: 3 completed commitments visible
   - **Impact Page**: $78,000 total value delivered ($40k + $20k + $18k)
   - **Leaderboard**: UN OCHA position and metrics
4. Compare impact metrics between both donors
5. Verify both donors appear correctly on leaderboard

**Expected Result**: Second donor shows complete impact tracking
**Data to Track**:
```json
{
  "donor2ImpactMetrics": {
    "totalCommitments": 3,
    "completedCommitments": 3, 
    "totalValueDelivered": 78000,
    "responseTypesSupported": ["LOGISTICS", "FOOD", "SECURITY"],
    "beneficiariesImpacted": "calculated-from-entities",
    "deliverySuccessRate": "100%"
  }
}
```

---

## Data Tracking Summary

Update `donor-commitment-response-tracker.json` with complete workflow data:

```json
{
  "testSession": {
    "startTime": "2025-12-08T10:00:00Z",
    "testRunner": "Claude Code QA Assistant",
    "description": "Complete donor-commitment-response workflow test with 2 donors, 6 commitments, 6 response plans"
  },
  "workflowSummary": {
    "phase1_adminSetup": {
      "donorUsersCreated": 2,
      "organizations": ["CARE International", "UN OCHA"],
      "status": "completed"
    },
    "phase2_entityAssignments": {
      "totalAssignments": 6,
      "assignmentsPerDonor": 3,
      "status": "completed"
    },
    "phase3_commitmentCreation": {
      "totalCommitments": 6,
      "totalValue": 148000,
      "commitmentTypes": ["HEALTH", "WASH", "SHELTER", "LOGISTICS", "FOOD", "SECURITY"],
      "status": "completed"
    },
    "phase4_responsePlanning": {
      "responsePlansCreated": 6,
      "commitmentImportsSuccessful": 6,
      "status": "completed"
    },
    "phase5_deliveryConfirmation": {
      "plansDelivered": 6,
      "deliverySuccessRate": "100%",
      "status": "completed"
    },
    "phase6_coordinatorVerification": {
      "verificationsCompleted": 6,
      "verificationSuccessRate": "100%",
      "status": "completed"
    },
    "phase7_impactValidation": {
      "donorDashboardsValidated": 2,
      "impactPagesValidated": 2,
      "leaderboardValidated": true,
      "status": "completed"
    }
  },
  "issues": [],
  "overallStatus": "completed",
  "testDuration": "calculated-total-time",
  "conclusionRecommendation": "workflow-success-assessment"
}
```

## Test Completion Checklist

### Phase 1: Admin Setup
- [ ] Admin login successful
- [ ] First donor user created (CARE International)
- [ ] Second donor user created (UN OCHA)
- [ ] User creation data tracked

### Phase 2: Entity Assignments  
- [ ] Coordinator login successful
- [ ] 3 entities assigned to first donor
- [ ] 3 entities assigned to second donor
- [ ] Assignment data tracked

### Phase 3: Commitment Creation
- [ ] First donor login successful
- [ ] 3 commitments created for first donor
- [ ] Second donor login successful  
- [ ] 3 commitments created for second donor
- [ ] All commitment data tracked

### Phase 4: Response Planning
- [ ] Responder login successful
- [ ] 6 response plans created (one per commitment)
- [ ] Commitment import functionality working
- [ ] Response plan data tracked

### Phase 5: Delivery Confirmation
- [ ] All 6 response plans marked as delivered
- [ ] Delivery confirmations saved
- [ ] Delivery status updated across system

### Phase 6: Coordinator Verification
- [ ] Coordinator verification of all deliveries
- [ ] All 6 deliveries verified
- [ ] Commitment status updated to completed

### Phase 7: Impact Validation
- [ ] First donor dashboard shows completed commitments
- [ ] First donor impact page shows accurate metrics
- [ ] First donor appears correctly on leaderboard
- [ ] Second donor dashboard shows completed commitments
- [ ] Second donor impact page shows accurate metrics
- [ ] Second donor appears correctly on leaderboard
- [ ] Both donors show 100% delivery success rate

### Test Documentation
- [ ] All phases documented with timestamps
- [ ] Issue tracking completed (if any issues found)
- [ ] Screenshots taken for critical functionality
- [ ] Data tracker JSON file complete
- [ ] Test success/failure recommendation provided

## Expected Outcomes

### Successful Test Results
- 2 donor users created and assigned entities
- 6 commitments created successfully  
- 6 response plans importing commitment data
- 100% delivery confirmation rate
- 100% coordinator verification rate
- Accurate impact tracking on donor dashboards
- Correct leaderboard rankings and metrics
- Complete end-to-end data flow validation

### Critical Success Metrics
- Entity assignment workflow operational
- Commitment creation across multiple types working
- Response plan import functionality working  
- Delivery confirmation and verification working
- Impact metrics updating in real-time
- Leaderboard calculations accurate
- Cross-workflow data consistency maintained

This comprehensive test validates the complete donor engagement lifecycle from entity assignment through impact tracking, ensuring all components of the donor-commitment-response workflow function correctly.