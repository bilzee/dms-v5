import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { VerifiedBadge } from '@/components/dashboards/crisis/VerifiedBadge';

describe('VerifiedBadge', () => {
  describe('Basic Rendering', () => {
    it('should render nothing when not verified', () => {
      const { container } = render(
        <VerifiedBadge isVerified={false} />
      );
      
      expect(container.firstChild).toBeNull();
    });

    it('should render badge when verified', () => {
      render(
        <VerifiedBadge 
          isVerified={true} 
          verificationMethod="manual"
        />
      );
      
      expect(screen.getByText('Verified')).toBeInTheDocument();
      expect(screen.getByRole('img', { hidden: true })).toBeInTheDocument(); // Star icon
    });

    it('should render auto-verified badge correctly', () => {
      render(
        <VerifiedBadge 
          isVerified={true} 
          verificationMethod="auto"
        />
      );
      
      expect(screen.getByText('Auto-Verified')).toBeInTheDocument();
      expect(screen.getByRole('img', { hidden: true })).toBeInTheDocument(); // Shield icon
    });

    it('should render mixed verification method correctly', () => {
      render(
        <VerifiedBadge 
          isVerified={true} 
          verificationMethod="mixed"
        />
      );
      
      expect(screen.getByText('Verified')).toBeInTheDocument();
      expect(screen.getByRole('img', { hidden: true })).toBeInTheDocument(); // CheckCircle icon
    });
  });

  describe('Size Variants', () => {
    it('should render small size correctly', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          size="sm"
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      expect(badge).toHaveClass('text-xs', 'px-2', 'py-1', 'gap-1');
    });

    it('should render medium size correctly', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          size="md"
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      expect(badge).toHaveClass('text-sm', 'px-3', 'py-1.5', 'gap-1.5');
    });

    it('should render large size correctly', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          size="lg"
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      expect(badge).toHaveClass('text-base', 'px-4', 'py-2', 'gap-2');
    });
  });

  describe('Color Themes', () => {
    it('should apply manual verification colors', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      expect(badge).toHaveClass('bg-green-100', 'text-green-800', 'border-green-300');
    });

    it('should apply auto-verification colors', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="auto"
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      expect(badge).toHaveClass('bg-blue-100', 'text-blue-800', 'border-blue-300');
    });

    it('should apply mixed verification colors', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="mixed"
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      expect(badge).toHaveClass('bg-purple-100', 'text-purple-800', 'border-purple-300');
    });
  });

  describe('Text Display', () => {
    it('should show text by default', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          showText={true}
        />
      );
      
      expect(screen.getByText('Verified')).toBeInTheDocument();
    });

    it('should hide text when showText is false', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          showText={false}
        />
      );
      
      expect(screen.queryByText('Verified')).not.toBeInTheDocument();
      expect(screen.getByTestId('verified-badge')).toBeInTheDocument();
    });
  });

  describe('Tooltip Functionality', () => {
    it('should show tooltip when showTooltip is true and metrics are provided', () => {
      const metrics = {
        totalVerified: 10,
        totalActivities: 12,
        verificationRate: 0.833,
        responseVerified: 6,
        commitmentFulfilled: 4
      };

      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          showTooltip={true}
          metrics={metrics}
        />
      );
      
      // Check for info icon
      expect(screen.getByRole('img', { hidden: true })).toBeInTheDocument();
      
      // Hover over badge to show tooltip
      const badge = screen.getByTestId('verified-badge');
      fireEvent.mouseEnter(badge);
      
      // Check tooltip content
      expect(screen.getByText('Verification Details')).toBeInTheDocument();
      expect(screen.getByText('Total Verified:')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('Total Activities:')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('Success Rate:')).toBeInTheDocument();
      expect(screen.getByText('83.3%')).toBeInTheDocument();
      expect(screen.getByText('Responses Verified:')).toBeInTheDocument();
      expect(screen.getByText('6')).toBeInTheDocument();
      expect(screen.getByText('Commitments Fulfilled:')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('should not show tooltip when showTooltip is false', () => {
      const metrics = {
        totalVerified: 10,
        totalActivities: 12,
        verificationRate: 0.833
      };

      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          showTooltip={false}
          metrics={metrics}
        />
      );
      
      // Should not have info icon
      expect(screen.queryByTestId('info-icon')).not.toBeInTheDocument();
    });

    it('should not show tooltip when no metrics provided', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          showTooltip={true}
        />
      );
      
      // Should not have info icon
      expect(screen.queryByTestId('info-icon')).not.toBeInTheDocument();
    });

    it('should handle missing optional metrics gracefully', () => {
      const partialMetrics = {
        totalVerified: 5,
        totalActivities: 8,
        verificationRate: 0.625
        // Missing responseVerified and commitmentFulfilled
      };

      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="auto"
          showTooltip={true}
          metrics={partialMetrics}
        />
      );
      
      // Hover to show tooltip
      const badge = screen.getByTestId('verified-badge');
      fireEvent.mouseEnter(badge);
      
      // Should show basic metrics but not optional ones
      expect(screen.getByText('Total Verified:')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('Total Activities:')).toBeInTheDocument();
      expect(screen.getByText('8')).toBeInTheDocument();
      expect(screen.getByText('Success Rate:')).toBeInTheDocument();
      expect(screen.getByText('62.5%')).toBeInTheDocument();
      
      // Should not show optional metrics
      expect(screen.queryByText('Responses Verified:')).not.toBeInTheDocument();
      expect(screen.queryByText('Commitments Fulfilled:')).not.toBeInTheDocument();
    });

    it('should display verification method in tooltip', () => {
      const metrics = {
        totalVerified: 10,
        totalActivities: 12,
        verificationRate: 0.833
      };

      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="auto"
          showTooltip={true}
          metrics={metrics}
        />
      );
      
      // Hover to show tooltip
      const badge = screen.getByTestId('verified-badge');
      fireEvent.mouseEnter(badge);
      
      // Should show verification method
      expect(screen.getByText('Verification method: auto')).toBeInTheDocument();
    });
  });

  describe('Custom Styling', () => {
    it('should apply custom className', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          className="custom-badge-class"
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      expect(badge).toHaveClass('custom-badge-class');
    });

    it('should combine custom className with default classes', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          size="lg"
          className="custom-class another-class"
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      expect(badge).toHaveClass('custom-class', 'another-class');
      expect(badge).toHaveClass('text-base'); // from lg size
      expect(badge).toHaveClass('bg-green-100'); // from manual verification
    });
  });

  describe('Icon Rendering', () => {
    it('should render Star icon for manual verification', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
        />
      );
      
      // Star icon should be present (testing via role="img" and hidden=true)
      const icon = screen.getByRole('img', { hidden: true });
      expect(icon).toBeInTheDocument();
    });

    it('should render Shield icon for auto verification', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="auto"
        />
      );
      
      const icon = screen.getByRole('img', { hidden: true });
      expect(icon).toBeInTheDocument();
    });

    it('should render CheckCircle icon for mixed verification', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="mixed"
        />
      );
      
      const icon = screen.getByRole('img', { hidden: true });
      expect(icon).toBeInTheDocument();
    });

    it('should render info icon when tooltip is enabled', () => {
      const metrics = {
        totalVerified: 10,
        totalActivities: 12,
        verificationRate: 0.833
      };

      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          showTooltip={true}
          metrics={metrics}
        />
      );
      
      const infoIcon = screen.getByTestId('info-icon');
      expect(infoIcon).toBeInTheDocument();
      expect(infoIcon).toHaveClass('ml-1', 'opacity-60');
    });
  });

  describe('Accessibility', () => {
    it('should have appropriate ARIA attributes', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      expect(badge).toHaveAttribute('role', 'status');
      expect(badge).toHaveClass('cursor-default');
    });

    it('should have proper contrast ratios', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      expect(badge).toHaveClass('text-green-800'); // Should provide good contrast
    });

    it('should support keyboard navigation when interactive', () => {
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          showTooltip={true}
          metrics={{
            totalVerified: 10,
            totalActivities: 12,
            verificationRate: 0.833
          }}
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      badge.focus();
      expect(badge).toHaveFocus();
      
      // Should show tooltip on focus
      fireEvent.focus(badge);
      expect(screen.getByText('Verification Details')).toBeInTheDocument();
    });
  });

  describe('Performance', () => {
    it('should not re-render unnecessarily', () => {
      const { rerender } = render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
        />
      );
      
      const initialBadge = screen.getByTestId('verified-badge');
      
      // Re-render with same props
      rerender(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
        />
      );
      
      // Should still be the same element
      expect(screen.getByTestId('verified-badge')).toBe(initialBadge);
    });

    it('should handle large metric numbers efficiently', () => {
      const largeMetrics = {
        totalVerified: 999999,
        totalActivities: 1000000,
        verificationRate: 0.999999,
        responseVerified: 500000,
        commitmentFulfilled: 499999
      };

      const startTime = performance.now();
      
      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="mixed"
          showTooltip={true}
          metrics={largeMetrics}
        />
      );
      
      const endTime = performance.now();
      const renderTime = endTime - startTime;
      
      // Should render quickly even with large numbers
      expect(renderTime).toBeLessThan(100); // 100ms threshold
      
      // Should format large numbers correctly
      const badge = screen.getByTestId('verified-badge');
      fireEvent.mouseEnter(badge);
      
      expect(screen.getByText('999,999')).toBeInTheDocument();
      expect(screen.getByText('1,000,000')).toBeInTheDocument();
      expect(screen.getByText('100.0%')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero metrics gracefully', () => {
      const zeroMetrics = {
        totalVerified: 0,
        totalActivities: 0,
        verificationRate: 0,
        responseVerified: 0,
        commitmentFulfilled: 0
      };

      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          showTooltip={true}
          metrics={zeroMetrics}
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      fireEvent.mouseEnter(badge);
      
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.getByText('0.0%')).toBeInTheDocument();
    });

    it('should handle very high verification rates', () => {
      const highRateMetrics = {
        totalVerified: 99,
        totalActivities: 100,
        verificationRate: 0.99
      };

      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="auto"
          showTooltip={true}
          metrics={highRateMetrics}
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      fireEvent.mouseEnter(badge);
      
      expect(screen.getByText('99.0%')).toBeInTheDocument();
    });

    it('should handle floating point precision correctly', () => {
      const precisionMetrics = {
        totalVerified: 1,
        totalActivities: 3,
        verificationRate: 0.3333333333333333
      };

      render(
        <VerifiedBadge 
          isVerified={true}
          verificationMethod="manual"
          showTooltip={true}
          metrics={precisionMetrics}
        />
      );
      
      const badge = screen.getByTestId('verified-badge');
      fireEvent.mouseEnter(badge);
      
      // Should be rounded to 1 decimal place
      expect(screen.getByText('33.3%')).toBeInTheDocument();
    });
  });
});