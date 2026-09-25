import { useEffect } from 'react'

import { CompareView } from './components/CompareView'
import { ForkSidebar } from './components/ForkSidebar'
import { DemoBanner, Header, Toasts } from './components/Header'
import { PromptPanel } from './components/PromptPanel'
import { TokenView } from './components/TokenView'
import { TreeView } from './components/TreeView'
import { treeFromHash } from './lib/share'
import { useStore } from './store'

function ExploreView() {
  return (
    <div className="grid h-full min-h-[760px] grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)_300px]">
      <div className="overflow-y-auto">
        <PromptPanel />
      </div>
      <div className="flex min-h-0 flex-col gap-4">
        <div className="max-h-[48%] min-h-0 shrink-0 overflow-hidden [&>section]:h-full">
          <TokenView />
        </div>
        <TreeView />
      </div>
      <ForkSidebar />
    </div>
  )
}

export default function App() {
  const tab = useStore((s) => s.tab)

  useEffect(() => {
    const { loadConfig, loadTree, showToast } = useStore.getState()
    loadConfig()
    try {
      const shared = treeFromHash()
      if (shared) loadTree(shared, 'Loaded shared tree from link')
    } catch (e) {
      showToast(`Could not load shared tree: ${e instanceof Error ? e.message : e}`)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <Header />
      <DemoBanner />
      <main className="min-h-0 flex-1 overflow-auto p-4">
        {tab === 'explore' ? <ExploreView /> : <CompareView />}
      </main>
      <Toasts />
    </div>
  )
}
