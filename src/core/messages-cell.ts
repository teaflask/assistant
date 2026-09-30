import type { AgentSubscriber } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";

// The owned message list's wire tap: the AbstractAgent maintains
// `agent.messages` itself; this recorder mirrors every change into the cell.
// onMessagesChanged fires per APPLIED event (deltas included) plus
// initialize/finalize/error and setMessages. The pipeline REUSES its array
// and mutates in place: publish shallow copies; never memo on message identity.

export function messagesRecorder(
  publish: (messages: readonly Message[]) => void,
): AgentSubscriber {
  return {
    onMessagesChanged({ messages }) {
      publish([...messages]);
    },
  };
}

// The connection's error tap: only a transport death reaches onRunFailed (a
// dead fetch, a non-2xx, a protocol refusal, a body that errored mid-read);
// a served RUN_ERROR surfaces as onRunErrorEvent, which the surfaces
// subscribe themselves. Aborts are OUR OWN doing and never paint the banner.
export function streamErrorRecorder(
  onStreamError: (error: Error) => void,
): AgentSubscriber {
  return {
    onRunFailed({ error }) {
      if (isAbortShaped(error)) {
        return;
      }
      onStreamError(error);
    },
  };
}

/** Whether an error is our own abort wearing one of the runtime's spellings
 *  — the DOMException name, or a message saying so. Matches the message on
 *  purpose: the chassis rejects with plain Errors carrying those sentences. */
export function isAbortShaped(error: Error): boolean {
  return error.name === "AbortError" || /\baborted?\b/i.test(error.message);
}

// --- the store-less surface's taps ---------------------------------
// AssistantTranscript's agent mode owns its own connection and has no store
// to hold `running`, so its taps differ from the recorders above in exactly
// two ways: the snapshot recorder publishes {messages, running}, and the
// error tap also reads onRunErrorEvent. The originals stay untouched.

export interface MessagesSnapshot {
  messages: readonly Message[];
  /** True while a run streams — drives the streaming-markdown repair and
   *  the still-pending tool read. */
  running: boolean;
}

// messagesRecorder's wire tap plus the run bit. isRunning flips outside
// message changes too (a run can start or settle without a delta), so the
// three run-edge hooks mirror those edges and the pending read and repair
// windows track the run, not the last delta.
export function messagesSnapshotRecorder(
  publish: (snapshot: MessagesSnapshot) => void,
): AgentSubscriber {
  return {
    onMessagesChanged({ agent, messages }) {
      publish({ messages: [...messages], running: agent.isRunning });
    },
    onRunStartedEvent({ agent }) {
      publish({ messages: [...agent.messages], running: agent.isRunning });
    },
    onRunFinishedEvent({ agent }) {
      publish({ messages: [...agent.messages], running: false });
    },
    onRunErrorEvent({ agent }) {
      publish({ messages: [...agent.messages], running: false });
    },
  };
}

// The connection-owning surface's error tap: a pre-stream failure or an
// event-verify error arrives as onRunFailed; a mid-stream transport death is
// SYNTHESIZED by @ag-ui/client into a RUN_ERROR event (onRunFailed never
// fires for it), so onRunErrorEvent carries it, along with genuine and
// replayed failed-run terminals, which the hosts absorb. Aborts paint no banner.
export function connectionErrorRecorder(
  onStreamError: (error: Error) => void,
): AgentSubscriber {
  return {
    onRunFailed({ error }) {
      if (isAbortShaped(error)) {
        return;
      }
      onStreamError(error);
    },
    onRunErrorEvent({ event }) {
      onStreamError(new Error(event.message));
    },
  };
}
