import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PoolsError from './error';

describe('PoolsError', () => {
  it('renders the error message', () => {
    const retry = vi.fn();
    render(<PoolsError error={new Error('test')} unstable_retry={retry} />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/couldn't load the pools list/)).toBeInTheDocument();
  });

  it('renders an alert region', () => {
    const retry = vi.fn();
    render(<PoolsError error={new Error('test')} unstable_retry={retry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the digest as a support reference when present', () => {
    const retry = vi.fn();
    render(
      <PoolsError
        error={Object.assign(new Error('test'), { digest: 'abc123' })}
        unstable_retry={retry}
      />,
    );

    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('renders no support reference when the digest is absent', () => {
    const retry = vi.fn();
    render(<PoolsError error={new Error('test')} unstable_retry={retry} />);

    expect(screen.queryByText(/reference:/i)).not.toBeInTheDocument();
  });

  it('calls unstable_retry when the retry button is clicked', () => {
    const retry = vi.fn();
    render(<PoolsError error={new Error('test')} unstable_retry={retry} />);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
