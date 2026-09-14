import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { z } from 'zod';
import { CreateConfigurationSchema, ReportFiltersSchema } from '@/lib/reports/data-aggregator';
import { createApiResponse } from '@/types/api';

// Test data
const mockReportTemplate = {
  id: 'test-template-1',
  name: 'Test Template',
  description: 'Test template for integration tests',
  type: 'ASSESSMENT',
  layout: [
    {
      id: 'header-1',
      type: 'header',
      position: { x: 0, y: 0, width: 12, height: 1 },
      config: { title: 'Assessment Report', showDate: true }
    },
    {
      id: 'chart-1',
      type: 'chart',
      position: { x: 0, y: 1, width: 6, height: 4 },
      config: { chartType: 'pie', title: 'Assessment Types' },
      visualization: {
        type: 'pie',
        config: { xAxis: 'rapidAssessmentType', labelField: 'rapidAssessmentType' }
      }
    }
  ],
  createdById: 'test-user-id',
  isPublic: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01')
};

const mockReportConfiguration = {
  id: 'test-config-1',
  templateId: 'test-template-1',
  name: 'Test Configuration',
  description: 'Test configuration for integration tests',
  filters: {
    dateRange: {
      field: 'createdAt',
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    },
    filters: [],
    aggregations: [],
    search: '',
    orderBy: { field: 'createdAt', direction: 'desc' },
    limit: 100
  },
  aggregations: [
    {
      id: 'agg-1',
      field: 'rapidAssessmentType',
      function: 'count',
      groupBy: ['rapidAssessmentType'],
      alias: 'assessmentCount'
    }
  ],
  visualizations: [],
  schedule: {
    frequency: 'once',
    startDate: '2024-01-01',
    enabled: true
  },
  isPublic: false,
  createdBy: 'test-user-id',
  createdAt: new Date('2024-01-01')
};

const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  name: 'Test User'
};

const server = setupServer(
  rest.get('/api/v1/reports/templates', (req, res, ctx) => {
    const url = new URL(req.url, 'http://localhost:3000');
    const search = url.searchParams.get('search');
    const type = url.searchParams.get('type');
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');

    let templates = [mockReportTemplate];

    if (search) {
      templates = templates.filter(t => 
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description?.toLowerCase().includes(search.toLowerCase())
      );
    }

    if (type) {
      templates = templates.filter(t => t.type === type);
    }

    const startIndex = (page - 1) * limit;
    const paginatedTemplates = templates.slice(startIndex, startIndex + limit);

    return res(
      ctx.status(200),
      ctx.json(createApiResponse(true, {
        templates: paginatedTemplates,
        pagination: {
          page,
          limit,
          total: templates.length,
          pages: Math.ceil(templates.length / limit),
        }
      }, 'Templates retrieved successfully')
    );
  }),

  rest.get('/api/v1/reports/templates/:id', (req, res, ctx) => {
    if (req.params.id === 'test-template-1') {
      return res(
        ctx.status(200),
        ctx.json(createApiResponse(true, mockReportTemplate, 'Template retrieved successfully'))
      );
    }

    return res(
      ctx.status(404),
      ctx.json(createApiResponse(false, null, 'Template not found'))
    );
  }),

  rest.post('/api/v1/reports/templates', (req, res, ctx) => {
    return res(
      ctx.status(201),
      ctx.json(createApiResponse(true, {
        ...mockReportTemplate,
        id: 'new-template-id'
      }, 'Template created successfully'))
    );
  }),

  rest.get('/api/v1/reports/configurations', (req, res, ctx) => {
    const url = new URL(req.url, 'http://localhost:3000');
    const search = url.searchParams.get('search');
    const status = url.searchParams.get('status');
    const page = parseInt(url.searchParams.get('page') || '1');

    let configurations = [mockReportConfiguration];

    if (search) {
      configurations = configurations.filter(c => 
        c.name.toLowerCase().includes(search.toLowerCase())
      );
    }

    if (status) {
      configurations = configurations.filter(c => {
        // Simulate status filter
        return true;
      });
    }

    const startIndex = (page - 1) * 20;
    const paginatedConfigurations = configurations.slice(startIndex, startIndex + 20);

    return res(
      ctx.status(200),
      ctx.json(createApiResponse(true, {
        configurations: paginatedConfigurations,
        pagination: {
          page,
          limit: 20,
          total: configurations.length,
          pages: Math.ceil(configurations.length / 20)
        }
      }, 'Configurations retrieved successfully'))
    );
  }),

  rest.post('/api/v1/reports/configurations', (req, res, ctx) => {
    return res(
      ctx.status(201),
      ctx.json(createApiResponse(true, {
        ...mockReportConfiguration,
        id: 'new-config-id'
      }, 'Configuration created successfully'))
    );
  }),

  rest.get('/api/v1/reports/configurations/:id', (req, res, ctx) => {
    if (req.params.id === 'test-config-1') {
      return res(
        ctx.status(200),
        ctx.json(createApiResponse(true, mockReportConfiguration, 'Configuration retrieved successfully'))
      );
    }

    return res(
      ctx.status(404),
      ctx.json(createApiResponse(false, null, 'Configuration not found'))
    );
  }),

  rest.post('/api/v1/reports/generate', (req, res, ctx) => {
    return res(
      ctx.status(202),
      ctx.json(createApiResponse(true, {
        executionId: 'test-execution-id',
        jobId: 'test-job-id',
        status: 'PENDING',
        format: 'PDF',
        estimatedTime: 30,
        message: 'Report generation initiated'
      }, 'Report generation started'))
    );
  }),

  rest.get('/api/v1/reports/executions/:id', (req, res, ctx) => {
    const status = url.searchParams.get('status') || 'completed';

    return res(
      ctx.status(200),
      ctx.json(createApiResponse(true, {
        execution: {
          id: req.params.id,
          status: status.toUpperCase(),
          format: 'PDF',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          generatedAt: status === 'completed' ? new Date() : null,
          filePath: status === 'completed' ? '/reports/test-execution-id.pdf' : null,
          error: null
        },
        configuration: mockReportConfiguration,
        progress: getProgressData(status)
      }, 'Execution status retrieved successfully'))
    );
  }),

  rest.delete('/api/v1/reports/executions/:id', (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json(createApiResponse(true, null, 'Report execution cancelled successfully'))
    );
  }),

  rest.get('/api/v1/reports/download/:id', (req, res, ctx) => {
    const id = req.params.id;
    
    if (id === 'test-execution-id') {
      return res(
        ctx.status(200),
        ctx.set('Content-Type', 'application/pdf'),
        ctx.set('Content-Disposition', 'inline; filename="test-report.pdf"'),
        ctx.body('Mock PDF content for test')
      );
    }

    return res(
      ctx.status(404),
      ctx.json(createApiResponse(false, null, 'Report file not found'))
    );
  }
);

function getProgressData(status: string): any {
  switch (status) {
    case 'pending':
      return { percent: 0, status: 'PENDING', message: 'Report is queued for generation...' };
    case 'running':
      return { percent: 45, status: 'RUNNING', message: 'Generating PDF report... 45%' };
    case 'completed':
      return { percent: 100, status: 'COMPLETED', message: 'Report generation completed successfully' };
    case 'failed':
      return { percent: 0, status: 'FAILED', message: 'Report generation failed' };
    default:
      return { percent: 0, status: 'UNKNOWN', message: 'Unknown status' };
  }
}

// Test utilities
const createTestQueryClient = () => {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
};

const renderWithQueryClient = (component: React.ReactElement, options = {}) => {
  const queryClient = createTestQueryClient();
  
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>,
    options
  );
};

describe('Reports API Integration Tests', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('Template Management', () => {
    describe('GET /api/v1/reports/templates', () => {
      it('retrieves templates list successfully', async () => {
        const TemplatesPage = require('@/components/reports/builder/TemplateSelector').default;
        
        renderWithQueryClient(<TemplatesPage />);
        
        await waitFor(() => {
          expect(screen.getByText('Report Templates')).toBeInTheDocument();
          expect(screen.getByText('Test Template')).toBeInTheDocument();
        });
      });

      it('filters templates by search term', async () => {
        const TemplatesPage = require('@/components/reports/builder/TemplateSelector').default;
        
        renderWithQueryClient(
          <TemplatesPage />,
          { initialProps: { search: 'Test' } }
        });
        
        await waitFor(() => {
          expect(screen.getByText('Test Template')).toBeInTheDocument();
        });
      });

      it('filters templates by type', async () => {
        const TemplatesPage = require('@/components/reports/builder/TemplateSelector').default;
        
        renderWithQueryClient(
          <TemplatesPage />,
          { initialProps: { templateType: 'ASSESSMENT' } }
        );
        
        await waitFor(() => {
          expect(screen.getByText('ASSESSMENT')).toBeInTheDocument();
        });
      });

      it('handles pagination correctly', async () => {
        const TemplatesPage = require('@/components/reports/builder/TemplateSelector').default;
        
        renderWithQueryClient(<TemplatesPage />);
        
        await waitFor(() => {
          expect(screen.getByText('Showing 1-1 of 1')).toBeInTheDocument();
        });
      });

      it('handles empty search results', async () => {
        const TemplatesPage = require('@/components/reports/builder/TemplateSelector').default;
        
        renderWithQueryClient(
          <TemplatesPage />,
          { initialProps: { search: 'NonExistentTemplate' } }
        );
        
        await waitFor(() => {
          expect(screen.getByText('No templates found')).toBeInTheDocument();
          expect(screen.getByText('Try adjusting your filters or create a new template')).toBeInTheDocument();
        });
      });
    });

    describe('POST /api/v1/reports/templates', () => {
      it('creates new template successfully', async () => {
        const CreateTemplatePage = require('@/components/reports/builder/ReportBuilder').default;
        
        const mockOnSave = jest.fn();
        
        renderWithQueryClient(
          <CreateTemplatePage onSave={mockOnSave} />
        );
        
        // Mock template data
        const templateData = {
          name: 'New Test Template',
          type: 'CUSTOM',
          layout: [{
            id: 'element-1',
            type: 'header',
            position: { x: 0, y: 0, width: 12, height: 1 },
            config: { title: 'New Report Header' }
          }]
        };
        
        // Trigger save
        const saveButton = screen.getByText('Save Template');
        await userEvent.click(saveButton);
        
        await waitFor(() => {
          expect(mockOnSave).toHaveBeenCalledWith(
            expect.objectContaining({
              name: 'New Test Template',
              type: 'CUSTOM'
            })
          );
        });
      });

      it('validates required fields', async () => {
        const response = await fetch('/api/v1/reports/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });

        expect(response.status).toBe(400);
        
        const result = await response.json();
        expect(result.success).toBe(false);
        expect(result.errors).toContain('Template name is required');
      });

      it('validates layout structure', async () => {
        const response = await fetch('/api/v1/reports/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Test Template',
            type: 'CUSTOM',
            layout: [] // Empty layout should fail validation
          })
        });

        expect(response.status).toBe(400);
        
        const result = await response.json();
        expect(result.success).toBe(false);
        expect(result.errors).toContain('Template must have at least one layout element');
      });
    });

    describe('GET /api/v1/reports/templates/:id', () => {
      it('retrieves specific template', async () => {
        const response = await fetch('/api/v1/reports/templates/test-template-1');
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.name).toBe('Test Template');
        expect(result.data.type).toBe('ASSESSMENT');
      });

      it('handles non-existent template', async () => {
        const response = await fetch('/api/v1/reports/templates/non-existent');
        
        expect(response.status).toBe(404);
        
        const result = await response.json();
        expect(result.success).toBe(false);
        expect(result.message).toContain('Template not found');
      });
    });
  });

  describe('Configuration Management', () => {
    describe('GET /api/v1/reports/configurations', () => {
      it('retrieves configurations list', async () => {
        const ManagementPage = require('@/components/reports/ReportManagement').default;
        
        renderWithQueryClient(<ManagementPage />);
        
        await waitFor(() => {
          expect(screen.getByText('Test Configuration')).toBeInTheDocument();
          expect(screen.getByText('Total Configurations')).toBeInTheDocument();
        });
      });

      it('filters configurations by search', async () => {
        const ManagementPage = require('@/components/reports/ReportManagement').default;
        
        renderWithQueryClient(
          <ManagementPage />,
          { initialProps: { search: 'Test' } }
        );
        
        await waitFor(() => {
          expect(screen.getByText('Test Configuration')).toBeInTheDocument();
        });
      });

      it('handles status filtering', async () => {
        const ManagementPage = require('@/components/reports/ReportManagement').default;
        
        renderWithQueryClient(
          <ManagementPage />,
          { initialProps: { statusFilter: 'completed' } }
        );
        
        await waitFor(() => {
          expect(screen.getByText('COMPLETED')).toBeInTheDocument();
        });
      });
    });

    describe('POST /api/v1/reports/configurations', () => {
      it('creates new configuration', async () => {
        const configData = {
          templateId: 'test-template-1',
          name: 'Test Configuration',
          filters: {
            dateRange: {
              field: 'createdAt',
              startDate: '2024-01-01',
              endDate: '2024-01-31'
            }
          },
          aggregations: [{
            id: 'agg-1',
            field: 'rapidAssessmentType',
            function: 'count'
          }],
          visualizations: []
        };

        const response = await fetch('/api/v1/reports/configurations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(configData)
        });

        expect(response.status).toBe(201);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.name).toBe('Test Configuration');
      });

      it('validates required fields', async () => {
        const response = await fetch('/api/v1/reports/configurations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });

        expect(response.status).toBe(400);
        
        const result = await response.json();
        expect(result.success).toBe(false);
        expect(result.errors).toContain('Template ID is required');
      });
    });

    describe('GET /api/v1/reports/configurations/:id', () => {
      it('retrieves specific configuration', async () => {
        const response = await fetch('/api/v1/reports/configurations/test-config-1');
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.name).toBe('Test Configuration');
      });

      it('handles non-existent configuration', async () => {
        const response = await fetch('/api/v1/reports/configurations/non-existent');
        
        expect(response.status).toBe(404);
        
        const result = await response.json();
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Report Generation', () => {
    describe('POST /api/v1/reports/generate', () => {
      it('initiates report generation', async () => {
        const generateData = {
          configurationId: 'test-config-1',
          format: 'PDF',
          options: {
            includeHeaders: true,
            pageSize: 'A4'
          }
        };

        const response = await fetch('/api/v1/reports/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(generateData)
        });

        expect(response.status).toBe(202);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.executionId).toBe('test-execution-id');
        expect(result.data.status).toBe('PENDING');
      });

      it('validates request format', async () => {
        const response = await fetch('/api/v1/reports/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });

        expect(response.status).toBe(401);
      });
    });

    describe('GET /api/v1/reports/executions/:id', () => {
      it('retrieves execution status', async () => {
        const response = await fetch('/api/v1/reports/executions/test-execution-id');
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.execution.status).toBe('COMPLETED');
        expect(result.data.progress.percent).toBe(100);
      });

      it('shows running progress', async () => {
        const response = await fetch('/api/v1/reports/executions/test-execution-id?status=running');
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.execution.status).toBe('RUNNING');
        expect(result.data.progress.percent).toBeGreaterThan(0);
        expect(result.data.progress.percent).toBeLessThan(100);
      });

      it('calculates progress correctly', async () => {
        const response = await fetch('/api/v1/reports/executions/test-execution-id?status=pending');
        
        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.data.progress.percent).toBe(0);
        expect(result.data.progress.status).toBe('PENDING');
      });
    });

    describe('DELETE /api/v1/reports/executions/:id', () => {
      it('cancels running execution', async () => {
        const response = await fetch('/api/v1/reports/executions/test-execution-id', {
          method: 'DELETE'
        });

        expect(response.status).toBe(200);
        
        const result = await response.json();
        expect(result.success).toBe(true);
        expect(result.message).toContain('cancelled successfully');
      });
    });

    describe('GET /api/v1/reports/download/:id', () => {
      it('downloads completed report', async () => {
        const response = await fetch('/api/v1/reports/download/test-execution-id?status=completed');
        
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/pdf');
        expect(response.headers.get('Content-Disposition')).toContain('inline; filename="test-report.pdf"');
      });

      it('returns error for non-existent file', async () => {
        const response = await fetch('/api/v1/reports/download/non-existent');
        
        expect(response.status).toBe(404);
        
        const result = await response.json();
        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
      });

      it('handles different formats', async () => {
        const formats = ['PDF', 'CSV', 'HTML', 'EXCEL'];
        
        for (const format of formats) {
          const response = await fetch(`/api/v1/reports/download/test-execution-id?format=${format.toLowerCase()}&status=completed`);
          
          expect(response.status).toBe(200);
          
          const expectedTypes: Record<string, string> = {
            pdf: 'application/pdf',
            csv: 'text/csv',
            html: 'text/html',
            excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          };
          
          expect(response.headers.get('Content-Type')).toBe(expectedTypes[format.toLowerCase()]);
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('handles authentication errors', async () => {
      // Simulate no session
      global.fetch = jest.fn(() =>
        Promise.resolve({
          status: 401,
          json: () => Promise.resolve(createApiResponse(false, null, 'Unauthorized'))
        })
      );

      const response = await fetch('/api/v1/reports/templates');
      
      expect(response.status).toBe(401);
      
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.message).toBe('Unauthorized');
    });

    it('handles validation errors consistently', async () => {
      const invalidData = { invalidField: 'invalid' };
      
      const responses = await Promise.all([
        fetch('/api/v1/reports/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidData)
        }),
        fetch('/api/v1/reports/configurations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidData)
        }),
        fetch('/api/v1/reports/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidData)
        })
      ]);

      for (const response of responses) {
        expect(response.status).toBe(400);
        
        const result = await response.json();
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      }
    });

    it('handles server errors gracefully', async () => {
      // Simulate server error
      server.use(
        rest.post('/api/v1/reports/templates', (req, res, ctx) => {
          return res(
            ctx.status(500),
            ctx.json(createApiResponse(false, null, 'Internal server error'))
          );
        })
      );

      const response = await fetch('/api/v1/reports/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Valid Template',
          type: 'CUSTOM',
          layout: [{
            id: 'element-1',
            type: 'header',
            position: { x: 0, y: 0, width: 12, height: 1 },
            config: { title: 'Test' }
          }]
        })
      });

      expect(response.status).toBe(500);
      
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.message).toBe('Internal server error');
    });
  });

  describe('Data Flow Integration', () => {
    it('maintains data consistency across endpoints', async () => {
      // Create template
      const templateResponse = await fetch('/api/v1/reports/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockReportTemplate)
      });

      expect(templateResponse.status).toBe(201);
      const templateResult = await templateResponse.json();
      const newTemplateId = templateResult.data.id;

      // Create configuration using the template
      const configResponse = await fetch('/api/v1/reports/configurations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: newTemplateId,
          name: 'Integration Test Config',
          filters: {
            dateRange: {
              field: 'createdAt',
              startDate: '2024-01-01',
              endDate: '2024-01-31'
            }
          }
        })
      });

      expect(configResponse.status).toBe(201);
      const configResult = await configResponse.json();
      const newConfigId = configResult.data.id;

      // Generate report using the configuration
      const generateResponse = await fetch('/api/v1/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configurationId: newConfigId,
          format: 'PDF'
        })
      });

      expect(generateResponse.status).toBe(202);
      const generateResult = await generateResponse.json();
      const executionId = generateResult.data.executionId;

      // Check execution status
      const executionResponse = await fetch(`/api/v1/reports/executions/${executionId}?status=completed`);
      
      expect(executionResponse.status).toBe(200);
      const executionResult = await executionResponse.json();
      expect(executionResult.success).toBe(true);
      expect(executionResult.data.execution.configurationId).toBe(newConfigId);
    });
  });
});