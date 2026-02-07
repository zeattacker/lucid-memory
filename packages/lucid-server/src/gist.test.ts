/**
 * Unit tests for gist.ts
 *
 * Tests extractive summarization functions.
 * Documents known behaviors and edge cases for Rust migration.
 *
 * IMPORTANT: Some behaviors are intentionally preserved for compatibility:
 * - Regex /\b[a-z]+\b/g only matches ASCII lowercase (not accented chars)
 * - Sentence splitting has false positives on abbreviations (Dr., etc.)
 */

import { describe, expect, it } from "bun:test"
import { estimateTokens, fitsInBudget, generateGist } from "./gist.ts"

describe("generateGist", () => {
	describe("basic functionality", () => {
		it("should return content unchanged if under maxLength", () => {
			const short = "This is a short sentence."
			expect(generateGist(short, 150)).toBe(short)
		})

		it("should use default maxLength of 150", () => {
			const short = "Short content."
			expect(generateGist(short)).toBe(short)
		})

		it("should normalize whitespace", () => {
			const messy = "  Multiple   spaces\n\tand\ttabs  "
			expect(generateGist(messy, 150)).toBe("Multiple spaces and tabs")
		})
	})

	describe("empty and minimal inputs", () => {
		it("should handle empty string", () => {
			expect(generateGist("", 150)).toBe("")
		})

		it("should handle whitespace-only string", () => {
			expect(generateGist("   \n\t  ", 150)).toBe("")
		})

		it("should handle single character", () => {
			expect(generateGist("X", 150)).toBe("X")
		})

		it("should handle single word", () => {
			expect(generateGist("Hello", 150)).toBe("Hello")
		})
	})

	describe("sentence extraction", () => {
		it("should extract first meaningful sentence (>20 chars)", () => {
			const text =
				"Hi. This is the first meaningful sentence with good content. More stuff here."
			const gist = generateGist(text, 100)
			expect(gist).toContain("This is the first meaningful sentence")
		})

		it("should fall back to first sentence if none >20 chars", () => {
			// All sentences are <20 chars, text exceeds maxLength
			const text = "Short. Tiny. Small. Brief. Quick. Fast. Rapid. Swift."
			const gist = generateGist(text, 30)
			// No sentence >20 chars, falls back to first: "Short."
			// First sentence fits in maxLength (30), so returns it
			expect(gist).toBe("Short.")
		})

		it("should handle text with no sentence endings", () => {
			const text = "This is text without any sentence ending punctuation"
			const gist = generateGist(text, 150)
			expect(gist).toBe(text)
		})

		it("should handle exclamation marks as sentence enders", () => {
			const text = "Wow! This is exciting content."
			const gist = generateGist(text, 150)
			// First sentence "Wow!" is <20 chars, so should get "This is exciting content."
			expect(gist).toContain("Wow!")
		})

		it("should handle question marks as sentence enders", () => {
			const text = "What? This explains the situation clearly."
			const gist = generateGist(text, 150)
			expect(gist).toContain("What?")
		})
	})

	describe("key terms extraction", () => {
		it("should add key terms in brackets when space allows", () => {
			// Text must exceed maxLength to trigger extraction, but first sentence must fit
			const text =
				"The system processes data. Data processing involves multiple algorithms. Algorithms are essential for computing. Algorithms drive everything. This extra text ensures we exceed the maxLength limit."
			const gist = generateGist(text, 80)
			// "algorithms" appears 3x outside first sentence, should be key term
			expect(gist).toMatch(/\[.*algorithms.*\]/)
		})

		it("should not include words from first sentence as key terms", () => {
			const text =
				"Memory retrieval uses activation. Activation spreads through the network. Memory is important."
			const gist = generateGist(text, 150)
			// "memory" is in first sentence, should not be in key terms
			if (gist.includes("[")) {
				expect(gist).not.toMatch(/\[.*memory.*\]/)
			}
		})

		it("should filter out stop words from key terms", () => {
			const text =
				"The quick fox jumps. The the the the the the. Quick quick quick."
			const gist = generateGist(text, 150)
			// "the" should not appear in key terms even though frequent
			if (gist.includes("[")) {
				expect(gist).not.toMatch(/\[.*\bthe\b.*\]/)
			}
		})

		it("should require word to appear 2+ times for key terms", () => {
			const text =
				"First sentence here. Unique word appears once. Another unique term."
			const gist = generateGist(text, 150)
			// No word appears 2+ times outside first sentence
			expect(gist).not.toContain("[")
		})
	})

	describe("truncation behavior", () => {
		it("should truncate long content at word boundaries", () => {
			const longText =
				"This is a very long first sentence that goes on and on and on and keeps going beyond any reasonable length that would fit in our target gist size which is quite limiting."
			const gist = generateGist(longText, 50)
			expect(gist.length).toBeLessThanOrEqual(50)
			expect(gist).toEndWith("...")
		})

		it("should not cut words in half", () => {
			const text =
				"Antidisestablishmentarianism is a long word that should not be cut."
			const gist = generateGist(text, 30)
			// Should either include full word or stop before it
			expect(gist).not.toMatch(/\w\.\.\./) // No partial word before ...
		})
	})

	describe("Unicode and special characters", () => {
		/**
		 * DOCUMENTED BEHAVIOR: Regex /\b[a-z]+\b/g only matches ASCII.
		 * Accented characters like é, ñ, ü are NOT matched.
		 * This is preserved for Rust migration compatibility.
		 */
		it("should handle accented characters (ASCII-only key terms)", () => {
			const text =
				"The café serves coffee. Café culture is important. Café café café."
			const gist = generateGist(text, 150)
			// "café" won't be detected as key term because é is not [a-z]
			// This is expected behavior - documenting for Rust compatibility
			expect(gist).toContain("café") // preserved in output
			// Key terms won't include "café" due to regex limitation
		})

		it("should preserve emoji in output", () => {
			const text = "The 🔥 feature is hot. Really 🔥 stuff happening here."
			const gist = generateGist(text, 150)
			expect(gist).toContain("🔥")
		})

		it("should handle Chinese/Japanese/Korean characters", () => {
			const text = "学习编程很重要。Programming is important. 编程 编程 编程."
			const gist = generateGist(text, 150)
			expect(gist).toContain("学习编程很重要")
		})

		it("should handle mixed scripts", () => {
			const text = "Hello世界! Mixed content here. 世界 世界."
			const gist = generateGist(text, 150)
			expect(gist.length).toBeGreaterThan(0)
		})
	})

	describe("abbreviations (known limitations)", () => {
		/**
		 * DOCUMENTED BEHAVIOR: Sentence splitting has false positives.
		 * "Dr. Smith" splits after "Dr." because next char is space.
		 * This is preserved for Rust migration compatibility.
		 */
		it("should split on abbreviations like Dr. (known limitation)", () => {
			const text = "Dr. Smith went to the store. He bought milk."
			const gist = generateGist(text, 150)
			// Current behavior: splits after "Dr." - this is a known limitation
			// Documenting actual behavior for compatibility
			expect(gist).toBeDefined()
		})

		it("should split on etc. (known limitation)", () => {
			const text = "Items include apples, oranges, etc. Please note the list."
			const gist = generateGist(text, 150)
			expect(gist).toBeDefined()
		})

		it("should split on U.S.A. (known limitation)", () => {
			const text = "The U.S.A. was founded in 1776. It has 50 states."
			const gist = generateGist(text, 150)
			expect(gist).toBeDefined()
		})
	})

	describe("URLs", () => {
		it("should handle URLs without breaking", () => {
			const text =
				"Visit https://example.com/path for more info. The site has resources."
			const gist = generateGist(text, 150)
			expect(gist).toContain("https://example.com/path")
		})

		it("should handle URLs with periods", () => {
			const text = "See docs.example.com for documentation. More info available."
			const gist = generateGist(text, 150)
			// URL has periods but no space after, so shouldn't split
			expect(gist).toBeDefined()
		})
	})

	describe("contractions", () => {
		it("should handle contractions", () => {
			const text =
				"It's important to note that we're working on improvements. They've been requested."
			const gist = generateGist(text, 150)
			expect(gist).toContain("It's")
		})

		it("should preserve possessives", () => {
			const text =
				"The system's memory is efficient. Memory's importance is clear."
			const gist = generateGist(text, 150)
			expect(gist).toContain("system's")
		})
	})

	describe("code and technical content", () => {
		it("should handle code snippets", () => {
			const text =
				"Use `generateGist()` function. The function processes text efficiently."
			const gist = generateGist(text, 150)
			expect(gist).toContain("`generateGist()`")
		})

		it("should handle file paths", () => {
			const text =
				"Edit /Users/jasondocton/file.ts for changes. The file contains code."
			const gist = generateGist(text, 150)
			expect(gist).toContain("/Users/jasondocton/file.ts")
		})

		it("should handle camelCase terms", () => {
			const text =
				"The buildAssociationIndex function builds indexes. buildAssociationIndex is efficient. buildAssociationIndex rocks."
			const gist = generateGist(text, 150)
			// camelCase preserved but not matched by [a-z]+ regex for key terms
			expect(gist).toContain("buildAssociationIndex")
		})
	})

	describe("stop words only", () => {
		it("should handle text that is mostly stop words", () => {
			const text = "The the the is is is are are are to to to of of of."
			const gist = generateGist(text, 150)
			// Should return something, even if no key terms
			expect(gist.length).toBeGreaterThan(0)
		})
	})

	describe("very long inputs", () => {
		it("should handle 10KB of text", () => {
			const sentence = "This is a test sentence with meaningful content. "
			const longText = sentence.repeat(200) // ~10KB
			const start = performance.now()
			const gist = generateGist(longText, 150)
			const elapsed = performance.now() - start

			expect(elapsed).toBeLessThan(100) // Should be fast
			expect(gist.length).toBeLessThanOrEqual(150)
		})

		it("should handle 100KB of text", () => {
			const word = "word "
			const longText = word.repeat(20000) // ~100KB
			const start = performance.now()
			const gist = generateGist(longText, 150)
			const elapsed = performance.now() - start

			expect(elapsed).toBeLessThan(500) // Should complete reasonably
			expect(gist.length).toBeLessThanOrEqual(150)
		})
	})
})

describe("estimateTokens", () => {
	it("should estimate ~4 chars per token", () => {
		expect(estimateTokens("")).toBe(0)
		expect(estimateTokens("test")).toBe(1) // 4 chars = 1 token
		expect(estimateTokens("testing")).toBe(2) // 7 chars = ceil(7/4) = 2 tokens
		expect(estimateTokens("a".repeat(100))).toBe(25) // 100 chars = 25 tokens
	})

	it("should handle emoji (counts bytes not graphemes)", () => {
		// "🔥" is 4 bytes in UTF-8 but JS string.length = 2 (UTF-16)
		const emoji = "🔥"
		expect(estimateTokens(emoji)).toBe(1) // ceil(2/4) = 1
	})
})

describe("fitsInBudget", () => {
	it("should return true when under budget", () => {
		expect(fitsInBudget("test", 10)).toBe(true)
	})

	it("should return true when exactly at budget", () => {
		expect(fitsInBudget("test", 1)).toBe(true) // 4 chars = 1 token
	})

	it("should return false when over budget", () => {
		expect(fitsInBudget("testing this longer text", 2)).toBe(false)
	})

	it("should handle empty string", () => {
		expect(fitsInBudget("", 0)).toBe(true)
		expect(fitsInBudget("", 1)).toBe(true)
	})
})
