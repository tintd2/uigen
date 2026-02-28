# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server (localhost:3000) — uses Turbopack + NODE_OPTIONS for Node.js compat
npm run build      # Build for production
npm run setup      # Install deps + prisma generate + prisma migrate dev
npm run test       # Run all tests with vitest
npm run db:reset   # Reset SQLite database

# Run a single test file
npx vitest run src/lib/__tests__/file-system.test.ts
```

Environment: copy `.env.example` to `.env`. Set `ANTHROPIC_API_KEY` for real AI generation; if omitted, the app uses a `MockLanguageModel` that returns static code. `JWT_SECRET` defaults to a dev value if not set.

## Architecture

### Request Flow

1. User types in chat → `ChatContext` (`src/lib/contexts/chat-context.tsx`) calls `/api/chat`
2. `/api/chat/route.ts` calls `getLanguageModel()` (Anthropic Claude or Mock) with two tools:
   - `str_replace_editor` — create/view/edit files via string replacement
   - `file_manager` — rename/delete files
3. AI streams tool calls back; `onToolCall` in ChatContext dispatches to `handleToolCall()` in `FileSystemContext`
4. `FileSystemContext` (`src/lib/contexts/file-system-context.tsx`) updates the in-memory `VirtualFileSystem` and increments `refreshTrigger`
5. `PreviewFrame` detects the trigger, re-transforms all files with Babel, rebuilds blob URL import map, and hot-reloads the sandboxed iframe

### Key Abstractions

**VirtualFileSystem** (`src/lib/file-system.ts`) — in-memory file tree. `serialize()`/`deserialize()` for DB persistence. The class has both low-level ops (`createFile`, `updateFile`, `rename`, `delete`) and editor-style ops (`replaceInFile`, `insertInFile`, `viewFile`).

**Preview pipeline** (`src/lib/transform/jsx-transformer.ts`):
- `transformJSX()` — Babel transpiles JSX → JS, strips CSS imports
- `createImportMap()` — builds import map with blob URLs for local files + esm.sh CDN for third-party packages
- `createPreviewHTML()` — wraps in iframe HTML with Tailwind CDN, error boundary, and dynamic `import()` for the entry point (`/App.jsx` by default)

**AI generation** (`src/lib/provider.ts`): `getLanguageModel()` returns either `anthropic('claude-haiku-4-5')` or `MockLanguageModel`. The mock streams fake tool calls to simulate multi-step generation without an API key.

**Auth** (`src/lib/auth.ts`): JWT in httpOnly cookie `auth-token`. `createSession` / `getSession` / `deleteSession`. Middleware (`src/middleware.ts`) guards `/api/projects` and `/api/filesystem`. Anonymous work is tracked in sessionStorage via `src/lib/anon-work-tracker.ts` and migrated to a real project on sign-in.

### State Management

Two React contexts wrap the main 3-panel layout (`src/app/main-content.tsx`):

- **`FileSystemProvider`** — owns the `VirtualFileSystem` instance, `selectedFile`, and `refreshTrigger`. All file mutations go through its methods.
- **`ChatProvider`** — wraps Vercel AI's `useChat()`, sends `{ messages, files, projectId }` to `/api/chat`, and routes incoming tool calls to `FileSystemContext.handleToolCall()`.

### Database

Prisma + SQLite (`prisma/dev.db`). Two models: `User` (email + bcrypt password) and `Project` (name, `userId?`, `messages` as JSON string, `data` as JSON string for VirtualFileSystem state). Projects auto-save after each AI generation.

### Layout

`src/app/main-content.tsx` renders a resizable 35/65 split:
- Left: `ChatInterface` (chat, messages, input)
- Right: tabbed `Preview` (iframe) or `Code` (30% `FileTree` + 70% Monaco editor)

### System Prompt

`src/lib/prompts/generation.tsx` — instructs Claude to generate React components with Tailwind, use `/App.jsx` as the entry point, and import local files with the `@/` alias.

## Testing

Tests use Vitest + Testing Library. Coverage areas:
- `src/lib/__tests__/file-system.test.ts` — VirtualFileSystem
- `src/lib/transform/__tests__/jsx-transformer.test.ts` — Babel transform + import map
- `src/lib/contexts/__tests__/file-system-context.test.tsx` — context + tool call handling
- `src/components/editor/__tests__/file-tree.test.tsx`
- `src/components/chat/__tests__/` — ChatInterface, MessageInput, MessageList, MarkdownRenderer
