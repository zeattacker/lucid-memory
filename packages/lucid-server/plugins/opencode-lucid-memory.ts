/**
 * Lucid Memory Plugin for OpenCode
 *
 * Provides automatic memory integration with OpenCode (github.com/sst/opencode).
 * Hooks into the system prompt, session lifecycle, and compaction to give
 * OpenCode persistent memory across sessions.
 *
 * Install: copy to ~/.config/opencode/plugins/lucid-memory.ts
 */

import { execFile, execFileSync } from "node:child_process"
import { homedir } from "node:os"

const LUCID_CLI = `${homedir()}/.lucid/bin/lucid`

const storedMessageIds = new Set<string>()

function getContext(query: string): string {
	try {
		const result = execFileSync(LUCID_CLI, ["context", query, "--budget=300"], {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		})
		return result.trim()
	} catch {
		return ""
	}
}

function storeMemory(content: string, type: string): void {
	execFile(LUCID_CLI, ["store", content, `--type=${type}`], () => {})
}

export const LucidMemoryPlugin = {
	name: "lucid-memory",

	hooks: {
		// Inject relevant memories into every LLM system prompt
		"experimental.chat.system.transform": (input: {
			system: Array<{ type: string; text: string }>
			client: {
				session: {
					messages: () => Array<{ role: string; content: string; id: string }>
				}
			}
		}) => {
			try {
				const messages = input.client.session.messages()
				const lastUserMessage = [...messages]
					.reverse()
					.find((m) => m.role === "user")
				const query = lastUserMessage?.content || "general coding context"
				const context = getContext(query)

				const output = { system: [...input.system] }
				if (context) {
					output.system.push({ type: "text", text: context })
				}
				return output
			} catch {
				return { system: input.system }
			}
		},

		// Store conversation messages after each turn
		event: (input: {
			event: string
			client: {
				session: {
					messages: () => Array<{ role: string; content: string; id: string }>
				}
			}
		}) => {
			try {
				if (input.event !== "session.idle") return

				const messages = input.client.session.messages()
				for (const msg of messages) {
					if (storedMessageIds.has(msg.id)) continue
					storedMessageIds.add(msg.id)

					if (msg.role === "user" && msg.content.length > 10) {
						storeMemory(msg.content.slice(0, 2000), "conversation")
					} else if (msg.role === "assistant" && msg.content.length > 50) {
						storeMemory(msg.content.slice(0, 2000), "learning")
					}
				}
			} catch {
				// Graceful degradation
			}
		},

		// Inject memories into compaction context so they survive long conversations
		"experimental.session.compacting": (input: {
			context: Array<{ type: string; text: string }>
			client: {
				session: {
					messages: () => Array<{ role: string; content: string; id: string }>
				}
			}
		}) => {
			try {
				const messages = input.client.session.messages()
				const lastUserMessage = [...messages]
					.reverse()
					.find((m) => m.role === "user")
				const query = lastUserMessage?.content || "session context summary"
				const context = getContext(query)

				const output = { context: [...input.context] }
				if (context) {
					output.context.push({ type: "text", text: context })
				}
				return output
			} catch {
				return { context: input.context }
			}
		},

		// Set LUCID_CLIENT env var for shell commands
		"shell.env": () => {
			try {
				return {
					env: { LUCID_CLIENT: "opencode" },
				}
			} catch {
				return { env: {} }
			}
		},
	},
}
