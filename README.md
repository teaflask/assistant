<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/teaflask/assistant/main/images/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/teaflask/assistant/main/images/logo.svg" width="56" alt="Teaflask logo">
  </picture>
  <h1>Teaflask Assistant</h1>
  <p>An AI agent that works inside your product, in one component.</p>
  <p>
    <a href="https://docs.teaflask.com/getting-started">Get started</a> ·
    <a href="https://docs.teaflask.com">Docs</a> ·
    <a href="https://app.teaflask.com/">Dashboard</a> ·
    <a href="https://github.com/teaflask/assistant/issues">Issues</a>
  </p>
  <p>
    <a href="https://www.npmjs.com/package/@teaflask/assistant"><img src="https://img.shields.io/npm/v/@teaflask/assistant?color=111" alt="npm version"></a>
    <a href="https://github.com/teaflask/assistant/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@teaflask/assistant?color=111" alt="License: FSL-1.1-ALv2"></a>
  </p>
</div>

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/teaflask/assistant/main/images/surface-widget.png" alt="Corner widget">
      <p align="center"><sub>Corner widget</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/teaflask/assistant/main/images/surface-sidebar.png" alt="Sidebar">
      <p align="center"><sub>Sidebar</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/teaflask/assistant/main/images/surface-palette.png" alt="⌘K palette">
      <p align="center"><sub>⌘K palette</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/teaflask/assistant/main/images/surface-page.png" alt="Full page">
      <p align="center"><sub>Full page</sub></p>
    </td>
  </tr>
</table>

[Teaflask](https://teaflask.com) gives your product an AI agent that understands how it works and gets things done for your users. `@teaflask/assistant` is the part your users see: drop it into your app and Teaflask hosts everything behind it. Your app keeps its own business logic, authentication and permissions.

**React**

```tsx
import "@teaflask/assistant/styles.css";
import { TeaflaskAssistant } from "@teaflask/assistant";

<TeaflaskAssistant publishableKey="pk_live_…" />;
```

**Any other stack**, with a script tag

```html
<script
  type="module"
  src="https://app.teaflask.com/assistant/v1/assistant.js"
></script>
<teaflask-assistant publishable-key="pk_live_…"></teaflask-assistant>
```

## What your agent can do

- **Take actions.** It calls your API on the user's behalf, with the user's own session. You set every action to Allow, Ask or Deny.
- **Follow your workflows.** Write a procedure once, like how refunds work or when to escalate, and the agent follows it.
- **Guide users around your app.** It takes people to the right page and highlights what to click.
- **Fill in forms.** It fills the fields; the user reviews and submits.
- **Hand off long-running work.** It sends complex, multi-step jobs to background sub-agents and picks up their results.
- **Answer from your docs.** It answers from the documentation you release, so what it tells users matches your product.
- **Remember.** It keeps facts across conversations, for your whole organization or for each user.

You choose which of these each agent gets. [How Teaflask works →](https://docs.teaflask.com/fundamentals)

## Batteries included

Everything you'd otherwise build by hand to put an agent in front of your users:

- Real-time streaming that resumes mid-sentence after a dropped connection
- Durable runs that pick up mid-step after a crash, a deploy, or an approval that takes days
- Approvals right in the conversation, before an action runs
- Live progress for actions and sub-agents
- [Tool views](https://docs.teaflask.com/tool-views): show a result as your own component, like an order card instead of JSON
- Four [surfaces](https://docs.teaflask.com/surfaces) for one conversation: a corner widget, a sidebar, a ⌘K command palette, and a full-page assistant
- A polished default design in light and dark, restyled with [theme tokens](https://docs.teaflask.com/appearance) and isolated from your CSS
- Docs that stay true: every claim checked against your code, and a fix proposed when the code moves
- [Skills](https://docs.teaflask.com/skills), [memory](https://docs.teaflask.com/memory), and a [sandboxed workspace](https://docs.teaflask.com/workspace) the agent can use
- The model of your choice, on your own provider key or your user's own plan
- Conversation history across devices, file attachments, and markdown with code highlighting
- Anonymous visitors or [signed-in users](https://docs.teaflask.com/identity)
- Every conversation, action and approval recorded for review
- Keyboard-complete, screen-reader friendly, and respects reduced motion
- A React component, a script tag for any other stack, or a headless entry point for your own UI

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/teaflask/assistant/main/images/tool-view.png" alt="Tool views: your own components, right in the conversation">
      <p align="center"><sub>Tool views: your own components, right in the conversation</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/teaflask/assistant/main/images/sub-agents.png" alt="Sub-agents work in parallel. Open one to watch it live">
      <p align="center"><sub>Sub-agents work in parallel. Open one to watch it live</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/teaflask/assistant/main/images/approval.png" alt="An approval before anything changes">
      <p align="center"><sub>An approval before anything changes</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/teaflask/assistant/main/images/form-fill.png" alt="It fills in your forms and points at what to press">
      <p align="center"><sub>It fills in your forms and points at what to press</sub></p>
    </td>
  </tr>
</table>

## Getting started

You need a Teaflask agent and its publishable key. The [getting started guide](https://docs.teaflask.com/getting-started) takes you from connecting your codebase to a published agent. Then add the assistant to your app, once, in the layout that wraps every page.

### React

```sh
npm install @teaflask/assistant
```

```tsx
import "@teaflask/assistant/styles.css";
import { TeaflaskAssistant } from "@teaflask/assistant";

<TeaflaskAssistant publishableKey="pk_live_…" />;
```

### Any other stack

Rails, Django, Laravel, Vue, WordPress or plain HTML: add the script tag before `</body>`. React is bundled inside, so your page doesn't need it.

```html
<script
  type="module"
  src="https://app.teaflask.com/assistant/v1/assistant.js"
></script>
<teaflask-assistant publishable-key="pk_live_…"></teaflask-assistant>
```

Next, [connect actions to your API](https://docs.teaflask.com/adapters), [identify signed-in users](https://docs.teaflask.com/identity), and run through the [production checklist](https://docs.teaflask.com/production-checklist).

## Learn more

- [How Teaflask works](https://docs.teaflask.com/fundamentals)
- [How it connects to your app](https://docs.teaflask.com/architecture)
- [Grounding and control](https://docs.teaflask.com/grounding)
- [Install](https://docs.teaflask.com/install)
- [Assistant UI](https://docs.teaflask.com/assistant-ui)
- [Trust](https://docs.teaflask.com/trust)

Requires `react` and `react-dom` 18.3 or 19 (the script tag needs neither). The package is pre-1.0: a breaking change bumps the minor version, and the [changelog](https://github.com/teaflask/assistant/blob/main/CHANGELOG.md) lists what changed in every release. Every public export and field is described in the package's types, and the script tag's attributes and properties in its `custom-elements.json`, so your editor and coding agent can read what each one means. You can inspect the published code on [npm](https://www.npmjs.com/package/@teaflask/assistant?activeTab=code) or [unpkg](https://unpkg.com/@teaflask/assistant/).

## License

[Functional Source License, Version 1.1, ALv2 Future License](https://github.com/teaflask/assistant/blob/main/LICENSE) (FSL-1.1-ALv2). You can use it in your own product. You can't use it to build a competing product or service. Every release becomes Apache-2.0 two years after it ships.

Report security issues to [security@teaflask.com](mailto:security@teaflask.com); see [SECURITY.md](https://github.com/teaflask/assistant/blob/main/SECURITY.md).
