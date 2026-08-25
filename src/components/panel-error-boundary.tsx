import { Component, type ErrorInfo, type ReactNode } from 'react'

import { ErrorState } from '#/components/states'

interface Props {
  children: ReactNode
  /** Accessible name of the region, e.g. "activity feed". */
  region?: string
}

interface State {
  error: unknown | null
}

/**
 * Wraps a major panel region so one broken widget renders its own
 * categorized error state instead of blanking the whole app.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console-only by policy: raw errors never reach the UI.
    console.error(`[panel:${this.props.region ?? 'unknown'}]`, error, info.componentStack)
  }

  render() {
    if (this.state.error !== null) {
      return (
        <ErrorState
          error={this.state.error}
          retry={() => this.setState({ error: null })}
        />
      )
    }
    return this.props.children
  }
}
