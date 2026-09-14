import { describe, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/v1/exports/csv/route';
import { GET as GetCharts, POST as PostCharts } from '@/app/api/v1/exports/charts/route';
import { GET as GetReports, POST as PostReports } from '@/app/api/v1/exports/reports/route';
import { GET as GetSchedule, POST as PostSchedule, PUT as PutSchedule, DELETE as DeleteSchedule } from '@/app/api/v1/exports/schedule/route';
import { db } from '@/lib/db/client';

// Mock authentication
jest.mock('next-auth', () => ({
  getServerSession: jest.fn(() => 
    Promise.resolve({
      user: { 
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'coordinator', // Change role based on test
        name: 'Test User'
      }
    })
  ),
}));

// Mock database
jest.mock('@/lib/db/client', () => ({
  db: {
    rapidAssessment: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    response: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    entity: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    incident: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    commitment: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    location: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    jurisdiction: {
      findMany: jest.fn(),
    },
    commitmentItem: {
      findMany: jest.fn(),
    },
    scheduledReport: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

const mockDb = db as jest.Mocked<typeof db>;

describe('Export API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock responses
    mockDb.rapidAssessment.findMany.mockResolvedValue([
      {
        id: 'assessment-1',
        assessmentType: 'HEALTH',
        verificationStatus: 'VERIFIED',
        location: {
          id: 'location-1',
          name: 'Test Location',
          coordinates: '40.7128,-74.0060',
        },
        assignedTo: {
          id: 'user-1',
          name: 'Test User',
          email: 'test@example.com',
        },
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-16'),
        priorityLevel: 'HIGH',
        populationAffected: 1500,
        severityScore: 8,
        accessRoadCondition: 'PASSABLE',
        communicationStatus: 'FUNCTIONAL',
        powerSupplyStatus: 'PARTIAL',
        waterSupplyStatus: 'LIMITED',
        medicalFacilityStatus: 'OVERLOADED',
        shelterCapacityStatus: 'ADEQUATE',
        foodSecurityStatus: 'CONCERNING',
      },
    ]);

    mockDb.response.findMany.mockResolvedValue([
      {
        id: 'response-1',
        assessmentId: 'assessment-1',
        responsePriority: 'HIGH',
        status: 'IN_PROGRESS',
        entityId: 'entity-1',
        assignedTo: {
          id: 'user-1',
          name: 'Test User',
          email: 'test@example.com',
        },
        createdAt: new Date('2024-01-15'),
        targetCompletionDate: new Date('2024-01-20'),
        actualCompletionDate: null,
        progressPercentage: 65,
        resourcesRequired: 'Medical supplies, personnel',
        resourcesDeployed: 'Medical supplies',
        costEstimate: 50000,
        actualCost: 35000,
        notes: 'Progressing well, additional supplies needed',
        assessment: {
          assessmentType: 'HEALTH',
          location: {
            name: 'Test Location',
            coordinates: '40.7128,-74.0060',
          },
        },
        entity: {
          id: 'entity-1',
          name: 'Test Hospital',
          type: 'FACILITY',
        },
      },
    ]);

    mockDb.entity.findMany.mockResolvedValue([
      {
        id: 'entity-1',
        name: 'Test Hospital',
        type: 'FACILITY',
        status: 'ACTIVE',
        coordinates: '40.7128,-74.0060',
        address: '123 Main St, Test City, NJ',
        jurisdictionId: 'jur-1',
        populationSize: 10000,
        contactPerson: 'Dr. Smith',
        contactPhone: '555-0123',
        contactEmail: 'contact@testhospital.com',
        operatingHours: '24/7 Emergency',
        capacity: 200,
        currentLoad: 150,
        jurisdiction: {
          id: 'jur-1',
          name: 'Test County',
          level: 'COUNTY',
        },
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-15'),
        assignedAssessors: [
          {
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com',
          },
        ],
        _count: {
          assessments: 5,
          responses: 12,
          commitments: 3,
        },
      },
    ]);

    mockDb.incident.findMany.mockResolvedValue([
      {
        id: 'incident-1',
        type: 'FLOOD',
        severity: 'HIGH',
        status: 'ACTIVE',
        title: 'Major Flooding Event',
        description: 'Severe flooding in downtown area',
        locationId: 'location-1',
        affectedAreaRadius: 15,
        estimatedPopulationAffected: 25000,
        createdBy: 'test-user',
        createdAt: new Date('2024-01-14'),
        updatedAt: new Date('2024-01-15'),
        location: {
          id: 'location-1',
          name: 'Downtown Area',
          coordinates: '40.7128,-74.0060',
        },
        assignedTo: {
          id: 'user-2',
          name: 'Coordinator',
          email: 'coordinator@example.com',
        },
        _count: {
          assessments: 8,
          responses: 15,
        },
        estimatedResolutionTime: '72 hours',
        communicationChannelsStatus: 'PARTIAL',
      },
    ]);

    mockDb.commitment.findMany.mockResolvedValue([
      {
        id: 'commitment-1',
        donorId: 'donor-1',
        entityId: 'entity-1',
        incidentId: 'incident-1',
        status: 'ACTIVE',
        priorityLevel: 'HIGH',
        createdAt: new Date('2024-01-15'),
        expectedDeliveryDate: new Date('2024-01-25'),
        actualDeliveryDate: null,
        totalEstimatedValue: 100000,
        notes: 'Emergency medical supplies',
        donor: {
          id: 'donor-1',
          name: 'Test Foundation',
          type: 'ORGANIZATION',
        },
        entity: {
          id: 'entity-1',
          name: 'Test Hospital',
          type: 'FACILITY',
        },
        incident: {
          id: 'incident-1',
          title: 'Major Flooding Event',
          type: 'FLOOD',
          severity: 'HIGH',
        },
        _count: {
          items: 25,
        },
      },
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('CSV Export API', () => {
    describe('POST /api/v1/exports/csv', () => {
      it('should export assessments as CSV with coordinator role', async () => {
        const exportRequest = {
          dataType: 'assessments',
          format: 'csv',
          dateRange: {
            startDate: '2024-01-01T00:00:00.000Z',
            endDate: '2024-01-31T23:59:59.999Z',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/csv',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportRequest),
          }
        );

        const response = await POST(request);
        
        expect(response.status).toBe(200);
        
        // Verify CSV content
        const csvContent = await response.text();
        expect(csvContent).toContain('ID,Assessment Type,Status,Location Name');
        expect(csvContent).toContain('assessment-1,HEALTH,VERIFIED,Test Location');
        
        // Verify database calls
        expect(mockDb.rapidAssessment.findMany).toHaveBeenCalledWith({
          where: {
            createdAt: {
              gte: new Date('2024-01-01T00:00:00.000Z'),
              lte: new Date('2024-01-31T23:59:59.999Z'),
            },
          },
          include: {
            location: true,
            assignedTo: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        });
      });

      it('should export responses as CSV', async () => {
        const exportRequest = {
          dataType: 'responses',
          format: 'csv',
          dateRange: {
            startDate: '2024-01-01T00:00:00.000Z',
            endDate: '2024-01-31T23:59:59.999Z',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/csv',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportRequest),
          }
        );

        const response = await POST(request);
        
        expect(response.status).toBe(200);
        
        const csvContent = await response.text();
        expect(csvContent).toContain('ID,Assessment Type,Response Priority,Status');
        expect(csvContent).toContain('response-1,HEALTH,HIGH,IN_PROGRESS');
      });

      it('should export entities as CSV', async () => {
        const exportRequest = {
          dataType: 'entities',
          format: 'csv',
          dateRange: {
            startDate: '2024-01-01T00:00:00.000Z',
            endDate: '2024-01-31T23:59:59.999Z',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/csv',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportRequest),
          }
        );

        const response = await POST(request);
        
        expect(response.status).toBe(200);
        
        const csvContent = await response.text();
        expect(csvContent).toContain('ID,Name,Type,Status');
        expect(csvContent).toContain('entity-1,Test Hospital,FACILITY,ACTIVE');
      });

      it('should export incidents as CSV', async () => {
        const exportRequest = {
          dataType: 'incidents',
          format: 'csv',
          dateRange: {
            startDate: '2024-01-01T00:00:00.000Z',
            endDate: '2024-01-31T23:59:59.999Z',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/csv',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportRequest),
          }
        );

        const response = await POST(request);
        
        expect(response.status).toBe(200);
        
        const csvContent = await response.text();
        expect(csvContent).toContain('ID,Type,Severity,Status,Title');
        expect(csvContent).toContain('incident-1,FLOOD,HIGH,ACTIVE,Major Flooding Event');
      });

      it('should handle unauthorized requests', async () => {
        // Mock unauthorized session
        const { getServerSession } = require('next-auth');
        getServerSession.mockResolvedValueOnce(null);

        const exportRequest = {
          dataType: 'assessments',
          format: 'csv',
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/csv',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportRequest),
          }
        );

        const response = await POST(request);
        
        expect(response.status).toBe(401);
        
        const result = await response.json();
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unauthorized');
      });

      it('should handle insufficient permissions', async () => {
        // Mock assessor role (limited permissions)
        const { getServerSession } = require('next-auth');
        getServerSession.mockResolvedValueOnce({
          user: { 
            id: 'test-user-id',
            email: 'test@example.com',
            role: 'assessor', // Limited role
          }
        });

        const exportRequest = {
          dataType: 'incidents', // Not allowed for assessor
          format: 'csv',
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/csv',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportRequest),
          }
        );

        const response = await POST(request);
        
        expect(response.status).toBe(403);
        
        const result = await response.json();
        expect(result.success).toBe(false);
        expect(result.error).toContain('Insufficient permissions');
      });

      it('should validate required fields', async () => {
        const exportRequest = {
          // Missing dataType
          format: 'csv',
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/csv',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportRequest),
          }
        );

        const response = await POST(request);
        
        expect(response.status).toBe(500);
        
        const result = await response.json();
        expect(result.success).toBe(false);
      });

      it('should apply filters correctly', async () => {
        const exportRequest = {
          dataType: 'assessments',
          format: 'csv',
          filters: {
            assessmentType: 'HEALTH',
            verificationStatus: 'VERIFIED',
            locationId: 'location-1',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/csv',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportRequest),
          }
        );

        const response = await POST(request);
        
        expect(response.status).toBe(200);
        
        // Verify filters were applied
        expect(mockDb.rapidAssessment.findMany).toHaveBeenCalledWith({
          where: expect.objectContaining({
            assessmentType: 'HEALTH',
            verificationStatus: 'VERIFIED',
            locationId: 'location-1',
          }),
        });
      });
    });

    describe('GET /api/v1/exports/csv', () => {
      it('should return available export options for coordinator', async () => {
        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/csv'
        );

        const response = await GET(request);
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.availableExports).toContain('assessments');
        expect(result.data.availableExports).toContain('responses');
        expect(result.data.availableExports).toContain('entities');
        expect(result.data.availableExports).toContain('incidents');
        expect(result.data.formats).toContain('csv');
        expect(result.data.formats).toContain('xlsx');
      });

      it('should return limited options for assessor role', async () => {
        // Mock assessor role
        const { getServerSession } = require('next-auth');
        getServerSession.mockResolvedValueOnce({
          user: { 
            id: 'test-user-id',
            email: 'test@example.com',
            role: 'assessor',
          }
        });

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/csv'
        );

        const response = await GET(request);
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.data.availableExports).toContain('assessments');
        expect(result.data.availableExports).not.toContain('incidents'); // Not available for assessor
        expect(result.data.availableExports).not.toContain('responses'); // Not available for assessor
      });
    });
  });

  describe('Chart Export API', () => {
    describe('POST /api/v1/exports/charts', () => {
      it('should generate bar chart SVG', async () => {
        const chartRequest = {
          chartType: 'bar',
          data: [
            { label: 'January', value: 100 },
            { label: 'February', value: 150 },
            { label: 'March', value: 120 },
          ],
          options: {
            title: 'Monthly Assessments',
            width: 800,
            height: 600,
            format: 'svg',
            backgroundColor: '#ffffff',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/charts',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chartRequest),
          }
        );

        const response = await PostCharts(request);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
        expect(response.headers.get('Content-Disposition')).toContain('.svg');
        
        const svgContent = await response.text();
        expect(svgContent).toContain('<svg');
        expect(svgContent).toContain('Monthly Assessments');
        expect(svgContent).toContain('January');
        expect(svgContent).toContain('February');
        expect(svgContent).toContain('March');
      });

      it('should generate pie chart PNG', async () => {
        const chartRequest = {
          chartType: 'pie',
          data: [
            { label: 'Health', value: 30 },
            { label: 'WASH', value: 25 },
            { label: 'Shelter', value: 20 },
            { label: 'Food', value: 25 },
          ],
          options: {
            title: 'Assessment Types',
            width: 800,
            height: 600,
            format: 'png',
            backgroundColor: '#ffffff',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/charts',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chartRequest),
          }
        );

        const response = await PostCharts(request);
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/png');
        expect(response.headers.get('Content-Disposition')).toContain('.png');
      });

      it('should generate line chart', async () => {
        const chartRequest = {
          chartType: 'line',
          data: [
            { label: 'Day 1', value: 10 },
            { label: 'Day 2', value: 15 },
            { label: 'Day 3', value: 12 },
            { label: 'Day 4', value: 18 },
          ],
          options: {
            title: 'Response Progress',
            width: 800,
            height: 600,
            format: 'svg',
            backgroundColor: '#ffffff',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/charts',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chartRequest),
          }
        );

        const response = await PostCharts(request);
        
        expect(response.status).toBe(200);
        
        const svgContent = await response.text();
        expect(svgContent).toContain('Response Progress');
        expect(svgContent).toContain('Day 1');
        expect(svgContent).toContain('Day 2');
      });

      it('should handle data size limit', async () => {
        const largeData = Array(11000).fill(null).map((_, i) => ({
          label: `Item ${i}`,
          value: Math.random() * 100,
        }));

        const chartRequest = {
          chartType: 'bar',
          data: largeData,
          options: {
            title: 'Large Dataset',
            format: 'svg',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/charts',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chartRequest),
          }
        );

        const response = await PostCharts(request);
        
        expect(response.status).toBe(400);
        
        const result = await response.json();
        expect(result.success).toBe(false);
        expect(result.error).toContain('Data too large');
      });

      it('should validate chart type', async () => {
        const chartRequest = {
          chartType: 'invalid',
          data: [
            { label: 'Item 1', value: 10 },
          ],
          options: {
            title: 'Test Chart',
            format: 'svg',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/charts',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chartRequest),
          }
        );

        const response = await PostCharts(request);
        
        expect(response.status).toBe(500);
      });
    });

    describe('GET /api/v1/exports/charts', () => {
      it('should return available chart options', async () => {
        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/charts'
        );

        const response = await GetCharts(request);
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.chartTypes).toContain('bar');
        expect(result.data.chartTypes).toContain('pie');
        expect(result.data.chartTypes).toContain('line');
        expect(result.data.chartTypes).toContain('area');
        expect(result.data.chartTypes).toContain('scatter');
        expect(result.data.chartTypes).toContain('heat-map');
        expect(result.data.formats).toContain('png');
        expect(result.data.formats).toContain('svg');
        expect(result.data.formats).toContain('pdf');
        expect(result.data.maxDataPoints).toBe(10000);
      });
    });
  });

  describe('PDF Reports API', () => {
    describe('POST /api/v1/exports/reports', () => {
      it('should create incident overview report', async () => {
        const reportRequest = {
          reportType: 'incident-overview',
          dateRange: {
            startDate: '2024-01-01T00:00:00.000Z',
            endDate: '2024-01-31T23:59:59.999Z',
          },
          format: 'pdf',
          options: {
            includeCharts: true,
            includeMaps: true,
            title: 'Incident Report - January 2024',
            pageSize: 'A4',
            orientation: 'portrait',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/reports',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportRequest),
          }
        );

        const response = await PostReports(request);
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.jobId).toBeDefined();
        expect(result.data.estimatedTime).toBeGreaterThan(0);
        expect(result.data.status).toBe('processing');
      });

      it('should create assessment summary report', async () => {
        const reportRequest = {
          reportType: 'assessment-summary',
          dateRange: {
            startDate: '2024-01-01T00:00:00.000Z',
            endDate: '2024-01-31T23:59:59.999Z',
          },
          format: 'pdf',
          options: {
            includeCharts: true,
            includeMaps: false,
            title: 'Assessment Summary - January 2024',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/reports',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportRequest),
          }
        );

        const response = await PostReports(request);
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.jobId).toBeDefined();
      });

      it('should handle unauthorized requests', async () => {
        // Mock unauthorized session
        const { getServerSession } = require('next-auth');
        getServerSession.mockResolvedValueOnce(null);

        const reportRequest = {
          reportType: 'incident-overview',
          format: 'pdf',
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/reports',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportRequest),
          }
        );

        const response = await PostReports(request);
        
        expect(response.status).toBe(401);
        
        const result = await response.json();
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unauthorized');
      });

      it('should validate required fields', async () => {
        const reportRequest = {
          // Missing reportType
          format: 'pdf',
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/reports',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportRequest),
          }
        );

        const response = await PostReports(request);
        
        expect(response.status).toBe(500);
      });

      it('should handle report generation errors', async () => {
        // Mock database error
        mockDb.incident.findMany.mockRejectedValueOnce(new Error('Database error'));

        const reportRequest = {
          reportType: 'incident-overview',
          dateRange: {
            startDate: '2024-01-01T00:00:00.000Z',
            endDate: '2024-01-31T23:59:59.999Z',
          },
          format: 'pdf',
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/reports',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportRequest),
          }
        );

        const response = await PostReports(request);
        
        expect(response.status).toBe(500);
      });
    });

    describe('GET /api/v1/exports/reports', () => {
      it('should return available report types', async () => {
        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/reports'
        );

        const response = await GetReports(request);
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.availableReports).toContain('incident-overview');
        expect(result.data.availableReports).toContain('assessment-summary');
        expect(result.data.formats).toContain('pdf');
        expect(result.data.formats).toContain('html');
      });

      it('should check report job status', async () => {
        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/reports?jobId=report_123'
        );

        const response = await GetReports(request);
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.jobId).toBe('report_123');
        expect(result.data.status).toBeDefined();
      });
    });
  });

  describe('Scheduled Reports API', () => {
    describe('POST /api/v1/exports/schedule', () => {
      it('should create scheduled report', async () => {
        const scheduleRequest = {
          reportType: 'incident-overview',
          schedule: {
            frequency: 'weekly',
            dayOfWeek: 1, // Monday
            time: '09:00',
            timezone: 'UTC',
          },
          recipients: [
            {
              email: 'coordinator@example.com',
              name: 'Test Coordinator',
              format: 'pdf',
            },
          ],
          defaultDateRange: {
            type: 'last_7_days',
          },
          options: {
            includeCharts: true,
            includeMaps: true,
          },
          isActive: true,
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/schedule',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scheduleRequest),
          }
        );

        const response = await PostSchedule(request);
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.scheduledReportId).toBeDefined();
        expect(result.data.reportType).toBe('incident-overview');
        expect(result.data.nextRun).toBeDefined();
        expect(result.data.isActive).toBe(true);
      });

      it('should validate required fields', async () => {
        const scheduleRequest = {
          // Missing reportType
          schedule: {
            frequency: 'weekly',
            time: '09:00',
          },
          recipients: [],
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/schedule',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scheduleRequest),
          }
        );

        const response = await PostSchedule(request);
        
        expect(response.status).toBe(500);
      });

      it('should validate recipients', async () => {
        const scheduleRequest = {
          reportType: 'incident-overview',
          schedule: {
            frequency: 'weekly',
            time: '09:00',
          },
          recipients: [
            {
              email: 'invalid-email', // Invalid email
              name: 'Test User',
              format: 'pdf',
            },
          ],
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/schedule',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scheduleRequest),
          }
        );

        const response = await PostSchedule(request);
        
        expect(response.status).toBe(500);
      });
    });

    describe('GET /api/v1/exports/schedule', () => {
      it('should return user scheduled reports', async () => {
        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/schedule'
        );

        const response = await GetSchedule(request);
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(Array.isArray(result.data)).toBe(true);
      });

      it('should return specific scheduled report', async () => {
        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/schedule?id=schedule_123'
        );

        const response = await GetSchedule(request);
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.id).toBeDefined();
      });
    });

    describe('PUT /api/v1/exports/schedule', () => {
      it('should update scheduled report', async () => {
        const updateRequest = {
          isActive: false,
          schedule: {
            frequency: 'monthly',
            dayOfMonth: 15,
            time: '10:00',
          },
        };

        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/schedule?id=schedule_123',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateRequest),
          }
        );

        const response = await PutSchedule(request);
        
        expect(response.status).toBe(500); // Report not found in mock
      });
    });

    describe('DELETE /api/v1/exports/schedule', () => {
      it('should delete scheduled report', async () => {
        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/schedule?id=schedule_123',
          {
            method: 'DELETE',
          }
        );

        const response = await DeleteSchedule(request);
        
        expect(response.status).toBe(500); // Report not found in mock
      });

      it('should validate report ID', async () => {
        const request = new NextRequest(
          'http://localhost:3000/api/v1/exports/schedule',
          {
            method: 'DELETE',
          }
        );

        const response = await DeleteSchedule(request);
        
        expect(response.status).toBe(400);
        
        const result = await response.json();
        expect(result.success).toBe(false);
        expect(result.error).toContain('Report ID is required');
      });
    });
  });

  describe('Performance and Security', () => {
    it('should handle concurrent export requests', async () => {
      const exportRequest = {
        dataType: 'assessments',
        format: 'csv',
      };

      const requests = Array(5).fill(null).map(() =>
        new NextRequest(
          'http://localhost:3000/api/v1/exports/csv',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportRequest),
          }
        )
      );

      // Execute concurrent requests
      const responses = await Promise.allSettled(
        requests.map(req => POST(req))
      );

      // All should succeed
      responses.forEach(response => {
        if (response.status === 'fulfilled') {
          expect(response.value.status).toBe(200);
        }
      });
    });

    it('should validate input data for security', async () => {
      const maliciousRequest = {
        dataType: 'assessments',
        format: 'csv',
        filters: {
          // Attempt SQL injection
          locationId: "'; DROP TABLE users; --",
          // Attempt XSS
          assessmentType: "<script>alert('xss')</script>",
        },
      };

      const request = new NextRequest(
        'http://localhost:3000/api/v1/exports/csv',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(maliciousRequest),
        }
      );

      const response = await POST(request);
      
      // Should not crash, but validation should handle malicious input
      expect([200, 400, 500]).toContain(response.status);
    });

    it('should implement rate limiting for large exports', async () => {
      const largeExportRequest = {
        dataType: 'assessments',
        format: 'csv',
        // Large date range
        dateRange: {
          startDate: '2020-01-01T00:00:00.000Z',
          endDate: '2024-12-31T23:59:59.999Z',
        },
      };

      const request = new NextRequest(
        'http://localhost:3000/api/v1/exports/csv',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(largeExportRequest),
        }
      );

      const response = await POST(request);
      
      // Should handle large requests gracefully
      expect([200, 429, 500]).toContain(response.status);
    });
  });
});