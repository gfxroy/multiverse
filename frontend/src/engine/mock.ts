// Port of backend/app/providers/mock.py: a deterministic fake language model.
//
// A word-level trigram/bigram model over a small corpus, with prompt-keyword boosting and
// hash-based "personality" noise per model name. Everything is derived from hashes of the
// request, so identical requests give identical output and forcing a different token
// really changes what comes next. The hash and RNG differ from the Python version, so the
// exact text differs, but the behaviour is the same.
import type { GenerationSettings, ProviderResult, TokenInfo } from '../lib/types'
import { annotateToken, buildAlternatives } from './entropy'
import { TOPICS } from './mockCorpus'
import type { Provider } from './tree'

const TOKEN_RE = /[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu
const WORD_RE = /[\p{L}\p{N}_]+/gu
const START = '<s>'
const SENTENCE_END = new Set(['.', '!', '?'])
const NO_SPACE_BEFORE = new Set(['.', ',', '!', '?', ':', ';'])

/** Split text into word/punctuation tokens with GPT-style leading spaces. */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const word = m[0]
    if (NO_SPACE_BEFORE.has(word) || (!tokens.length && m.index === 0)) tokens.push(word)
    else tokens.push(' ' + word)
  }
  return tokens
}

const key = (t: string) => t.trim().toLowerCase()
const words = (text: string) => new Set([...text.matchAll(WORD_RE)].map((m) => m[0].toLowerCase()))

/** 53-bit string hash (cyrb53). */
function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** Deterministic pseudo-random number in [-1, 1] derived from the given strings. */
export function unitHash(...parts: string[]): number {
  return (hash53(parts.join('\x1f')) / 2 ** 53) * 2 - 1
}

/** Seeded RNG (mulberry32) returning floats in [0, 1). */
function rng(seed: string): () => number {
  let a = hash53(seed) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Counts = Map<string, number>
const bump = (m: Counts, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)

class NGramModel {
  bigram = new Map<string, Counts>()
  trigram = new Map<string, Counts>()
  unigram: Counts = new Map()
  topicVocab = new Map<string, Set<string>>()
  common: string[]

  constructor() {
    for (const [topic, [, text]] of Object.entries(TOPICS)) {
      const vocab = new Set<string>()
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        let toks = tokenize(sentence)
        if (!toks.length) continue
        // Sentence starts get a leading space so they can follow a period mid-text.
        toks = toks.map((t) => (t.startsWith(' ') || NO_SPACE_BEFORE.has(t) ? t : ' ' + t))
        let ctx = [START, START]
        for (const tok of toks) {
          const tri = `${key(ctx[ctx.length - 2])}\u0000${key(ctx[ctx.length - 1])}`
          if (!this.trigram.has(tri)) this.trigram.set(tri, new Map())
          bump(this.trigram.get(tri)!, tok)
          const bi = key(ctx[ctx.length - 1])
          if (!this.bigram.has(bi)) this.bigram.set(bi, new Map())
          bump(this.bigram.get(bi)!, tok)
          bump(this.unigram, tok)
          vocab.add(tok)
          ctx.push(tok)
          if (SENTENCE_END.has(tok)) ctx = [START, START]
        }
      }
      this.topicVocab.set(topic, vocab)
    }
    // Stable sort by count, like Counter.most_common (ties keep insertion order).
    this.common = [...this.unigram]
      .map(([t, c], i) => ({ t, c, i }))
      .sort((a, b) => b.c - a.c || a.i - b.i)
      .slice(0, 60)
      .map((x) => x.t)
  }

  /** Raw evidence (pseudo-counts) for each candidate next token. */
  candidates(context: string[]): Counts {
    let prev2 = context.length >= 2 ? key(context[context.length - 2]) : START
    let prev1 = context.length ? key(context[context.length - 1]) : START
    if (context.length && SENTENCE_END.has(context[context.length - 1])) {
      prev2 = START
      prev1 = START
    }
    const scores: Counts = new Map()
    for (const [tok, c] of this.trigram.get(`${prev2}\u0000${prev1}`) ?? [])
      bump(scores, tok, 4 * c)
    for (const [tok, c] of this.bigram.get(prev1) ?? []) bump(scores, tok, 0.6 * c)
    if (prev1 === START)
      for (const [tok, c] of this.bigram.get(START) ?? []) bump(scores, tok, 0.5 * c)
    // Back-off: a few common tokens always get a little mass so top-k is well populated.
    for (const tok of this.common) bump(scores, tok, 0.003 * (this.unigram.get(tok) ?? 0))
    return scores
  }
}

let model: NGramModel | null = null
const getModel = () => (model ??= new NGramModel())

function topicsFor(prompt: string): string[] {
  const w = words(prompt)
  const hits = Object.entries(TOPICS)
    .filter(([, [keys]]) => keys.some((k) => w.has(k)))
    .map(([t]) => t)
  return hits.length ? hits : ['general']
}

function distribution(
  context: string[],
  promptWords: Set<string>,
  topics: string[],
  modelName: string,
): [string, number][] {
  const m = getModel()
  const raw = m.candidates(context)
  const tail = context.slice(-3).join('')
  const keys = context.map(key)
  const seen = new Set<string>()
  for (let i = 0; i + 2 < keys.length; i++)
    seen.add(`${keys[i]}\u0000${keys[i + 1]}\u0000${keys[i + 2]}`)
  const last2 = context.slice(-2).map(key)
  const logits: [string, number][] = []
  for (const [tok, evidence] of raw) {
    let logit = 2.4 * Math.log(evidence + 0.01)
    if (topics.some((t) => m.topicVocab.get(t)!.has(tok))) logit += 2.2
    if (promptWords.has(key(tok))) logit += 0.5
    if (context.length && tok === context[context.length - 1]) logit -= 4 // no immediate repeats
    if (last2.length === 2 && seen.has(`${last2[0]}\u0000${last2[1]}\u0000${key(tok)}`)) {
      logit -= 2.5 // discourage looping on an n-gram we already produced
    }
    logit += 0.6 * unitHash(modelName, tail, tok) // model-specific "personality"
    logits.push([tok, logit])
  }
  const max = Math.max(...logits.map(([, v]) => v))
  const logZ = Math.log(logits.reduce((a, [, v]) => a + Math.exp(v - max), 0))
  return logits.map(([t, v]) => [t, v - max - logZ] as [string, number]).sort((a, b) => b[1] - a[1])
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Demo-mode provider. `latencyMs` adds a small delay so the UI feels realistic. */
export class MockProvider implements Provider {
  readonly name = 'mock'
  private readonly latencyMs: number
  constructor(latencyMs = 0) {
    this.latencyMs = latencyMs
  }

  async complete(
    prompt: string,
    settings: GenerationSettings,
    prefix = '',
  ): Promise<ProviderResult> {
    if (this.latencyMs) await sleep(this.latencyMs)
    const promptWords = words(prompt)
    const topics = topicsFor(prompt)
    const context = tokenize(prefix)
    const out: TokenInfo[] = []
    let finish = 'length'
    const minLen = Math.min(settings.max_tokens, 24)
    for (let step = 0; step < settings.max_tokens; step++) {
      const dist = distribution(context, promptWords, topics, settings.model)
      const rand = rng(`${settings.model}|${settings.temperature}|${prompt}|${prefix}|${step}`)
      let idx = 0
      if (settings.temperature > 1e-6) {
        const weights = dist.map(([, lp]) => Math.exp(lp / settings.temperature))
        let r = rand() * weights.reduce((a, b) => a + b, 0)
        idx = weights.findIndex((w) => (r -= w) < 0)
        if (idx < 0) idx = weights.length - 1
      }
      const first = !context.length && !out.length
      const [raw, logprob] = dist[idx]
      const token = first ? raw.trimStart() : raw // first token of a reply has no leading space
      const alts = buildAlternatives(
        dist
          .slice(0, settings.top_logprobs)
          .map(([t, lp]) => [first ? t.trimStart() : t, lp] as [string, number]),
      )
      out.push(annotateToken(token, logprob, alts))
      context.push(token)
      if (SENTENCE_END.has(token) && out.length >= minLen && rand() < 0.45) {
        finish = 'stop'
        break
      }
    }
    return { tokens: out, finish_reason: finish, model: settings.model, method: 'mock' }
  }
}
