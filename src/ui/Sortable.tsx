import { GripVertical } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

/**
 * Drag-to-reorder list driven by a grip handle (pointer events; works with touch on iOS).
 * Calls onReorder with the new id order on drop.
 */
export function SortableList<T extends { id: string }>({ items, render, onReorder, gap = 8 }: {
  items: T[]; render: (item: T, handle: ReactNode, dragging: boolean) => ReactNode; onReorder: (ids: string[]) => void; gap?: number;
}) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const [drag, setDrag] = useState<{ id: string; index: number; startY: number; dy: number; heights: number[]; target: number } | null>(null);

  const start = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const heights = items.map((it) => refs.current.get(it.id)?.offsetHeight ?? 0);
    const index = items.findIndex((i) => i.id === id);
    setDrag({ id, index, startY: e.clientY, dy: 0, heights, target: index });
  };

  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    // Find the target slot by walking neighbours' midpoints.
    let target = drag.index;
    let acc = 0;
    if (dy > 0) {
      for (let i = drag.index + 1; i < items.length; i++) {
        acc += drag.heights[i] + gap;
        if (dy > acc - (drag.heights[i] + gap) / 2) target = i; else break;
      }
    } else {
      for (let i = drag.index - 1; i >= 0; i--) {
        acc += drag.heights[i] + gap;
        if (-dy > acc - (drag.heights[i] + gap) / 2) target = i; else break;
      }
    }
    setDrag({ ...drag, dy, target });
  };

  const end = () => {
    if (!drag) return;
    if (drag.target !== drag.index) {
      const ids = items.map((i) => i.id);
      const [moved] = ids.splice(drag.index, 1);
      ids.splice(drag.target, 0, moved);
      onReorder(ids);
    }
    setDrag(null);
  };

  const offsetFor = (i: number) => {
    if (!drag) return 0;
    if (i === drag.index) return drag.dy;
    const h = drag.heights[drag.index] + gap;
    if (drag.index < drag.target && i > drag.index && i <= drag.target) return -h;
    if (drag.index > drag.target && i < drag.index && i >= drag.target) return h;
    return 0;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {items.map((it, i) => {
        const handle = (
          <span className="drag-handle" aria-label="Drag to reorder" role="button"
            onPointerDown={(e) => start(e, it.id)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
            <GripVertical size={20} />
          </span>
        );
        const dragging = drag?.id === it.id;
        return (
          <div key={it.id} ref={(el) => { if (el) refs.current.set(it.id, el); else refs.current.delete(it.id); }}
            className={`sortable-item ${dragging ? 'dragging' : ''}`} style={{ transform: `translateY(${offsetFor(i)}px)` }}>
            {render(it, handle, dragging)}
          </div>
        );
      })}
    </div>
  );
}
