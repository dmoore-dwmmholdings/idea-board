# Idea Board — Spec

A private, locally hosted board for capturing product ideas and moving them from first spark to shipped.

- **Status:** v1, built
- **Run:** `npm start` → <http://localhost:4321>
- **Data:** `data/ideas.json` (plain JSON, safe to back up or put under version control)

## 1. Purpose

Ideas get lost in notes apps, chat threads, and memory. Idea Board is one place to put them. It is fast to capture into and calm to look at. It is for one person on one machine, so it has no accounts, no sync, and no cloud.

**Success:** you capture an idea in under 5 seconds, and you open the board weekly to sort it.

## 2. Goals and non-goals

### Goals

1. Capture an idea in under 5 seconds from anywhere on the board (`⌘K`, `Ctrl+K`, or `N`).
2. See every active idea at a glance, grouped into four stages.
3. Move ideas between stages by dragging, or with the stage control in the detail panel.
4. Find an idea fast with search and tag filters.
5. Store data in one human-readable file you own.
6. Look and feel premium: editorial type, dark cinematic ground, restrained motion.

### Non-goals (v1)

- Multiple users, accounts, auth, sharing, or real-time collaboration
- Tasks, due dates, assignees, or sprints (graduate an idea to a real tracker when it needs these)
- Multiple boards (use tags instead)
- Attachments, images, or rich text (notes are plain text)
- Mobile apps (the web UI works on small screens)
- Any network access other than loading web fonts

## 3. Data model

One entity, **Idea**:

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | UUID, set by the server |
| `title` | string | Required, 1–120 chars, trimmed |
| `notes` | string | Optional, ≤ 5,000 chars, plain text |
| `stage` | enum | `spark` · `exploring` · `building` · `shipped` · `archived` |
| `tags` | string[] | ≤ 8 tags, each ≤ 24 chars, lowercased, de-duplicated |
| `starred` | boolean | Starred ideas sort to the top of their column |
| `createdAt` | ISO 8601 | Set by the server |
| `updatedAt` | ISO 8601 | Set by the server on every change |

**Stages**

| Stage | Meaning |
| --- | --- |
| Spark | Raw thought, not judged yet |
| Exploring | Worth a closer look: research, sketches, sizing |
| Building | Actively being made |
| Shipped | Out in the world |
| Archived | Dropped or parked. Hidden from the board, shown in the Archive view |

**Sort order inside a column:** starred first, then most recently updated first.

## 4. Functional requirements

### Capture

- `⌘K` / `Ctrl+K` / `N` opens the capture dialog. The "New idea" button and each column's `+` button open it too. A column's `+` preselects that column's stage.
- Fields: title (required), notes, stage (default Spark), tags (comma-separated).
- `Enter` in the title saves. `⌘Enter` / `Ctrl+Enter` saves from any field. `Esc` closes without saving.
- The dialog closes after a save, and the new card appears in its column.

### Board

- Four columns: Spark, Exploring, Building, Shipped. Each column shows its count.
- Each card shows the title, the first 2 lines of notes, tags, a star toggle, and a relative "updated" time.
- Drag a card to another column to change its stage.
- Click a card (or press `Enter` on it) to open the detail panel.
- An empty column shows a quiet placeholder that opens capture for that stage.

### Detail panel

- Opens from the right. Title, notes, and tags are editable in place and save automatically on blur.
- Stage control (segmented buttons) moves the idea. This is the keyboard-accessible alternative to dragging.
- Actions: Star/Unstar, Archive/Restore, Delete. Delete asks for confirmation and cannot be undone.
- Shows the created and updated dates.

### Find

- Search box (`/` focuses it) filters by title, notes, and tags, case-insensitive.
- A tag row lists every tag in use. Click a tag to filter by it; click it again to clear it.
- The Board / Archive switch in the header shows active ideas or archived ones.

### Persistence

- Every change is saved to the server at once. There is no save button.
- The server writes to a temp file, then renames it over `data/ideas.json`, so a crash cannot corrupt the file.
- If a save fails, a toast says so and the board reloads from the server.

## 5. API

The server listens on `127.0.0.1` by default. Set `HOST=0.0.0.0` to serve on the network, as the Windows installer does. Port 4321 by default; set `PORT` to change it. Set `DATA_DIR` to store `ideas.json` somewhere other than `./data`.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/ideas` | — | `200` Idea[] |
| `POST` | `/api/ideas` | `{title, notes?, stage?, tags?, starred?}` | `201` Idea |
| `PATCH` | `/api/ideas/:id` | Any subset of the writable fields | `200` Idea |
| `DELETE` | `/api/ideas/:id` | — | `204` |

Validation errors return `400 {error}`. An unknown id returns `404`. Request bodies are limited to 1 MB.

## 6. Visual design

Direction: **"Night studio."** A dark, cinematic ground with one warm light source (after Cyera's *Secure the Unknown*). Large editorial serif headlines against quiet sans UI (after OpenAI's launch pages). Dense, precise product UI with clear states (after Contrast Studio's Flightwave work).

### Type

| Role | Face | Use |
| --- | --- | --- |
| Display | Instrument Serif (400, italic) | Page headline, dialog titles, idea title in the detail panel |
| UI / body | Geist (400–600) | Everything else |
| Meta | Geist Mono (400–500), uppercase, +0.08em tracking | Eyebrows, counts, dates, shortcuts |

Fonts load from Google Fonts, with system fallbacks when you are offline.

### Color

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0B0C0F` | Page ground |
| `--surface` | `#14161B` | Cards, panels |
| `--surface-2` | `#1C1F26` | Inputs, hover |
| `--line` | `rgba(255,255,255,0.08)` | Hairlines |
| `--text` | `#EDEBE6` | Primary text (warm off-white) |
| `--text-2` | `#A6A49E` | Secondary text |
| `--text-3` | `#85847F` | Meta text (≥ 4.5:1 on `--bg`) |
| `--accent` | `#F4A259` | Ember: primary actions, star, focus, Spark |
| Stage dots | Spark `#F4A259` · Exploring `#E8D37A` · Building `#7DB9E8` · Shipped `#9AD1A6` | Column headers |

### Motion

- One signature moment: the hero light rays fade in slowly on load.
- Dialogs and the panel use a 180–240 ms ease-out with a slight rise.
- Cards lift 1 px on hover.
- `prefers-reduced-motion` turns all of it off.

### Accessibility

- Every control is a real `<button>`, `<input>`, or `<a>`, with a visible focus ring.
- Dialogs trap focus and give it back to the element that opened them.
- The stage control is a keyboard alternative to drag-and-drop.
- Text contrast is at least 4.5:1.

## 7. Architecture

```
idea-board/
├── server.js        # Node http server: static files + JSON API. Zero dependencies.
├── package.json     # "npm start"
├── data/ideas.json  # Created on first run
└── public/
    ├── index.html
    ├── styles.css
    └── app.js       # Vanilla JS: state, render, events
```

- **No build step, no dependencies.** It needs Node 18 or later.
- The client keeps the idea list in memory, renders from state, and makes optimistic updates.

## 8. Later (not v1)

- Export and import JSON or Markdown from the UI
- Manual ordering inside a column
- Markdown in notes
- Links from an idea to repos, docs, or sketches
- Run as a login item (launchd) so the board is always up on macOS (Windows: see the installer in the README)
