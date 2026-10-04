import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';

describe('test setup', () => {
  it('renders a component with jest-dom matchers', () => {
    render(<Button disabled>Send offer</Button>);
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();
  });
});
