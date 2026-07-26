# Edge-Aware Widget Expansion Design

## Goal

Make the 100×100 quota orb expand into the existing 320×320 card without leaving the current macOS work area. The card keeps the current UI and hover behavior, but chooses its horizontal and vertical expansion directions independently:

- normal position: expand right and down;
- near the right edge: expand left;
- near the bottom edge: expand up;
- near the bottom-right corner: expand left and up.

When the card collapses, the orb returns to the same screen anchor. If the user drags the expanded card, the orb collapses to the corresponding anchor of the card's new position.

## Scope

- Preserve the current 100×100 compact window and 320×320 expanded window.
- Preserve the existing visual design, hover events, dragging, locking, all-Spaces NSPanel behavior, and quota data flow.
- Use the current monitor's usable work area so the card avoids the menu bar and Dock.
- Keep the behavior cross-platform through Tauri's window API, while validating macOS first.
- Support one active display as previously agreed. Moving an expanded card between monitors is not part of this change.

## Approaches Considered

### 1. Tauri window position and size from the frontend — selected

The existing bridge already owns compact/expanded window sizing. Extend it to read the current outer position, scale factor, and monitor work area, then update size and position together. Geometry is extracted into a pure TypeScript module.

This has the smallest integration surface, stays cross-platform, and allows deterministic unit tests without creating a new Rust command.

### 2. Native Rust resize command

Rust could calculate and apply the window frame. It offers lower-level control but adds a command, shared types, platform conversion code, and a second owner for expansion state without improving the required behavior.

### 3. Fixed 320×320 window with CSS-only placement

The native window could remain expanded while CSS places the orb in one corner. The invisible portion would still intercept desktop input unless click-through regions were continuously managed, so this is unsuitable for a desktop overlay.

## Geometry Model

Create `src/lib/windowPlacement.ts` with no Tauri dependency. It operates only on physical-pixel rectangles and sizes:

```ts
type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Rect = Point & Size;
type ExpansionAnchor = {
  horizontal: "left" | "right";
  vertical: "top" | "bottom";
};
```

The anchor names the edge of the expanded card occupied by the compact orb:

- `left`: expanded card starts at the orb's current x coordinate;
- `right`: expanded card ends at the orb's current right edge;
- `top`: expanded card starts at the orb's current y coordinate;
- `bottom`: expanded card ends at the orb's current bottom edge.

### Expansion calculation

Inputs are the compact window position, physical compact and expanded sizes, and the monitor work area.

1. Start with the `left/top` anchor, matching today's right/down expansion.
2. If `compact.x + expanded.width` exceeds the work area's right edge, select the `right` anchor and calculate `x = compact.x + compact.width - expanded.width`.
3. If `compact.y + expanded.height` exceeds the work area's bottom edge, select the `bottom` anchor and calculate `y = compact.y + compact.height - expanded.height`.
4. Clamp the final expanded position to the work area. This handles an orb already slightly outside the usable bounds and displays smaller than the expanded card.

Horizontal and vertical decisions are independent, producing all four corner behaviors.

### Collapse calculation

The active anchor is retained for the current hover cycle. On collapse, read the window's current outer position again so dragging the expanded card is respected.

- `left`: compact x equals the expanded card's current x.
- `right`: compact x equals `expanded.x + expanded.width - compact.width`.
- `top`: compact y equals the expanded card's current y.
- `bottom`: compact y equals `expanded.y + expanded.height - compact.height`.

Clamp the result to the current work area. Without an expanded-card drag, this returns the orb to its exact pre-expansion position. After a drag, it places the orb at the same selected corner of the card's new location.

## Tauri Integration

`setWidgetExpanded` remains the public bridge API. In Tauri mode it will:

1. serialize transitions through a module-level promise queue so rapid enter/leave events cannot finish out of order;
2. read `outerPosition()`, `scaleFactor()`, and `currentMonitor()`;
3. convert the 100 and 320 logical dimensions to physical pixels using the current scale factor;
4. call the pure geometry function;
5. apply the logical size and physical position during the same transition;
6. retain the chosen anchor and physical sizes until collapse completes.

Expansion applies size before position so moving a compact window away from the pointer cannot trigger a premature mouse-leave. Collapse uses the retained anchor and the card's latest outer position, then clears the active transition state.

If monitor information is unavailable, the bridge keeps the current position and uses the default right/down anchor rather than failing the hover interaction. Browser preview mode remains a no-op.

## Error and Race Handling

- Each queued transition catches its own failure so one Tauri error does not permanently reject the queue.
- The existing `App` error message remains the user-visible failure path.
- Repeated identical expand or collapse requests are safe.
- A rapid enter → leave → enter sequence runs in order and ends expanded.
- No monitor coordinates, window handles, or account data are logged.

## Testing

Add `src/lib/windowPlacement.test.ts` covering:

- center and top-left positions expand right/down;
- right edge expands left;
- bottom edge expands up;
- bottom-right expands left/up;
- top-right and bottom-left choose mixed directions;
- collapse without dragging returns the exact compact position;
- collapse after dragging uses the card's new position and retained anchor;
- work-area origins other than `(0, 0)` are handled;
- clamping works for off-bound positions and small work areas;
- physical sizes derived from a non-1.0 scale factor produce the same anchor behavior.

Manual macOS acceptance checks:

1. Drag the orb to the center, four edges, and four corners and hover at each location.
2. Confirm the complete 320×320 card remains visible and expands in the expected direction.
3. Confirm collapse returns the orb to its pre-hover location.
4. Drag an expanded card, move the pointer away, and confirm the orb collapses to the dragged card's corresponding anchor.
5. Repeat in an ordinary Space and over another application's native fullscreen Space.

## Non-Goals

- No UI redesign or expansion animation change.
- No multiple simultaneous widgets or per-display copies.
- No pointer-following behavior.
- No cross-monitor drag optimization during a single expanded hover cycle.
