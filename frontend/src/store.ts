import { create } from 'zustand'

import { api } from './lib/api'
import type { ColorMode } from './lib/color'
import { remarkTree } from './lib/forks'
import { firstLeaf } from './lib/tree'
import type {
  CompareResponse,
  CompareSide,
  ForkSettings,
  GenerationSettings,
  ModelsInfo,
  Tree,
} from './lib/types'

export type Tab = 'explore' | 'compare'
export type Busy = 'generate' | 'branch' | 'explore' | 'compare' | null

export const DEFAULT_PROMPT = 'Write a short story about a lighthouse keeper.'

interface State {
  config: ModelsInfo | null
  configError: string | null
  tab: Tab
  prompt: string
  settings: GenerationSettings
  forkSettings: ForkSettings
  colorMode: ColorMode
  tree: Tree | null
  activeId: string | null
  /** Pinned token position on the active path (opens the branch menu). */
  selected: number | null
  /** Token position to flash/scroll to (from the fork sidebar). */
  focus: number | null
  busy: Busy
  error: string | null
  toast: string | null
  compareA: CompareSide
  compareB: CompareSide
  compareResult: CompareResponse | null

  loadConfig: () => Promise<void>
  setTab: (tab: Tab) => void
  setPrompt: (prompt: string) => void
  updateSettings: (patch: Partial<GenerationSettings>) => void
  updateForkSettings: (patch: Partial<ForkSettings>) => void
  setColorMode: (mode: ColorMode) => void
  setActive: (id: string) => void
  select: (position: number | null) => void
  setFocus: (position: number | null) => void
  generate: () => Promise<void>
  branch: (position: number, token: string) => Promise<void>
  explore: (topK: number, depth: number) => Promise<void>
  loadTree: (tree: Tree, message?: string) => void
  setCompareSide: (side: 'a' | 'b', patch: Partial<CompareSide>) => void
  runCompare: () => Promise<void>
  showToast: (message: string) => void
  clearError: () => void
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useStore = create<State>((set, get) => ({
  config: null,
  configError: null,
  tab: 'explore',
  prompt: DEFAULT_PROMPT,
  settings: { model: 'gpt-4o-mini', temperature: 0.8, max_tokens: 60, top_logprobs: 10 },
  forkSettings: { entropy_threshold: 1.5, margin_threshold: 0.15, min_alt_prob: 0.05 },
  colorMode: 'probability',
  tree: null,
  activeId: null,
  selected: null,
  focus: null,
  busy: null,
  error: null,
  toast: null,
  compareA: { model: 'gpt-4o-mini', temperature: 0 },
  compareB: { model: 'gpt-4o-mini', temperature: 1.2 },
  compareResult: null,

  loadConfig: async () => {
    try {
      const config = await api.config()
      set((s) => ({
        config,
        configError: null,
        settings: { ...s.settings, model: config.default_model },
        compareA: { ...s.compareA, model: config.default_model },
        compareB: { ...s.compareB, model: config.default_model },
      }))
    } catch (e) {
      set({ configError: `Backend unreachable: ${errorMessage(e)}` })
    }
  },

  setTab: (tab) => set({ tab }),
  setPrompt: (prompt) => set({ prompt }),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  updateForkSettings: (patch) =>
    set((s) => {
      const forkSettings = { ...s.forkSettings, ...patch }
      return { forkSettings, tree: s.tree ? remarkTree(s.tree, forkSettings) : null }
    }),
  setColorMode: (colorMode) => set({ colorMode }),
  setActive: (activeId) => set({ activeId, selected: null }),
  select: (selected) => set({ selected }),
  setFocus: (focus) => set({ focus }),

  generate: async () => {
    const { prompt, settings, forkSettings } = get()
    set({ busy: 'generate', error: null, selected: null })
    try {
      const tree = await api.generate(prompt, settings, forkSettings)
      set({ tree, activeId: tree.root_id })
    } catch (e) {
      set({ error: errorMessage(e) })
    } finally {
      set({ busy: null })
    }
  },

  branch: async (position, token) => {
    const { tree, activeId } = get()
    if (!tree || !activeId) return
    set({ busy: 'branch', error: null })
    try {
      const res = await api.branch(tree, activeId, position, token)
      set({ tree: res.tree, activeId: res.node_id, selected: null })
      if (!res.created) get().showToast('Switched to an existing branch')
    } catch (e) {
      set({ error: errorMessage(e) })
    } finally {
      set({ busy: null })
    }
  },

  explore: async (topK, depth) => {
    const { tree, activeId } = get()
    if (!tree || !activeId) return
    set({ busy: 'explore', error: null })
    try {
      const res = await api.explore(tree, activeId, topK, depth)
      set({ tree: res.tree })
      const n = res.created.length
      get().showToast(
        n === 0
          ? 'No unexplored fork points on this branch'
          : `Explored ${n} new branch${n === 1 ? '' : 'es'}${res.truncated ? ' (node budget reached)' : ''}`,
      )
    } catch (e) {
      set({ error: errorMessage(e) })
    } finally {
      set({ busy: null })
    }
  },

  loadTree: (tree, message) => {
    set({
      tree,
      prompt: tree.prompt,
      settings: tree.settings,
      forkSettings: tree.fork_settings,
      activeId: firstLeaf(tree, tree.root_id),
      selected: null,
      tab: 'explore',
    })
    if (message) get().showToast(message)
  },

  setCompareSide: (side, patch) =>
    set((s) =>
      side === 'a'
        ? { compareA: { ...s.compareA, ...patch } }
        : { compareB: { ...s.compareB, ...patch } },
    ),

  runCompare: async () => {
    const { prompt, compareA, compareB, settings, forkSettings } = get()
    set({ busy: 'compare', error: null })
    try {
      const compareResult = await api.compare(
        prompt,
        compareA,
        compareB,
        settings.max_tokens,
        settings.top_logprobs,
        forkSettings,
      )
      set({ compareResult })
    } catch (e) {
      set({ error: errorMessage(e) })
    } finally {
      set({ busy: null })
    }
  },

  showToast: (toast) => {
    clearTimeout(toastTimer)
    set({ toast })
    toastTimer = setTimeout(() => set({ toast: null }), 2800)
  },
  clearError: () => set({ error: null }),
}))
