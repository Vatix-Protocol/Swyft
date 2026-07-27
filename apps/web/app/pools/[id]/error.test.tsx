import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PoolDetailError from './error';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe('PoolDetailError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the error message with a back link', () => {
    const retry = vi.fn();
    render(<PoolDetailError error={new Error('test')} unstable_retry={retry} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/couldn't load this pool/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /all pools/i })).toHaveAttribute(
      'href',
      '/pools',
    );
  });

  it('calls unstable_retry when the retry button is clicked', () => {
    const retry = vi.fn();
    render(<PoolDetailError error={new Error('test')} unstable_retry={retry} />);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('offers both a retry action and a back-to-pools navigation CTA', () => {
    const retry = vi.fn();
    render(<PoolDetailError error={new Error('test')} unstable_retry={retry} />);

    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to pools/i })).toHaveAttribute(
      'href',
      '/pools',
    );
  });

  it('announces the error region for assistive tech', () => {
    const retry = vi.fn();
    render(<PoolDetailError error={new Error('test')} unstable_retry={retry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows a support reference when the error has a digest', () => {
    const retry = vi.fn();
    const error = Object.assign(new Error('test'), { digest: 'abc123' });
    render(<PoolDetailError error={error} unstable_retry={retry} />);

    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('does not render a blank page when no digest is present', () => {
    const retry = vi.fn();
    render(<PoolDetailError error={new Error('test')} unstable_retry={retry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/reference:/i)).not.toBeInTheDocument();
  });
});
