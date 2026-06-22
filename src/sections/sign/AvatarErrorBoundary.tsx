import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Reset the boundary when this key changes (e.g. the selected avatar URL). */
  resetKey?: string
}
interface State {
  failed: boolean
}

/**
 * Catches errors thrown inside the R3F avatar tree (e.g. a model failing to
 * load) so a failure shows a friendly message instead of a black canvas / blank
 * page. Resets automatically when the user picks a different avatar.
 */
export default class AvatarErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="absolute inset-0 grid place-items-center px-6 text-center">
          <div className="text-sm text-slate-400">
            <p className="font-semibold text-slate-300">아바타를 불러오지 못했습니다.</p>
            <p className="mt-1 text-xs text-slate-500">다른 아바타를 선택해 주세요.</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
