import { renderHook, act } from '@testing-library/react';
import { useDashboardLayoutStore } from '@/stores/dashboardLayout.store';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('DashboardLayoutStore', () => {
  beforeEach(() => {
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    // Reset store state
    useDashboardLayoutStore.getState().resetLayout();
  });

  describe('Initial State', () => {
    it('has correct default panel sizes', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      expect(result.current.panelSizes.leftPanelWidth).toBe(30);
      expect(result.current.panelSizes.centerPanelWidth).toBe(40);
      expect(result.current.panelSizes.rightPanelWidth).toBe(30);
    });

    it('has correct default layout version', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      expect(result.current.panelSizes.layoutVersion).toBe('1.0.0');
    });

    it('initializes with correct default state', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      expect(result.current.isResizing).toBe(false);
      expect(result.current.activePanel).toBe(null);
      expect(result.current.isMobile).toBe(false);
      expect(result.current.isTablet).toBe(false);
    });
  });

  describe('Panel Size Management', () => {
    it('sets individual panel size correctly', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      act(() => {
        result.current.setPanelSize('left', 35);
      });
      
      expect(result.current.panelSizes.leftPanelWidth).toBe(35);
    });

    it('constrains panel sizes within limits', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      // Try to set left panel above maximum (50%)
      act(() => {
        result.current.setPanelSize('left', 60);
      });
      
      expect(result.current.panelSizes.leftPanelWidth).toBe(50); // Should be constrained to max
      
      // Try to set left panel below minimum (20%)
      act(() => {
        result.current.setPanelSize('left', 10);
      });
      
      expect(result.current.panelSizes.leftPanelWidth).toBe(20); // Should be constrained to min
    });

    it('sets all panel sizes correctly', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      act(() => {
        result.current.setPanelSizes({ left: 25, center: 50, right: 25 });
      });
      
      expect(result.current.panelSizes.leftPanelWidth).toBe(25);
      expect(result.current.panelSizes.centerPanelWidth).toBe(50);
      expect(result.current.panelSizes.rightPanelWidth).toBe(25);
    });

    it('validates panel size sums', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      // Try to set sizes that don't sum to 100%
      act(() => {
        result.current.setPanelSizes({ left: 20, center: 30, right: 30 }); // Sum = 80%
      });
      
      expect(consoleSpy).toHaveBeenCalledWith('Invalid panel sizes provided:', { left: 20, center: 30, right: 30 });
      
      consoleSpy.mockRestore();
    });

    it('constrains individual panel sizes properly', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      // Test left panel constraints (20-50)
      expect(result.current.constrainPanelSize('left', 10)).toBe(20);
      expect(result.current.constrainPanelSize('left', 60)).toBe(50);
      expect(result.current.constrainPanelSize('left', 35)).toBe(35);
      
      // Test center panel constraints (20-60)
      expect(result.current.constrainPanelSize('center', 10)).toBe(20);
      expect(result.current.constrainPanelSize('center', 70)).toBe(60);
      expect(result.current.constrainPanelSize('center', 45)).toBe(45);
      
      // Test right panel constraints (20-50)
      expect(result.current.constrainPanelSize('right', 10)).toBe(20);
      expect(result.current.constrainPanelSize('right', 60)).toBe(50);
      expect(result.current.constrainPanelSize('right', 35)).toBe(35);
    });
  });

  describe('Resize State Management', () => {
    it('sets resizing state correctly', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      act(() => {
        result.current.setIsResizing(true);
        result.current.setActivePanel('left');
      });
      
      expect(result.current.isResizing).toBe(true);
      expect(result.current.activePanel).toBe('left');
      
      act(() => {
        result.current.setIsResizing(false);
        result.current.setActivePanel(null);
      });
      
      expect(result.current.isResizing).toBe(false);
      expect(result.current.activePanel).toBe(null);
    });
  });

  describe('Responsive State Management', () => {
    it('sets responsive state correctly', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      act(() => {
        result.current.setResponsiveState(true, false);
      });
      
      expect(result.current.isMobile).toBe(true);
      expect(result.current.isTablet).toBe(false);
      
      act(() => {
        result.current.setResponsiveState(false, true);
      });
      
      expect(result.current.isMobile).toBe(false);
      expect(result.current.isTablet).toBe(true);
    });
  });

  describe('Layout Preferences', () => {
    it('resets layout to defaults correctly', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      // Change some values
      act(() => {
        result.current.setPanelSizes({ left: 35, center: 45, right: 20 });
        result.current.setActivePanel('left');
        result.current.setIsResizing(true);
      });
      
      // Reset layout
      act(() => {
        result.current.resetLayout();
      });
      
      expect(result.current.panelSizes.leftPanelWidth).toBe(30);
      expect(result.current.panelSizes.centerPanelWidth).toBe(40);
      expect(result.current.panelSizes.rightPanelWidth).toBe(30);
      expect(result.current.activePanel).toBe(null);
      expect(result.current.isResizing).toBe(false);
    });

    it('saves layout preferences', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      act(() => {
        result.current.saveLayoutPreferences();
      });
      
      expect(consoleSpy).toHaveBeenCalledWith('Layout preferences saved:', result.current.panelSizes);
      
      consoleSpy.mockRestore();
    });

    it('loads layout preferences', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      act(() => {
        result.current.loadLayoutPreferences();
      });
      
      expect(consoleSpy).toHaveBeenCalledWith('Layout preferences loaded:', result.current.panelSizes);
      
      consoleSpy.mockRestore();
    });
  });

  describe('Validation Methods', () => {
    it('validates panel sizes correctly', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      // Valid sizes
      expect(result.current.validatePanelSizes({ left: 30, center: 40, right: 30 })).toBe(true);
      expect(result.current.validatePanelSizes({ left: 25, center: 45, right: 30 })).toBe(true);
      
      // Invalid sum
      expect(result.current.validatePanelSizes({ left: 20, center: 30, right: 30 })).toBe(false);
      expect(result.current.validatePanelSizes({ left: 40, center: 50, right: 20 })).toBe(false);
    });

    it('handles floating point precision in validation', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      // Allow small floating point errors
      expect(result.current.validatePanelSizes({ left: 33.33, center: 33.34, right: 33.33 })).toBe(true);
      expect(result.current.validatePanelSizes({ left: 33.3, center: 33.3, right: 33.4 })).toBe(true);
    });

    it('validates individual panel constraints', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Panel outside constraints
      expect(result.current.validatePanelSizes({ left: 10, center: 45, right: 45 })).toBe(false);
      expect(result.current.validatePanelSizes({ left: 60, center: 20, right: 20 })).toBe(false);
      
      // Should log constraint errors
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('outside constraints [20-50]')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('Optimized Selectors', () => {
    it('usePanelSizes selector returns panel sizes', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      const { usePanelSizes } = require('@/stores/dashboardLayout.store');
      const { result: selectorResult } = renderHook(() => usePanelSizes());
      
      expect(selectorResult.current).toEqual(result.current.panelSizes);
    });

    it('useResizeState selector returns resize state', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      act(() => {
        result.current.setIsResizing(true);
        result.current.setActivePanel('left');
      });
      
      const { useResizeState } = require('@/stores/dashboardLayout.store');
      const { result: selectorResult } = renderHook(() => useResizeState());
      
      expect(selectorResult.current.isResizing).toBe(true);
      expect(selectorResult.current.activePanel).toBe('left');
    });

    it('useResponsiveState selector returns responsive state', () => {
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      act(() => {
        result.current.setResponsiveState(true, false);
      });
      
      const { useResponsiveState } = require('@/stores/dashboardLayout.store');
      const { result: selectorResult } = renderHook(() => useResponsiveState());
      
      expect(selectorResult.current.isMobile).toBe(true);
      expect(selectorResult.current.isTablet).toBe(false);
    });

    it('useLayoutActions selector returns actions', () => {
      const { useLayoutActions } = require('@/stores/dashboardLayout.store');
      const { result: selectorResult } = renderHook(() => useLayoutActions());
      
      expect(selectorResult.current.setPanelSize).toBeDefined();
      expect(selectorResult.current.setPanelSizes).toBeDefined();
      expect(selectorResult.current.resetLayout).toBeDefined();
      expect(selectorResult.current.saveLayoutPreferences).toBeDefined();
    });
  });

  describe('Persistence', () => {
    it('persists only panel sizes, not transient state', () => {
      // Test that only panelSizes are persisted, not isResizing or activePanel
      const { result } = renderHook(() => useDashboardLayoutStore());
      
      act(() => {
        result.current.setPanelSizes({ left: 35, center: 40, right: 25 });
        result.current.setIsResizing(true);
        result.current.setActivePanel('center');
        result.current.setResponsiveState(true, false);
      });
      
      // localStorage.setItem should be called with only panel sizes
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'dashboard-layout-storage',
        expect.stringContaining('"panelSizes"')
      );
      
      // Should not contain transient state
      const persistedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
      expect(persistedData.state).toHaveProperty('panelSizes');
      expect(persistedData.state).not.toHaveProperty('isResizing');
      expect(persistedData.state).not.toHaveProperty('activePanel');
      expect(persistedData.state).not.toHaveProperty('isMobile');
      expect(persistedData.state).not.toHaveProperty('isTablet');
    });
  });
});