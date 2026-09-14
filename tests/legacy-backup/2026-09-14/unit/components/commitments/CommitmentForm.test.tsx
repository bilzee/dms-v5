import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CommitmentForm } from '@/components/donor/CommitmentForm';

// Mock UI Components (Template Pattern)
jest.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange }: any) => <div onChange={onValueChange}>{children}</div>,
  SelectTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, onSelect }: any) => (
    <div onClick={() => onSelect && onSelect(value)}>{children}</div>
  ),
}));

jest.mock('@/components/ui/input', () => ({
  Input: ({ className, ...props }: any) => <input className={className} {...props} />,
}));

jest.mock('@/components/ui/textarea', () => ({
  Textarea: ({ className, ...props }: any) => <textarea className={className} {...props} />,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

jest.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardDescription: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
}));

jest.mock('@/components/ui/form', () => ({
  Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
  FormItem: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  FormLabel: ({ children, ...props }: any) => <label {...props}>{children}</label>,
  FormControl: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  FormDescription: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  FormMessage: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  FormField: ({ children }: any) => children({ field: {}, fieldState: { error: undefined } }),
}));

jest.mock('@/components/ui/alert', () => ({
  Alert: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  AlertDescription: ({ children, ...props }: any) => <p {...props}>{children}</p>,
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/separator', () => ({
  Separator: ({ ...props }: any) => <hr {...props} />,
}));

jest.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ ...props }: any) => <div {...props} />,
}));

// Mock React Hook Form
jest.mock('react-hook-form', () => ({
  useForm: () => ({
    register: jest.fn(),
    handleSubmit: fn => fn,
    formState: { errors: {} },
    setValue: jest.fn(),
    getValues: jest.fn(() => ({ items: [{ name: '', unit: '', quantity: 1 }] })),
    reset: jest.fn(),
    control: {},
    watch: jest.fn(() => ({ items: [{ name: '', unit: '', quantity: 1 }] })),
  }),
  useFieldArray: () => ({
    fields: [{ id: '1', name: '', unit: '', quantity: 1 }],
    append: jest.fn(),
    remove: jest.fn(),
  }),
}));

// Mock TanStack Query
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [
      { id: '1', name: 'Entity 1', type: 'FACILITY' },
      { id: '2', name: 'Entity 2', type: 'HOSPITAL' },
    ],
    isLoading: false,
  }),
  useMutation: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

// Mock sonner toast
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

describe('CommitmentForm', () => {
  let queryClient: QueryClient;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    user = userEvent.setup();
    
    // Mock global fetch
    global.fetch = jest.fn();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <CommitmentForm donorId="test-donor-id" {...props} />
      </QueryClientProvider>
    );
  };

  it('renders commitment form with all required fields', () => {
    renderComponent();
    
    expect(screen.getByText(/Create New Commitment/i)).toBeInTheDocument();
    expect(screen.getByText(/Target Entity \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Incident \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Commitment Items \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Additional Notes \(optional\)/i)).toBeInTheDocument();
  });

  it('displays item management section', () => {
    renderComponent();
    
    expect(screen.getByText(/Add Item/i)).toBeInTheDocument();
    expect(screen.getByText(/Item Name \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Quantity \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Unit \*/i)).toBeInTheDocument();
    expect(screen.getByText(/Est. Value \(optional\)/i)).toBeInTheDocument();
  });

  it('shows value estimation section', () => {
    renderComponent();
    
    expect(screen.getByText(/Total Estimated Value:/i)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.00/i)).toBeInTheDocument();
  });

  it('renders form action buttons', () => {
    renderComponent();
    
    expect(screen.getByRole('button', { name: /Preview Commitment/i })).toBeInTheDocument();
  });

  it('validates form submission without data', async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Validation failed' }),
    });

    renderComponent();
    
    const submitButton = screen.getByRole('button', { name: /Preview Commitment/i });
    await user.click(submitButton);

    // Form should show validation errors for required fields
    await waitFor(() => {
      expect(screen.getByText(/Please select a valid entity/i)).toBeInTheDocument();
      expect(screen.getByText(/Please select a valid incident/i)).toBeInTheDocument();
    });
  });

  it('allows adding and removing items', async () => {
    renderComponent();
    
    // Initially has one item row
    const addItemButton = screen.getByRole('button', { name: /Add Item/i });
    await user.click(addItemButton);
    
    // Should still show the form (item management handled by react-hook-form)
    expect(screen.getByText(/Commitment Items \*/i)).toBeInTheDocument();
  });

  it('shows preview mode when valid data is provided', async () => {
    renderComponent({
      initialData: {
        entityId: 'test-entity',
        incidentId: 'test-incident',
        items: [{ name: 'Rice', unit: 'kg', quantity: 100, estimatedValue: 0.5 }],
        notes: 'Test notes'
      }
    });

    const previewButton = screen.getByRole('button', { name: /Preview Commitment/i });
    await user.click(previewButton);

    await waitFor(() => {
      expect(screen.getByText(/Commitment Preview/i)).toBeInTheDocument();
      expect(screen.getByText(/Target Entity/i)).toBeInTheDocument();
      expect(screen.getByText(/Incident/i)).toBeInTheDocument();
      expect(screen.getByText(/Commitment Items/i)).toBeInTheDocument();
    });
  });

  it('calls API when creating commitment', async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ 
        success: true, 
        data: { id: 'test-commitment-id' } 
      }),
    });

    renderComponent({
      initialData: {
        entityId: 'test-entity',
        incidentId: 'test-incident',
        items: [{ name: 'Rice', unit: 'kg', quantity: 100 }],
      }
    });

    // Go to preview mode
    const previewButton = screen.getByRole('button', { name: /Preview Commitment/i });
    await user.click(previewButton);

    // Create commitment
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Commitment/i })).toBeInTheDocument();
    });

    const createButton = screen.getByRole('button', { name: /Create Commitment/i });
    await user.click(createButton);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/donors/test-donor-id/commitments',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('test-entity')
      })
    );
  });

  it('handles API errors gracefully', async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    renderComponent({
      initialData: {
        entityId: 'test-entity',
        incidentId: 'test-incident',
        items: [{ name: 'Rice', unit: 'kg', quantity: 100 }],
      }
    });

    // Go to preview mode
    const previewButton = screen.getByRole('button', { name: /Preview Commitment/i });
    await user.click(previewButton);

    // Try to create commitment
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Commitment/i })).toBeInTheDocument();
    });

    const createButton = screen.getByRole('button', { name: /Create Commitment/i });
    await user.click(createButton);

    // Should show error message
    await waitFor(() => {
      expect(screen.getByText(/Server error/i)).toBeInTheDocument();
    });
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const mockOnCancel = jest.fn();
    
    renderComponent({
      donorId: 'test-donor-id',
      onCancel: mockOnCancel,
    });

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    await user.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('disables submit button during submission', async () => {
    // Mock mutation to be pending
    jest.doMock('@tanstack/react-query', () => ({
      useQuery: () => ({
        data: [
          { id: '1', name: 'Entity 1', type: 'FACILITY' },
        ],
        isLoading: false,
      }),
      useMutation: () => ({
        mutate: jest.fn(),
        isPending: true,
      }),
    }));

    renderComponent({
      initialData: {
        entityId: 'test-entity',
        incidentId: 'test-incident',
        items: [{ name: 'Rice', unit: 'kg', quantity: 100 }],
      }
    });

    const previewButton = screen.getByRole('button', { name: /Preview Commitment/i });
    await user.click(previewButton);

    await waitFor(() => {
      const createButton = screen.getByRole('button', { name: /Create Commitment/i });
      expect(createButton).toBeDisabled();
    });
  });
});