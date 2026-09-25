import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { tok } from '../test/fixtures'
import { TokenInspector } from './TokenInspector'

const token = tok(' cat', { ' cat': 0.45, ' dog': 0.4, ' fox': 0.1 }, { is_fork: true })

describe('TokenInspector', () => {
  it('shows alternatives with probabilities', () => {
    render(<TokenInspector token={token} position={3} />)
    expect(screen.getByText('Token #3')).toBeInTheDocument()
    expect(screen.getByText('␣dog')).toBeInTheDocument()
    expect(screen.getByText('40.0%')).toBeInTheDocument()
    expect(screen.getByText('fork point')).toBeInTheDocument()
  })

  it('branches on a clicked alternative or a custom token when pinned', () => {
    const onChoose = vi.fn()
    render(<TokenInspector token={token} position={3} pinned onChoose={onChoose} />)
    fireEvent.click(screen.getByRole('button', { name: /␣fox/ }))
    expect(onChoose).toHaveBeenCalledWith(' fox')
    fireEvent.change(screen.getByLabelText('Custom token'), { target: { value: ' dragon' } })
    fireEvent.click(screen.getByText('Branch'))
    expect(onChoose).toHaveBeenLastCalledWith(' dragon')
  })

  it('does not allow re-choosing the chosen token', () => {
    const onChoose = vi.fn()
    render(<TokenInspector token={token} position={3} pinned onChoose={onChoose} />)
    fireEvent.click(screen.getByRole('button', { name: /␣cat/ }))
    expect(onChoose).not.toHaveBeenCalled()
  })
})
