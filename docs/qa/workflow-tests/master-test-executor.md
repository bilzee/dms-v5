# Master Workflow Test Executor

## Overview
This document provides the master execution plan for testing all user workflows using Chrome DevTools. The tests must be executed in order due to cross-workflow dependencies.

## Prerequisites
1. **Application Running**: Ensure the application is running locally or in test environment
2. **Database Seeded**: Run `npx prisma db seed -- --with-sample-data` to ensure test users and base data exist (the flag is required since DQR P9 — the default seed is production-safe and creates no demo users)
3. **Chrome DevTools Ready**: Open Chrome with DevTools enabled
4. **Clean State**: Start with fresh test data tracker

## Test Execution Order

### Phase 1: Foundation Setup
1. **Initialize Test Session**
   ```bash
   # Copy the data tracker template
   cp docs/qa/workflow-tests/data-tracker-template.json docs/qa/workflow-tests/test-data-tracker.json
   
   # Update test session info
   # Edit test-data-tracker.json:
   # - startTime: current timestamp
   # - testRunner: your name/identifier
   # - description: "Complete workflow testing session"
   ```

### Phase 2: User Workflow Testing (Sequential)

#### Step 1: Coordinator Workflow (FOUNDATION - MUST RUN FIRST)
- **File**: `workflow-test-coordinator.md`
- **Duration**: ~45-60 minutes
- **Purpose**: Create foundational incidents and entities, then test management features
- **Dependencies**: None (runs first)
- **Key Outputs**: 2 test incidents, 4 test entities, verification infrastructure
- **Critical**: ALL other workflows depend on the incidents and entities created here

#### Step 2: Assessor Workflow
- **File**: `workflow-test-assessor.md` 
- **Duration**: ~30-45 minutes
- **Purpose**: Create assessments with gaps linked to coordinator-created incidents and entities
- **Dependencies**: Requires incidents and entities from Step 1
- **Key Outputs**: Assessment IDs with known gaps for verification testing
- **Critical**: Uses specific coordinator-created data for controlled testing

#### Step 3: Coordinator Workflow Continuation (Verification)
- **Return to**: `workflow-test-coordinator.md` (Step 4 onwards)
- **Duration**: ~15 minutes
- **Purpose**: Verify the assessments created by assessor workflow
- **Dependencies**: Requires assessments from Step 2
- **Key Outputs**: Verified assessments, gap field management testing

#### Step 4: Responder Workflow
- **File**: `workflow-test-responder.md`
- **Duration**: ~30-45 minutes
- **Purpose**: Create response plans addressing verified assessment gaps
- **Dependencies**: Requires verified assessments from Step 3
- **Key Outputs**: Response plan IDs, task IDs, resource requirements

#### Step 5: Donor Workflow
- **File**: `workflow-test-donor.md`
- **Duration**: ~30-45 minutes
- **Purpose**: Create commitments and track impact
- **Dependencies**: Requires entities, incidents, and response plans from previous steps
- **Key Outputs**: Commitment IDs, donation IDs, impact metrics

#### Step 6: Admin Workflow
- **File**: `workflow-test-admin.md`
- **Duration**: ~45-60 minutes
- **Purpose**: System administration and cross-workflow validation
- **Dependencies**: Requires all data from previous workflows
- **Key Outputs**: System validation, audit verification, integrity checks

### Phase 3: Integration Validation
1. **Cross-Workflow Data Verification**
   - Verify assessor data appears in coordinator workflows
   - Verify coordinator verification affects responder planning
   - Verify responder plans integrate with donor commitments
   - Verify admin oversight covers all activities

2. **End-to-End Flow Testing**
   - Create new incident as admin
   - Follow complete workflow from assessment → verification → response → commitment
   - Verify data consistency throughout

## Chrome DevTools Usage Guide

### Setup Chrome DevTools for Testing

#### Step 1: Browser Configuration
1. Open Chrome in incognito mode (clean state)
2. Navigate to application URL
3. Open DevTools (F12)
4. Configure useful panels:
   - **Network**: Monitor API calls and performance
   - **Console**: Watch for JavaScript errors
   - **Application**: Check local storage and PWA features
   - **Security**: Verify HTTPS and security headers

#### Step 2: DevTools Testing Features

**Network Panel Usage:**
- Monitor all API requests during workflow
- Check response times and identify slow operations
- Verify offline functionality (disable network)
- Track data sync behavior

**Console Panel Usage:**
- Watch for JavaScript errors during workflows
- Monitor application logs and warnings
- Test JavaScript functions if needed

**Application Panel Usage:**
- Verify PWA functionality (service workers)
- Check local storage for offline data
- Test application manifest and caching

**Performance Panel Usage:**
- Record page load performance
- Identify performance bottlenecks
- Test mobile device simulation

### Step 3: Data Collection During Testing

**For Each Workflow Step:**
1. **Take Screenshots**: Before and after major operations
2. **Record Network Activity**: API calls, response times, errors
3. **Monitor Console**: JavaScript errors, warnings, logs
4. **Test Mobile**: Use device simulation for mobile responsiveness
5. **Test Offline**: Disable network to test offline capabilities

## Data Tracking System

### Update test-data-tracker.json After Each Workflow:

```json
{
  "testSession": {
    "startTime": "2025-01-XX XX:XX:XX",
    "testRunner": "Your Name",
    "description": "Complete workflow testing session",
    "currentPhase": "assessor/coordinator/responder/donor/admin"
  },
  "createdData": {
    "entities": ["entity-id-1", "entity-id-2"],
    "incidents": ["incident-id-1", "incident-id-2"], 
    "assessments": ["assessment-id-1", "assessment-id-2"],
    "responses": ["response-id-1", "response-id-2"],
    "commitments": ["commitment-id-1", "commitment-id-2"],
    "users": ["user-id-1"]
  }
}
```

### Cross-Workflow Reference Guide

**Coordinator → Assessor:**
- Incident IDs created in coordinator workflow
- Entity IDs created for specific testing scenarios
- Foundation data for controlled assessment creation

**Assessor → Coordinator (Verification):**
- Assessment IDs created using coordinator data
- Gap indicators for verification testing
- Controlled test data for verification workflow

**Responder → Donor:**
- Response plan IDs
- Resource requirement specifications
- Entity needs from response planning

**All Workflows → Admin:**
- Complete data set for system validation
- User activity for audit log verification
- System performance metrics

## Issue Tracking and Reporting

### Issue Documentation Format:
```json
{
  "issueId": "unique-id",
  "workflow": "assessor/coordinator/responder/donor/admin",
  "severity": "critical/high/medium/low",
  "description": "Detailed description of the issue",
  "location": "specific page/function where issue occurred",
  "reproductionSteps": ["step 1", "step 2", "step 3"],
  "expectedBehavior": "what should have happened",
  "actualBehavior": "what actually happened",
  "browserInfo": "Chrome version, OS, screen resolution",
  "screenshot": "path to screenshot file",
  "networkLogs": "relevant network activity",
  "consoleErrors": "JavaScript errors if any"
}
```

### Severity Classifications:
- **Critical**: System unusable, workflow cannot continue
- **High**: Major functionality broken, workaround possible
- **Medium**: Feature doesn't work as expected, minor impact
- **Low**: Cosmetic issues, minor usability problems

## Test Completion Criteria

### Individual Workflow Completion:
- [ ] All test steps executed successfully
- [ ] Data tracking updated with created IDs
- [ ] Screenshots captured for key operations
- [ ] Issues documented with appropriate severity
- [ ] Network performance recorded
- [ ] Console errors noted and categorized

### Overall Test Session Completion:
- [ ] All 5 workflows completed in order
- [ ] Cross-workflow data integration verified
- [ ] End-to-end flow tested successfully
- [ ] System performance acceptable across all workflows
- [ ] Security and access control verified
- [ ] Mobile responsiveness confirmed
- [ ] Offline functionality validated
- [ ] Comprehensive issue report generated

## Final Report Generation

After completing all workflows, use the collected data to generate:

1. **Executive Summary**: Overall system health and readiness
2. **Workflow Performance Report**: Each workflow's functionality and performance
3. **Integration Assessment**: Cross-workflow data flow and consistency
4. **Issue Priority Matrix**: Categorized issues with recommended actions
5. **Performance Baseline**: Response times and resource usage benchmarks
6. **Security Validation**: Access control and permission verification
7. **Mobile and PWA Assessment**: Mobile usability and offline capability
8. **Recommendations**: Priority fixes and improvements needed

## Time Estimates

| Phase | Duration | Dependencies |
|-------|----------|-------------|
| Setup | 15 minutes | None |
| Assessor | 30-45 minutes | Setup complete |
| Coordinator | 45-60 minutes | Assessor complete |
| Responder | 30-45 minutes | Coordinator complete |
| Donor | 30-45 minutes | Responder complete |
| Admin | 45-60 minutes | All previous complete |
| Integration Testing | 30 minutes | All workflows complete |
| Report Generation | 30 minutes | Testing complete |
| **Total** | **4-6 hours** | Sequential execution required |

## Success Metrics

- **Completion Rate**: All workflows executed successfully
- **Data Integrity**: Cross-workflow data consistency maintained
- **Performance**: Acceptable response times across all functions
- **Security**: Proper access control enforcement
- **Usability**: Intuitive navigation and functionality
- **Reliability**: Minimal critical or high-severity issues
- **Mobile**: Full functionality on mobile devices
- **Offline**: Core functionality available offline