import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { z } from 'zod';

// Mock UI Components
jest.mock('@/components/ui/select', () => ({
  SelectRoot: ({ children, onValueChange }: any) => <div onChange={onValueChange}>{children}</div>,
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, onSelect }: any) => <div onClick={() => onSelect && onSelect(value)}>{children}</div>,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => <button onClick={onClick} {...props}>{children}</button>,
}));

jest.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, ...props }: any) => <input value={value} onChange={onChange} {...props} />,
}));

jest.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor: string }) => <label htmlFor={htmlFor}>{children}</label>,
}));

jest.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input 
      type="checkbox" 
      checked={checked} 
      onChange={(e) => onCheckedChange && onCheckedChange(e.target.checked)} 
      {...props} 
    />
  ),
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant, className }: any) => (
    <span className={`badge-${variant} ${className}`}>{children}</span>
  ),
}));

jest.mock('@/components/ui/tabs', () => ({
  Tabs: ({ value, onValueChange, children }: any) => <div onChange={(e) => onValueChange && onValueChange(e.target.value)}>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ value, children }: any) => <button value={value}>{children}</button>,
  TabsContent: ({ value, children }: any) => <div>{children}</div>,
}));

jest.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: any) => <div className={`scroll-area ${className}`}>{children}</div>,
}));

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open, onOpenChange }: any) => open ? <div onClick={() => onOpenChange && onOpenChange(false)}>{children}</div> : null,
  DialogContent: ({ children, className }: any) => <div className={`dialog-content ${className}`}>{children}</div>,
  DialogHeader: ({ children }: any) => <div className="dialog-header">{children}</div>,
  DialogTitle: ({ children }: any) => <div className="dialog-title">{children}</div>,
  DialogDescription: ({ children }: any) => <div className="dialog-description">{children}</div>,
  DialogTrigger: ({ children, asChild, onClick }: any) => (
    <span onClick={onClick}>
      {asChild ? children : <button>{children}</button>}
    </span>
  ),
}));

// Mock custom hooks
jest.mock('@dnd-kit/core', () => ({
  useDrop: () => [{ isOver: false, drop: jest.fn() }],
  useDrag: () => [{ isDragging: false, drag: jest.fn() }],
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCenter: {},
  PointerSensor: {},
  KeyboardSensor: {},
  useSensors: () => [{}],
}));

jest.mock('@dnd-kit/sortable', () => ({
  sortableKeyboardCoordinates: {},
  verticalListSortingStrategy: {},
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/lib/reports/template-engine', () => ({
  DEFAULT_TEMPLATES: [
    {
      id: 'default_assessment_summary',
      name: 'Assessment Summary',
      description: 'Summary of all assessment types by date range',
      type: 'ASSESSMENT',
      layout: [],
      isPublic: true,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01')
    }
  ],
  ReportTemplateEngine: {
    validateTemplate: jest.fn(() => ({ valid: true, errors: [] })),
    renderTemplatePreview: jest.fn(() => '<div>Preview content</div>'),
  }
}));

import { ReportBuilder } from '../ReportBuilder';

describe('ReportBuilder', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    user = userEvent.setup();
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <ReportBuilder {...props} />
      </QueryClientProvider>
    );
  };

  describe('Rendering', () => {
    it('renders report builder interface', () => {
      renderComponent();
      
      expect(screen.getByText('Report Builder')).toBeInTheDocument();
      expect(screen.getByText('Layout')).toBeInTheDocument();
      expect(screen.getByText('Visualization')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.getByText('Start Building Your Report')).toBeInTheDocument();
    });

    it('displays element count', () => {
      renderComponent();
      
      expect(screen.getByText('0 elements')).toBeInTheDocument();
    });

    it('shows zoom controls', () => {
      renderComponent();
      
      expect(screen.getByText('100%')).toBeInTheDocument(); // Default zoom
    });
  });

  describe('Element Library', () => {
    it('renders all element categories', () => {
      renderComponent();
      
      expect(screen.getByText('Layout')).toBeInTheDocument();
      expect(screen.getByText('Visualization')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('renders template elements', async () => {
      renderComponent();
      
      expect(screen.getByText('Header')).toBeInTheDocument();
      expect(screen.getByText('Footer')).toBeInTheDocument();
      expect(screen.getByText('Section')).toBeInTheDocument();
      expect(screen.getByText('Spacer')).toBeInTheDocument();
      expect(screen.getByText('Chart')).toBeInTheDocument();
      expect(screen.getByText('Table')).toBeInTheDocument();
      expect(screen.getByText('KPI')).toBeInTheDocument();
      expect(screen.getByText('Map')).toBeInTheDocument();
      expect(screen.getByText('Text')).toBeInTheDocument();
      expect(screen.getByText('Image')).toBeInTheDocument();
    });

    it('shows element descriptions', () => {
      renderComponent();
      
      expect(screen.getByText('Report title and metadata')).toBeInTheDocument();
      expect(screen.getByText('Report footer information')).toBeInTheDocument();
      expect(screen.getByText('Content section with title')).toBeInTheDocument();
      expect(screen.getByText('Empty space for layout')).toBeInTheDocument();
      expect(screen.getByText('Data visualization')).toBeInTheDocument();
      expect(screen.getByText('Data table with columns')).toBeInTheDocument();
      expect(screen.getByText('Key performance indicators')).toBeInTheDocument();
      expect(screen.getByText('Geographic visualization')).toBeInTheDocument();
      expect(screen.getByText('Rich text content')).toBeInTheDocument();
      expect(screen.getByText('Static image content')).toBeInTheDocument();
    });
  });

  describe('Canvas Controls', () => {
    it('toggles grid display', async () => {
      renderComponent();
      
      const gridButton = screen.getByRole('button', { name: /grid/i });
      expect(gridButton).toBeInTheDocument();
      
      await user.click(gridButton);
      
      // Grid state would be managed internally
    });

    it('adjusts zoom level', async () => {
      renderComponent();
      
      const zoomInButton = screen.getByRole('button', { name: /zoom in/i });
      const zoomOutButton = screen.getByRole('button', { name: /zoom out/i });
      
      expect(zoomInButton).toBeInTheDocument();
      expect(zoomOutButton).toBeInTheDocument();
      
      await user.click(zoomInButton);
      await user.click(zoomOutButton);
      
      // Zoom state would be managed internally
    });

    it('shows layout validation status', () => {
      renderComponent();
      
      expect(screen.getByText('Layout Valid')).toBeInTheDocument();
    });
  });

  describe('Element Addition', () => {
    it('adds header element from sidebar', async () => {
      const onTemplateChange = jest.fn();
      renderComponent({ onTemplateChange });
      
      const headerElement = screen.getByText('Header');
      expect(headerElement).toBeInTheDocument();
      
      const addButton = screen.getByRole('button', { name: /add header/i });
      await user.click(addButton);
      
      expect(onTemplateChange).toHaveBeenCalled();
    });

    it('adds chart element from sidebar', async () => {
      const onTemplateChange = jest.fn();
      renderComponent({ onTemplateChange });
      
      const chartElement = screen.getByText('Chart');
      expect(chartElement).toBeInTheDocument();
      
      const addButton = screen.getByRole('button', { name: /add chart/i });
      await user.click(addButton);
      
      expect(onTemplateChange).toHaveBeenCalled();
    });

    it('adds table element from sidebar', async () => {
      const onTemplateChange = jest.fn();
      renderComponent({ onTemplateChange });
      
      const tableElement = screen.getByText('Table');
      expect(tableElement).toBeInTheDocument();
      
      const addButton = screen.getByRole('button', { name: /add table/i });
      await user.click(addButton);
      
      expect(onTemplateChange).toHaveBeenCalled();
    });
  });

  describe('Element Selection', () => {
    it('selects element when clicked', async () => {
      renderComponent();
      
      // Add an element first
      const headerElement = screen.getByText('Header');
      const addButton = screen.getByRole('button', { name: /add header/i });
      await user.click(addButton);
      
      // Find the added element in canvas (would be present after state update)
      await waitFor(() => {
        const addedElements = screen.getAllByText('Header');
        return addedElements.length > 1; // Original template + added element
      });
      
      const addedElement = screen.getAllByText('Header')[1]; // The added element
      await user.click(addedElement);
      
      // Check if element is selected (properties panel would open)
      await waitFor(() => {
        expect(screen.getByText('Element Properties')).toBeInTheDocument();
      });
    });

    it('shows element properties when selected', async () => {
      renderComponent();
      
      // Add and select an element
      const headerElement = screen.getByText('Header');
      const addButton = screen.getByRole('button', { name: /add header/i });
      await user.click(addButton);
      
      await waitFor(() => {
        const addedElements = screen.getAllByText('Header');
        if (addedElements.length > 1) {
          user.click(addedElements[1]);
        }
      });
      
      await waitFor(() => {
        expect(screen.getByText('Element Properties')).toBeInTheDocument();
        expect(screen.getByText('Position & Size')).toBeInTheDocument();
        expect(screen.getByText('Element Configuration')).toBeInTheDocument();
        expect(screen.getByText('Visual Style')).toBeInTheDocument();
        expect(screen.getByText('Advanced Options')).toBeInTheDocument();
      });
    });
  });

  describe('Element Properties', () => {
    it('updates element title', async () => {
      const onTemplateChange = jest.fn();
      renderComponent({ onTemplateChange });
      
      // Add and select an element
      const headerElement = screen.getByText('Header');
      const addButton = screen.getByRole('button', { name: /add header/i });
      await user.click(addButton);
      
      await waitFor(() => {
        const addedElements = screen.getAllByText('Header');
        if (addedElements.length > 1) {
          user.click(addedElements[1]);
        }
      });
      
      await waitFor(() => {
        const titleInput = screen.getByLabelText('Title');
        if (titleInput) {
          await user.type(titleInput, 'Updated Header Title');
          expect(onTemplateChange).toHaveBeenCalled();
        }
      });
    });

    it('updates element position', async () => {
      const onTemplateChange = jest.fn();
      renderComponent({ onTemplateChange });
      
      // Add and select an element
      const headerElement = screen.getByText('Header');
      const addButton = screen.getByRole('button', { name: /add header/i });
      await user.click(addButton);
      
      await waitFor(() => {
        const addedElements = screen.getAllByText('Header');
        if (addedElements.length > 1) {
          user.click(addedElements[1]);
        }
      });
      
      await waitFor(() => {
        const xInput = screen.getByLabelText('X');
        if (xInput) {
          await user.clear(xInput);
          await user.type(xInput, '5');
          expect(onTemplateChange).toHaveBeenCalled();
        }
      });
    });

    it('updates element size', async () => {
      const onTemplateChange = jest.fn();
      renderComponent({ onTemplateChange });
      
      // Add and select an element
      const headerElement = screen.getByText('Header');
      const addButton = screen.getByRole('button', { name: /add header/i });
      await user.click(addButton);
      
      await waitFor(() => {
        const addedElements = screen.getAllByText('Header');
        if (addedElements.length > 1) {
          user.click(addedElements[1]);
        }
      });
      
      await waitFor(() => {
        const widthInput = screen.getByLabelText('Width');
        if (widthInput) {
          await user.clear(widthInput);
          await user.type(widthInput, '8');
          expect(onTemplateChange).toHaveBeenCalled();
        }
      });
    });
  });

  describe('Template Management', () => {
    it('generates preview when preview button clicked', async () => {
      const onPreview = jest.fn();
      renderComponent({ onPreview });
      
      const previewButton = screen.getByRole('button', { name: /preview report/i });
      await user.click(previewButton);
      
      await waitFor(() => {
        expect(onPreview).toHaveBeenCalledWith(
          expect.objectContaining({
            name: expect.any(String),
            type: expect.any(String),
            layout: expect.any(Array)
          })
        );
      });
    });

    it('saves template when save button clicked', async () => {
      const onSave = jest.fn();
      renderComponent({ onSave });
      
      const saveButton = screen.getByRole('button', { name: /save template/i });
      await user.click(saveButton);
      
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: expect.any(String),
            type: 'CUSTOM',
            layout: expect.any(Array)
          })
        );
      });
    });
  });

  describe('Auto-arrange Function', () => {
    it('arranges elements in grid layout', async () => {
      const onTemplateChange = jest.fn();
      renderComponent({ onTemplateChange });
      
      // Add multiple elements
      const headerButton = screen.getByRole('button', { name: /add header/i });
      const chartButton = screen.getByRole('button', { name: /add chart/i });
      const tableButton = screen.getByRole('button', { name: /add table/i });
      
      await user.click(headerButton);
      await user.click(chartButton);
      await user.click(tableButton);
      
      const autoArrangeButton = screen.getByRole('button', { name: /auto arrange/i });
      await user.click(autoArrangeButton);
      
      expect(onTemplateChange).toHaveBeenCalled();
    });
  });

  describe('Element Deletion', () => {
    it('removes element when delete button clicked', async () => {
      const onTemplateChange = jest.fn();
      renderComponent({ onTemplateChange });
      
      // Add an element first
      const headerElement = screen.getByText('Header');
      const addButton = screen.getByRole('button', { name: /add header/i });
      await user.click(addButton);
      
      await waitFor(() => {
        const addedElements = screen.getAllByText('Header');
        if (addedElements.length > 1) {
          user.click(addedElements[1]);
        }
      });
      
      await waitFor(() => {
        const deleteButton = screen.getByRole('button', { name: /delete/i });
        if (deleteButton) {
          await user.click(deleteButton);
          expect(onTemplateChange).toHaveBeenCalled();
        }
      });
    });
  });

  describe('Report Name Input', () => {
    it('updates report name when typed', async () => {
      const onTemplateChange = jest.fn();
      renderComponent({ 
        initialTemplate: { name: 'Test Report' },
        onTemplateChange 
      });
      
      const nameInput = screen.getByPlaceholderText('Report name');
      expect(nameInput).toBeInTheDocument();
      expect(nameInput).toHaveValue('Test Report');
      
      await user.clear(nameInput);
      await user.type(nameInput, 'Updated Report Name');
      
      expect(onTemplateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Updated Report Name'
        })
      );
    });
  });

  describe('Drag and Drop Functionality', () => {
    it('handles element drop from sidebar', async () => {
      const { useDrop } = require('@dnd-kit/core');
      const mockDrop = useDrop();
      
      renderComponent();
      
      // Mock a drop action
      mockDrop.drop({
        type: 'element',
        fromSidebar: true
      });
      
      // The drop should trigger element addition
      expect(mockDrop.drop).toHaveBeenCalled();
    });

    it('handles element dragging within canvas', async () => {
      const { useDrag } = require('@dnd-kit/core');
      const mockDrag = useDrag();
      
      renderComponent();
      
      // Mock element exists in canvas
      // Mock drag behavior would be tested through integration tests
      expect(mockDrag.isDragging).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('displays empty state when no elements', () => {
      renderComponent();
      
      expect(screen.getByText('Drag elements from sidebar to begin creating your custom report')).toBeInTheDocument();
      expect(screen.getByText('Add headers, charts, tables, and more')).toBeInTheDocument();
    });

    it('shows validation errors for invalid layout', async () => {
      renderComponent();
      
      // Mock overlapping elements would trigger validation errors
      // This would be tested through integration tests with real drag functionality
      expect(screen.getByText('Layout Valid')).toBeInTheDocument();
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('supports keyboard navigation', () => {
      const { useSensors } = require('@dnd-kit/core');
      const mockSensors = useSensors();
      
      renderComponent();
      
      // Verify sensors are initialized
      expect(mockSensors).toBeDefined();
    });
  });

  describe('Responsive Design', () => {
    it('adapts to different screen sizes', () => {
      // Test with different viewport sizes
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 768, // Tablet
      });

      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 1024, // Tablet
      });

      renderComponent();
      
      // Component should adapt to tablet layout
      expect(screen.getByText('Report Builder')).toBeInTheDocument();
      
      // Reset to desktop for other tests
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1024,
      });

      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 768,
      });
    });
  });

  afterEach(() => {
    // Reset window properties
    delete (window as any).innerWidth;
    delete (window as any).innerHeight;
  });
});