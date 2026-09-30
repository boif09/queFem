import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import '../i18n.js';
import { PlanVisual } from '../components/PlanVisual.jsx';

const plan = (url) => ({
  id: 1, kind: 'event', categories: [{ slug: 'musica', icon: 'music' }],
  image: { url, kind: 'official', source: 'gencat' },
});

describe('PlanVisual', () => {
  it('falls back to the category artwork when the image fails and reports the failed URL', () => {
    const onImageError = vi.fn();
    const { container } = render(<PlanVisual plan={plan('/api/media/gencat/1')} onImageError={onImageError} />);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('[data-pattern="musica"]')).toBeInTheDocument();
    expect(onImageError).toHaveBeenCalledWith('/api/media/gencat/1');
  });

  it('shows a new image URL even after the previous one failed', () => {
    const { container, rerender } = render(<PlanVisual plan={plan('/api/media/gencat/1')} />);
    fireEvent.error(container.querySelector('img'));
    rerender(<PlanVisual plan={plan('/api/media/gencat/2')} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/media/gencat/2');
  });
});
